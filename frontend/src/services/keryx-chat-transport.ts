/**
 * Custom chat transport for the Keryx SSE streaming format.
 *
 * Implements the AI SDK v7 ChatTransport interface.
 * Adapts our backend's custom SSE format (type: text / reasoning /
 * tool_call / tool_result / finish / error) to UIMessageChunk objects
 * consumed by the @ai-sdk/react `useChat` hook.
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { randomUUID } from "#/shared/uuid";

interface KeryxChatTransportOptions {
  api: string;
  headers?: () => Promise<Record<string, string>>;
  /**
   * How much assistant text the client already has when a reconnect
   * happens, as the `since` cursor so the backend only streams the
   * remainder instead of replaying everything (which would duplicate the
   * partial message). Must be counted in UTF-8 BYTES (Go string length),
   * not JS `.length` — see chat.$id.tsx.
   */
  resumeTextLength?: number;
}

// parseMaybeJSON turns tool payloads into objects when they are valid JSON
// (tool inputs always are), leaving plain strings untouched.
function parseMaybeJSON(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mergeHeaders(
  base: Record<string, string>,
  extra?: Record<string, string> | Headers,
): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  if (!extra) return merged;
  if (extra instanceof Headers) {
    for (const [key, value] of extra.entries()) {
      merged[key] = value;
    }
  } else {
    Object.assign(merged, extra);
  }
  return merged;
}

export class KeryxChatTransport implements ChatTransport<UIMessage> {
  private api: string;
  private getHeaders: () => Promise<Record<string, string>>;
  private resumeTextLength?: number;
  /**
   * Sequence cursor of the most recent SSE event of the current run
   * (from the `id:` line, falling back to `data.seq`). Zero until the
   * first numbered event arrives; used as the `sinceSeq` cursor when the
   * connection drops mid-run.
   */
  private lastSeq = 0;

  constructor(options: KeryxChatTransportOptions) {
    this.api = options.api;
    this.getHeaders = options.headers ?? (async () => ({}));
    this.resumeTextLength = options.resumeTextLength;
  }

  async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const mergedHeaders = mergeHeaders(
      {
        "content-type": "application/json",
        ...(await this.getHeaders()),
      },
      options.headers,
    );

    // Composer submits pass the request config as `body`; assistant-ui
    // runtimes pass it as `metadata` (RunConfig.custom) instead. Either
    // shape is accepted so runtime-initiated runs (e.g. regeneration via
    // startRun) carry the same keryx parameters.
    const metadata = options.metadata as
      | { custom?: Record<string, unknown> }
      | Record<string, unknown>
      | undefined;
    const request =
      [
        (options.body ?? {}) as Record<string, unknown>,
        (metadata as { custom?: Record<string, unknown> } | undefined)
          ?.custom,
        (metadata ?? {}) as Record<string, unknown>,
      ].find((candidate) => candidate?.model || candidate?.preset) ?? {};
    const model = request.model as string | undefined;
    const preset = request.preset as string | undefined;
    if (!model && !preset) {
      throw new Error("No model selected");
    }

