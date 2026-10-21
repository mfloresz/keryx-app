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

  constructor(options: KeryxChatTransportOptions) {
    this.api = options.api;
    this.getHeaders = options.headers ?? (async () => ({}));
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

    const body = (options.body as Record<string, unknown>) ?? {};
    const model = body.model as string | undefined;
    const preset = body.preset as string | undefined;
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
        if (!content.trim() && attachments.length === 0) return null;
        const base: Record<string, unknown> = { id: msg.id, role, content };
        if (attachments.length) base.attachments = attachments;
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
        system: (body.system as string) ?? "",
        webSearch: Boolean(body.webSearch),
        language: body.language as string,
        username: (body.username as string) ?? "",
        datetime: (body.datetime as string) ?? "",
        timezone: (body.timezone as string) ?? "",
        agentId: (body.agentId as string) ?? "",
        projectId: (body.projectId as string) ?? "",
        userMessage: lastUserMessage,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Stream request failed");
      throw new Error(text);
    }

    return this.readStream(response.body!);
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
      const since =
        typeof (options.body as any)?.sinceTextLength === "number"
          ? Math.max(0, Math.floor((options.body as any).sinceTextLength))
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

    return this.readStream(response.body);
  }

  /**
   * Reads the Keryx SSE format and emits AI SDK UIMessageChunks.
   *
   * In replay mode the backend sends `text_snapshot` / `reasoning_snapshot`
   * (full accumulated text) instead of deltas, so both are handled here.
   */
  private readStream(
    body: ReadableStream<Uint8Array>,
  ): ReadableStream<UIMessageChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const messageId = randomUUID();

    return new ReadableStream({
      async start(controller) {
        let buffer = "";
        const reasoningId = randomUUID();
        let reasoningOpen = false;
        let startSent = false;

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

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              ensureStart();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data: ")) continue;

              try {
                const data = JSON.parse(trimmed.slice(6));

                if (data.type === "start") {
                  // Adopt the backend-persisted assistant message id so the
                  // in-memory message matches the stored one (stable votes,
                  // no re-hydration needed after the stream).
                  ensureStart(data.assistantMessageId || undefined);
                  continue;
                }
                ensureStart();

                if (data.type === "reasoning" && data.text) {
                  if (!reasoningOpen) {
                    controller.enqueue({
                      type: "reasoning-start",
                      id: reasoningId,
                    } as UIMessageChunk);
                    reasoningOpen = true;
                  }
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    delta: data.text,
                  } as UIMessageChunk);
                } else if (data.type === "reasoning_snapshot" && data.text) {
                  // Full accumulated reasoning replaces whatever partial state
                  // the fresh client had (none, on a reload).
                  if (!reasoningOpen) {
                    controller.enqueue({
                      type: "reasoning-start",
                      id: reasoningId,
                    } as UIMessageChunk);
                    reasoningOpen = true;
                  }
                  controller.enqueue({
                    type: "reasoning-delta",
                    id: reasoningId,
                    delta: data.text,
                  } as UIMessageChunk);
                } else if (data.type === "tool_call" && data.toolCallId) {
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
              }
            }
          }
        } catch (err) {
          ensureStart();
          closeAll();
          controller.enqueue({
            type: "error",
            errorText: err instanceof Error ? err.message : "Stream error",
          } as UIMessageChunk);
          finish("error");
          return;
        } finally {
          reader.releaseLock();
        }

        // If we got here without a finish/error event, close cleanly.
        closeAll();
        finish("stop");
      },
    });
  }
}
