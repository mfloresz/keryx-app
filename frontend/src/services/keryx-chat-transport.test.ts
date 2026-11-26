/**
 * Transport contract tests.
 *
 * The backend speaks a custom SSE dialect (type: start / text / reasoning /
 * tool_call / tool_result / finish / error). These tests pin the mapping to
 * AI SDK UIMessageChunks, because a mismatch here silently breaks streaming.
 */
import { describe, expect, it, vi } from "vitest";

import { KeryxChatTransport } from "#/services/keryx-chat-transport";

function sseResponse(frames: string[]): Response {
  const body = frames.map((frame) => `data: ${frame}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * A response whose body emits raw SSE chunks (which may carry `id:` lines)
 * and then breaks mid-stream, as a dropped connection would. Pull-based:
 * erroring inside start() is not spec-portable across stream polyfills.
 */
function brokenSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.error(new Error("connection reset"));
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function collect(
  stream: ReadableStream<UIMessageChunkLike>,
): Promise<UIMessageChunkLike[]> {
  const reader = stream.getReader();
  const chunks: UIMessageChunkLike[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

type UIMessageChunkLike = { type: string } & Record<string, unknown>;

function transportFor(response: Response) {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(response as unknown as Response);
  const transport = new KeryxChatTransport({ api: "/api/chats/x/stream" });
  return { transport, fetchSpy };
}

describe("KeryxChatTransport", () => {
  it("maps a text stream to start/text/finish chunks", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({ type: "start", assistantMessageId: "msg_server_1" }),
        JSON.stringify({ type: "text", text: "Hello" }),
        JSON.stringify({ type: "text", text: " world" }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "Hi" }],
        } as never,
      ],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const types = chunks.map((c) => c.type);

    expect(types).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);

    // The server's assistant message id is adopted so the in-memory message
    // matches the persisted one.
    expect(chunks[0].messageId).toBe("msg_server_1");
    expect(chunks[3].delta).toBe("Hello");
    expect(chunks[4].delta).toBe(" world");
    expect(chunks.at(-1)?.finishReason).toBe("stop");

    fetchSpy.mockRestore();
  });

  it("opens and closes a reasoning part around the text", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({ type: "reasoning", text: "thinking" }),
        JSON.stringify({ type: "text", text: "answer" }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const types = chunks.map((c) => c.type);

    expect(types).toContain("reasoning-start");
    expect(types).toContain("reasoning-delta");
    expect(types).toContain("reasoning-end");
    // Reasoning closes before the text delta starts.
    expect(types.indexOf("reasoning-end")).toBeLessThan(
      types.indexOf("text-delta"),
    );

    fetchSpy.mockRestore();
  });

  it("maps tool_call and tool_result to input/output chunks", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({
          type: "tool_call",
          name: "read_file",
          toolCallId: "call_1",
          input: '{"path":"a.md"}',
        }),
        JSON.stringify({
          type: "tool_result",
          name: "read_file",
          toolCallId: "call_1",
          output: '{"ok":true}',
        }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const input = chunks.find((c) => c.type === "tool-input-available");
    const output = chunks.find((c) => c.type === "tool-output-available");

    expect(input?.toolName).toBe("read_file");
    expect(input?.input).toEqual({ path: "a.md" });
    expect(output?.output).toEqual({ ok: true });

    fetchSpy.mockRestore();
  });

  it("emits an error chunk and closes the stream", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({ type: "error", error: "boom" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const error = chunks.find((c) => c.type === "error");

    expect(error?.errorText).toBe("boom");
    expect(chunks.at(-1)?.finishReason).toBe("error");

    fetchSpy.mockRestore();
  });

  it("sends the model, preset and user context in the request body", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([JSON.stringify({ type: "finish" })]),
    );

    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "Hi" }],
        } as never,
      ],
      abortSignal: undefined,
      body: {
        preset: "fast",
        webSearch: true,
        language: "en",
        username: "Test",
        agentId: "agent-1",
        projectId: "proj-1",
      },
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );

    expect(body.preset).toBe("fast");
    expect(body.webSearch).toBe(true);
    expect(body.language).toBe("en");
    expect(body.username).toBe("Test");
    expect(body.agentId).toBe("agent-1");
    expect(body.projectId).toBe("proj-1");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: "user", content: "Hi" });

    fetchSpy.mockRestore();
  });

  it("preserves tool calls and tool results in message history", async () => {
    const { transport, fetchSpy } = transportFor(sseResponse([]));

    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-tools",
      messageId: undefined,
      messages: [
        { id: "m1", role: "user", content: "Read a file" } as any,
        {
          id: "m2",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolCallId: "call-1",
              toolName: "read_file",
              input: { path: "README.md" },
              output: "file contents",
            },
            { type: "text", text: "I read the file." },
          ],
        } as any,
        { id: "m3", role: "user", content: "Now explain it" } as any,
      ],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1]).toMatchObject({
      role: "assistant",
      content: "I read the file.",
      toolCalls: [
        {
          id: "call-1",
          name: "read_file",
          arguments: JSON.stringify({ path: "README.md" }),
        },
      ],
      toolResults: [
        {
          toolCallId: "call-1",
          toolName: "read_file",
          output: "file contents",
        },
      ],
    });

    fetchSpy.mockRestore();
  });

  it("throws when neither a model nor a preset is selected", async () => {
    const { transport, fetchSpy } = transportFor(sseResponse([]));

    await expect(
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "x",
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
        body: {},
      }),
    ).rejects.toThrow("No model selected");

    fetchSpy.mockRestore();
  });

  it("accepts the request config from metadata when body has none", async () => {
    // assistant-ui runtimes (e.g. regeneration via startRun) pass the keryx
    // request config as RunConfig metadata instead of body; the transport
    // must build the same request either way.
    const { transport, fetchSpy } = transportFor(
      sseResponse([JSON.stringify({ type: "finish" })]),
    );

    await transport.sendMessages({
      trigger: "regenerate-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      metadata: {
        custom: {
          preset: "fast",
          webSearch: false,
          language: "en",
          username: "Test",
        },
      },
    });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );

    expect(body.preset).toBe("fast");
    expect(body.webSearch).toBe(false);
    expect(body.language).toBe("en");
    expect(body.username).toBe("Test");

    fetchSpy.mockRestore();
  });

  it("gives each reasoning block its own id", async () => {
    // The model thinks, calls a tool, then thinks again. Each reasoning
    // block must be a separate part, not one concatenated blob.
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({ type: "reasoning", text: "primero" }),
        JSON.stringify({
          type: "tool_call",
          name: "read_file",
          toolCallId: "call_1",
          input: '{"path":"a.md"}',
        }),
        JSON.stringify({
          type: "tool_result",
          name: "read_file",
          toolCallId: "call_1",
          output: "contenido",
        }),
        JSON.stringify({ type: "reasoning", text: "segundo" }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const starts = chunks.filter((c) => c.type === "reasoning-start");
    const ends = chunks.filter((c) => c.type === "reasoning-end");

    // Two reasoning blocks: two starts, two ends, two distinct ids.
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    expect(starts[0].id).not.toBe(starts[1].id);

    // The tool call closes the first reasoning block, so the reasoning that
    // follows the tool is chronologically after it.
    const toolIndex = chunks.findIndex((c) => c.type === "tool-input-available");
    const secondStart = chunks.findIndex(
      (c, i) => c.type === "reasoning-start" && i > toolIndex,
    );
    expect(secondStart).toBeGreaterThan(toolIndex);

    fetchSpy.mockRestore();
  });

  it("maps a source event to a source-url chunk", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({
          type: "source",
          title: "Example",
          url: "https://example.com",
        }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const source = chunks.find((c) => c.type === "source-url");

    expect(source?.url).toBe("https://example.com");
    expect(source?.title).toBe("Example");
    expect(source?.sourceId).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it("maps a tool_approval event to a tool-approval-request chunk", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({
          type: "tool_approval",
          approvalId: "appr_1",
          toolCallId: "call_1",
          name: "write_file",
          input: '{"path":"a.md"}',
          reason: "The agent wants to write a.md in the workspace.",
        }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const approval = chunks.find((c) => c.type === "tool-approval-request");

    expect(approval?.approvalId).toBe("appr_1");
    expect(approval?.toolCallId).toBe("call_1");
    expect(approval?.reason).toContain("a.md");

    fetchSpy.mockRestore();
  });

  it("maps an artifact event to a data-artifact chunk", async () => {
    const { transport, fetchSpy } = transportFor(
      sseResponse([
        JSON.stringify({
          type: "artifact",
          artifactId: "art_1",
          title: "Demo page",
          artifactType: "markdown",
          version: 2,
        }),
        JSON.stringify({ type: "finish" }),
      ]),
    );

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);
    const artifact = chunks.find((c) => c.type === "data-artifact");

    expect(artifact?.id).toBe("artpart-art_1-v2");
    expect(artifact?.data).toEqual({
      artifactId: "art_1",
      title: "Demo page",
      artifactType: "markdown",
      version: 2,
    });

    fetchSpy.mockRestore();
  });

  it("reconnects with sinceSeq after a break and closes cleanly when the run finished", async () => {
    // start = seq 1, text delta = seq 2; then the connection drops.
    const broken = brokenSseResponse([
      `id: 1\ndata: ${JSON.stringify({
        type: "start",
        assistantMessageId: "msg_1",
      })}\n\n`,
      `id: 2\ndata: ${JSON.stringify({ type: "text", text: "Hello" })}\n\n`,
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(broken as unknown as Response)
      // Probe says: nothing left to stream (run finished server-side).
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const transport = new KeryxChatTransport({ api: "/api/chats/x/stream" });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);

    // The retry probe used the last seen sequence number.
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/chats/x/stream?sinceSeq=2");

    // The delta streamed before the break survived, and the stream ended
    // cleanly (finish "stop") instead of surfacing a transport error.
    const deltas = chunks.filter((c) => c.type === "text-delta");
    expect(deltas.map((c) => c.delta)).toEqual(["Hello"]);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
    expect(chunks.at(-1)?.finishReason).toBe("stop");

    fetchSpy.mockRestore();
  });

  it("falls back to data.seq when the frame has no id line", async () => {
    const broken = brokenSseResponse([
      `data: ${JSON.stringify({ type: "text", text: "Hello", seq: 7 })}\n\n`,
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(broken as unknown as Response)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const transport = new KeryxChatTransport({ api: "/api/chats/x/stream" });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    await collect(stream as never);

    expect(fetchSpy.mock.calls[1][0]).toBe("/api/chats/x/stream?sinceSeq=7");

    fetchSpy.mockRestore();
  });

  it("pipes replayed deltas into the same stream after a break", async () => {
    const broken = brokenSseResponse([
      `id: 1\ndata: ${JSON.stringify({
        type: "start",
        assistantMessageId: "msg_1",
      })}\n\n`,
      `id: 2\ndata: ${JSON.stringify({ type: "text", text: "Hello" })}\n\n`,
    ]);
    // The replay starts with its own `start` event, then the missed deltas.
    const replay = sseResponse([
      JSON.stringify({ type: "start", assistantMessageId: "msg_1" }),
      JSON.stringify({ type: "text", text: " world" }),
      JSON.stringify({ type: "finish" }),
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(broken as unknown as Response)
      .mockResolvedValueOnce(replay);

    const transport = new KeryxChatTransport({ api: "/api/chats/x/stream" });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "x",
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
      body: { preset: "fast" },
    });

    const chunks = await collect(stream as never);

    expect(fetchSpy.mock.calls[1][0]).toBe("/api/chats/x/stream?sinceSeq=2");

    // Both deltas append to the same message, the replay's `start` is
    // ignored (only one start chunk), and the stream finishes cleanly.
    const deltas = chunks.filter((c) => c.type === "text-delta");
    expect(deltas.map((c) => c.delta)).toEqual(["Hello", " world"]);
    expect(chunks.filter((c) => c.type === "start")).toHaveLength(1);
    expect(chunks.find((c) => c.type === "error")).toBeUndefined();
    expect(chunks.at(-1)?.finishReason).toBe("stop");

    fetchSpy.mockRestore();
  });
});
