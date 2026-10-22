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
});