    // Convert UIMessage[] to backend ChatMessage[] (role + content + files).
    // Messages with neither text content nor file attachments are skipped:
    // sending them makes providers reject the whole request with 400.
    const messages = options.messages
      .map((msg: UIMessage) => {
        let content = "";
        if (Array.isArray(msg.parts)) {
          content = msg.parts
            .filter((p) => p.type === "text")
            .map((p) => ("text" in p ? (p.text ?? "") : ""))
            .join("");
        } else if (
          typeof (msg as unknown as { content?: string }).content === "string"
        ) {
          content = (msg as unknown as { content: string }).content;
        }
        // Attachments travel as metadata refs; the backend resolves the
        // bytes from stored files. The attachment id is stored in
        // providerMetadata.keryx.storageKey, with the API URL as fallback.
        const attachments = (Array.isArray(msg.parts) ? msg.parts : [])
          .filter((p) => p.type === "file")
          .map((p) => {
            const part = p as {
              url?: string;
              filename?: string;
              mediaType?: string;
              providerMetadata?: Record<string, any>;
            };
            const storageKey =
              part.providerMetadata?.keryx?.storageKey as string | undefined;
            const fromUrl =
              typeof part.url === "string" &&
              part.url.startsWith("/api/attachments/")
                ? part.url.slice("/api/attachments/".length)
                : undefined;
            const id = storageKey ?? fromUrl;
            if (!id) return null;
            return {
              id,
              filename: part.filename ?? "attachment",
              mediaType: part.mediaType ?? "application/octet-stream",
            };
          })
          .filter((a: unknown) => a !== null);

        const role = msg.role ?? "user";
        if (role !== "user" && role !== "assistant") return null;

        // Extract tool invocations and results so multi-turn conversations
        // retain tool context (e.g. read_file results or web searches).
        const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        const toolResults: Array<{ toolCallId: string; toolName: string; output: string }> = [];

        if (Array.isArray(msg.parts)) {
          for (const p of msg.parts) {
            if (p.type === "dynamic-tool" || (typeof p.type === "string" && p.type.startsWith("tool-"))) {
              const part = p as {
                toolCallId?: string;
                toolName?: string;
                input?: unknown;
                output?: unknown;
              };
              const id = part.toolCallId || "";
              const name = part.toolName || (typeof p.type === "string" && p.type.startsWith("tool-") ? p.type.slice(5) : "tool");
              const inputStr = typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {});
              const outputStr = typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
              if (id && name) {
                toolCalls.push({ id, name, arguments: inputStr });
                if (part.output !== undefined) {
                  toolResults.push({ toolCallId: id, toolName: name, output: outputStr });
                }
              }
            }
          }
        }

        if (!content.trim() && attachments.length === 0 && toolCalls.length === 0) return null;
        const base: Record<string, unknown> = { id: msg.id, role, content };
        if (attachments.length) base.attachments = attachments;
        if (toolCalls.length) base.toolCalls = toolCalls;
        if (toolResults.length) base.toolResults = toolResults;
        return base;
      })
      .filter((msg: unknown) => msg !== null);

    // The raw last user UI message (parts, id, createdAt) is persisted
    // verbatim by the backend before streaming, so no input is ever lost
    // even if the stream fails or the client disconnects.
    const lastUserMessage =
      [...options.messages].reverse().find((msg) => (msg.role ?? "user") === "user") ??
      null;

    const response = await fetch(this.api, {
      method: "POST",
      headers: mergedHeaders,
      body: JSON.stringify({
        model,
        preset,
        messages,
        system: (request.system as string) ?? "",
        webSearch: Boolean(request.webSearch),
        language: request.language as string,
        username: (request.username as string) ?? "",
        datetime: (request.datetime as string) ?? "",
        timezone: (request.timezone as string) ?? "",
        agentId: (request.agentId as string) ?? "",
        projectId: (request.projectId as string) ?? "",
        userMessage: lastUserMessage,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Stream request failed");
      throw new Error(text);
    }

    // A new run starts a fresh sequence cursor: seq numbers are
    // per-run, so a leftover value would ask the replay endpoint for
    // events that do not belong to this stream.
    this.lastSeq = 0;

    return this.readStream(response.body!, options.abortSignal);
  }

  async reconnectToStream(options: {
    chatId: string;
    abortSignal?: AbortSignal;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk> | null> {
    const mergedHeaders = mergeHeaders(await this.getHeaders(), options.headers);

    let response: Response;
    try {
      // `since` tells the backend how much assistant text the client
      // already has, so it streams only the remainder. Per-request body
      // wins (submit-time reconnects); otherwise the length captured from
      // the rehydrated transcript at construction time; else full replay.
      const bodySince = (options.body as any)?.sinceTextLength;
      const since =
        typeof bodySince === "number"
          ? Math.max(0, Math.floor(bodySince))
          : typeof this.resumeTextLength === "number" &&
              this.resumeTextLength >= 0
            ? Math.floor(this.resumeTextLength)
            : 0;
      response = await fetch(`${this.api}?since=${since}`, {
        method: "GET",
        headers: mergedHeaders,
        signal: options.abortSignal,
      });
    } catch {
      // Network error while probing — treat as "no active stream" and let
      // the normal load path handle recovery.
      return null;
    }

    if (response.status === 204) {
      // No active stream for this chat.
      return null;
    }
    if (!response.ok || !response.body) {
      return null;
    }

    this.lastSeq = 0;
    return this.readStream(response.body, options.abortSignal);
  }

  /**
   * Result of a reconnect probe against the replay endpoint.
   * - "ok": a live SSE body carrying the missed deltas.
   * - "finished": the probe says there is nothing to stream (204 / no
   *   body), i.e. the run completed server-side and was persisted.
   * - "failed": the probe itself errored (network down) — nothing learned.
   */
  private async replaySince(
    sinceSeq: number,
    abortSignal?: AbortSignal,
  ): Promise<
    | { status: "ok"; body: ReadableStream<Uint8Array> }
    | { status: "finished" }
    | { status: "failed" }
  > {
    try {
      const response = await fetch(`${this.api}?sinceSeq=${sinceSeq}`, {
        method: "GET",
        headers: mergeHeaders(await this.getHeaders()),
        signal: abortSignal,
      });
      if (response.status === 204 || !response.ok || !response.body) {
        return { status: "finished" };
      }
      return { status: "ok", body: response.body };
    } catch {
      return { status: "failed" };
    }
  }

  /**
   * Reads the Keryx SSE format and emits AI SDK UIMessageChunks.
   *
   * In replay mode the backend sends `text_snapshot` / `reasoning_snapshot`
   * (full accumulated text) instead of deltas, so both are handled here.
   *
   * Every SSE frame carries a monotonic sequence number (`id:` line, with
   * `data.seq` as fallback). If the connection breaks mid-run (reader
   * error, not a server `error` event and not a clean end), the stream
   * automatically reconnects with `?sinceSeq=<lastSeq>` up to twice and
   * pipes the replayed deltas into the same stream. A probe that reports
   * "finished" closes cleanly instead, since the backend persisted
   * everything and the UI refreshes from the store on ready.
   */
  private readStream(
    body: ReadableStream<Uint8Array>,
    abortSignal?: AbortSignal,
  ): ReadableStream<UIMessageChunk> {
    // Lexical captures of `this` for use inside the stream's start callback.
    const getLastSeq = () => this.lastSeq;
    const setLastSeq = (seq: number) => {
      this.lastSeq = seq;
    };
    const tryReplay = (sinceSeq: number) =>
      this.replaySince(sinceSeq, abortSignal);
    const messageId = randomUUID();

    return new ReadableStream({
      async start(controller) {
        let currentReader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Each reasoning block gets its own id, so a model that thinks,
        // calls a tool and then thinks again produces separate reasoning
        // parts instead of one concatenated blob.
        let reasoningId = randomUUID();
        let reasoningOpen = false;
        // Tracks whether a reasoning block was already closed in this
        // stream, so the next block can be given a fresh id.
        let closedReasoning = false;
        let startSent = false;
        // Counter for generated source ids when the server does not send one.
        let sourceCount = 0;
        // Reconnect attempts used for the current stream.
        let retries = 0;
        // Sequence of the current SSE frame from its `id:` line, reset per
        // data event so a frame without an id line falls back to data.seq.
        let pendingSeq: number | null = null;

        // Initial chunks are emitted lazily once the backend's 'start' event
        // arrives, so the SDK can adopt the persisted assistant message id.
        const ensureStart = (serverMessageId?: string) => {
          if (startSent) return;
          startSent = true;
          controller.enqueue({
            type: "start",
            messageId: serverMessageId,
          } as UIMessageChunk);
          controller.enqueue({ type: "start-step" } as UIMessageChunk);
          controller.enqueue({
            type: "text-start",
            id: messageId,
          } as UIMessageChunk);
        };

        const closeReasoning = () => {
          if (reasoningOpen) {
            controller.enqueue({
              type: "reasoning-end",
              id: reasoningId,
            } as UIMessageChunk);
            reasoningOpen = false;
          }
        };

        // Opens a reasoning block. A new id is minted after the previous
        // one closed, so consecutive reasoning blocks stay separate parts.
        const openReasoning = () => {
          if (reasoningOpen) return;
          if (closedReasoning) reasoningId = randomUUID();
          closedReasoning = true;
          controller.enqueue({
            type: "reasoning-start",
            id: reasoningId,
          } as UIMessageChunk);
          reasoningOpen = true;
        };
        const closeAll = () => {
          closeReasoning();
          controller.enqueue({
            type: "text-end",
            id: messageId,
          } as UIMessageChunk);
        };

        const finish = (reason: "stop" | "error") => {
          controller.enqueue({ type: "finish-step" } as UIMessageChunk);
          controller.enqueue({
            type: "finish",
            finishReason: reason,
          } as UIMessageChunk);
          controller.close();
        };

        const surfaceError = (err: unknown) => {
          ensureStart();
          closeAll();
          controller.enqueue({
            type: "error",
            errorText: err instanceof Error ? err.message : "Stream error",
          } as UIMessageChunk);
          finish("error");
        };

        while (true) {
          const passReader = currentReader;
          try {
            while (true) {
              const { done, value } = await passReader.read();
              if (done) {
                ensureStart();
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("id: ")) {
                  const parsed = Number.parseInt(trimmed.slice(4), 10);
                  pendingSeq = Number.isFinite(parsed) ? parsed : null;
                  continue;
                }
                if (!trimmed.startsWith("data: ")) continue;

                try {
                  const data = JSON.parse(trimmed.slice(6));

                  // Prefer the frame's `id:` line; fall back to data.seq.
                  const seq =
                    pendingSeq ??
                    (typeof data.seq === "number" ? data.seq : null);
                  if (typeof seq === "number" && Number.isFinite(seq)) {
                    setLastSeq(seq);
                  }
                  pendingSeq = null;

                  if (data.type === "start") {
                    // Adopt the backend-persisted assistant message id so the
                    // in-memory message matches the stored one (stable votes,
                    // no re-hydration needed after the stream). A replay's
                    // second `start` is ignored — the run is already open.
                    ensureStart(data.assistantMessageId || undefined);
                    continue;
                  }
                  ensureStart();

                  if (data.type === "reasoning" && data.text) {
                    openReasoning();
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: reasoningId,
                      delta: data.text,
                    } as UIMessageChunk);
                  } else if (data.type === "reasoning_snapshot" && data.text) {
                    // Full accumulated reasoning replaces whatever partial state
                    // the fresh client had (none, on a reload).
                    openReasoning();
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: reasoningId,
                      delta: data.text,
                    } as UIMessageChunk);
                  } else if (data.type === "tool_call" && data.toolCallId) {
                    // A tool call ends the current reasoning block, so the
                    // reasoning that follows the tool result is a separate
                    // part with its own timeline position.
                    closeReasoning();
                    // Live tool activity: the backend executes the tool and
                    // keeps streaming; show an input-available tool part.
                    controller.enqueue({
                      type: "tool-input-available",
                      toolCallId: data.toolCallId,
                      toolName: data.name ?? "tool",
                      input: parseMaybeJSON(data.input),
                    } as UIMessageChunk);
                  } else if (data.type === "tool_result" && data.toolCallId) {
                    controller.enqueue({
                      type: "tool-output-available",
                      toolCallId: data.toolCallId,
                      output: parseMaybeJSON(data.output),
                    } as UIMessageChunk);
                  } else if (data.type === "tool_approval" && data.approvalId) {
                    // The backend is blocked waiting for the user to approve
                    // or deny this tool call.
                    controller.enqueue({
                      type: "tool-approval-request",
                      approvalId: data.approvalId,
                      toolCallId: data.toolCallId,
                      reason: data.reason,
                      approvalDescriptor: {
                        toolName: data.name ?? "tool",
                        input: parseMaybeJSON(data.input),
                      },
                    } as UIMessageChunk);
                  } else if (data.type === "artifact" && data.artifactId) {
                    // A model-produced artifact announcement. The content is
                    // not in the stream: the panel fetches it lazily from
                    // GET /api/chats/{id}/artifacts/{artifactId}.
                    controller.enqueue({
                      type: "data-artifact",
                      id: `artpart-${data.artifactId}-v${data.version}`,
                      data: {
                        artifactId: data.artifactId,
                        title: data.title,
                        artifactType: data.artifactType,
                        version: data.version,
                      },
                    } as UIMessageChunk);
                  } else if (data.type === "source" && data.url) {
                    // A citation the answer is based on.
                    controller.enqueue({
                      type: "source-url",
                      sourceId: data.sourceId ?? `src_${sourceCount++}`,
                      url: data.url,
                      title: data.title,
                    } as UIMessageChunk);
                  } else if (
                    (data.type === "text_snapshot" || data.type === "text") &&
                    data.text
                  ) {
                    closeReasoning();
                    controller.enqueue({
                      type: "text-delta",
                      id: messageId,
                      delta: data.text,
                    } as UIMessageChunk);
                  } else if (data.type === "finish") {
                    closeAll();
                    finish("stop");
                    return;
                  } else if (data.type === "error") {
                    closeAll();
                    controller.enqueue({
                      type: "error",
                      errorText: data.error ?? "Unknown error",
                    } as UIMessageChunk);
                    finish("error");
                    return;
                  }
                } catch {
                  // skip malformed JSON lines
                  pendingSeq = null;
                }
              }
            }

            // If we got here without a finish/error event, close cleanly.
            closeAll();
            finish("stop");
            return;
          } catch (err) {
            // Stream break (reader error). Not a server `error` event and
            // not a clean finish: try to rejoin the run from the last seen
            // sequence number before giving up.
            if (getLastSeq() > 0 && retries < 2 && !abortSignal?.aborted) {
              retries += 1;
              const replay = await tryReplay(getLastSeq());
              if (replay.status === "ok") {
                currentReader = replay.body.getReader();
                buffer = "";
                pendingSeq = null;
                // The replay's first frame is a `start` event; ensureStart
                // ignores it when the run is already open, and the replayed
                // deltas keep appending to the same message.
                continue;
              }
              if (replay.status === "finished") {
                // The run completed server-side; everything was persisted,
                // so close cleanly instead of failing the UI.
                ensureStart();
                closeAll();
                finish("stop");
                return;
              }
              // Probe failed (network down): surface the original error.
            }
            surfaceError(err);
            return;
          } finally {
            // Release whichever reader this pass used; a reconnect already
            // replaced currentReader, which stays untouched.
            try {
              passReader.releaseLock();
            } catch {
              // The reader may already be detached after an error.
            }
          }
        }
      },
    });
  }
}
