/**
 * Integration test for the tool approval flow.
 *
 * The backend blocks the chat stream while a mutating tool waits for the
 * user's consent. This pins the client half of that contract: the approval
 * request reaches the message, answering it updates the state, and the tool
 * result that follows closes the loop.
 */
import { describe, expect, it } from "vitest";
import { readUIMessageStream } from "ai";
import type { UIMessage } from "ai";

async function drain(stream: ReadableStream<unknown>) {
  const out = await readUIMessageStream({
    stream: stream as never,
    onError: (e) => console.error("ERR", e),
  });
  let last: UIMessage | undefined;
  for await (const m of out) last = m;
  return last;
}

function makeStream() {
  const controllerRef: { controller?: ReadableStreamDefaultController } = {};
  const stream = new ReadableStream<unknown>({
    start(controller) {
      controllerRef.controller = controller;
    },
  });
  return { stream, controller: controllerRef };
}

describe("tool approval flow", () => {
  it("surfaces the approval request and then the tool result", async () => {
    const { stream, controller } = makeStream();

    controller.controller!.enqueue({
      type: "start",
      messageId: "m1",
    } as never);
    controller.controller!.enqueue({ type: "start-step" } as never);
    controller.controller!.enqueue({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "write_file",
      input: { path: "a.md" },
    } as never);
    controller.controller!.enqueue({
      type: "tool-approval-request",
      approvalId: "appr_1",
      toolCallId: "c1",
      reason: "The agent wants to write a.md in the workspace.",
    } as never);
    controller.controller!.enqueue({ type: "finish-step" } as never);
    controller.controller!.enqueue({
      type: "finish",
      finishReason: "stop",
    } as never);
    controller.controller!.close();

    const message = await drain(stream);

    const part = message?.parts.find(
      (p) => p.type === "tool-write_file",
    ) as unknown as {
      type: string;
      state: string;
      approval?: { id: string; requestReason?: string };
    };

    expect(part).toBeDefined();
    expect(part.state).toBe("approval-requested");
    expect(part.approval?.id).toBe("appr_1");
    expect(part.approval?.requestReason).toContain("a.md");
  });

  it("closes the loop when the tool result arrives after the approval", async () => {
    const { stream, controller } = makeStream();

    controller.controller!.enqueue({
      type: "start",
      messageId: "m1",
    } as never);
    controller.controller!.enqueue({ type: "start-step" } as never);
    controller.controller!.enqueue({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "write_file",
      input: { path: "a.md" },
    } as never);
    controller.controller!.enqueue({
      type: "tool-approval-request",
      approvalId: "appr_1",
      toolCallId: "c1",
    } as never);
    controller.controller!.enqueue({
      type: "tool-approval-response",
      approvalId: "appr_1",
      approved: true,
    } as never);
    controller.controller!.enqueue({
      type: "tool-output-available",
      toolCallId: "c1",
      output: "written",
    } as never);
    controller.controller!.enqueue({ type: "finish-step" } as never);
    controller.controller!.enqueue({
      type: "finish",
      finishReason: "stop",
    } as never);
    controller.controller!.close();

    const message = await drain(stream);

    const part = message?.parts.find(
      (p) => p.type === "tool-write_file",
    ) as unknown as {
      state: string;
      output?: string;
      approval?: { approved?: boolean };
    };

    expect(part.state).toBe("output-available");
    expect(part.output).toBe("written");
    expect(part.approval?.approved).toBe(true);
  });

  it("marks the tool as denied when the user refuses", async () => {
    const { stream, controller } = makeStream();

    controller.controller!.enqueue({
      type: "start",
      messageId: "m1",
    } as never);
    controller.controller!.enqueue({ type: "start-step" } as never);
    controller.controller!.enqueue({
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "write_file",
      input: { path: "a.md" },
    } as never);
    controller.controller!.enqueue({
      type: "tool-approval-request",
      approvalId: "appr_1",
      toolCallId: "c1",
    } as never);
    controller.controller!.enqueue({
      type: "tool-approval-response",
      approvalId: "appr_1",
      approved: false,
    } as never);
    controller.controller!.enqueue({
      type: "tool-output-available",
      toolCallId: "c1",
      output: "The user denied the write_file tool.",
    } as never);
    controller.controller!.enqueue({ type: "finish-step" } as never);
    controller.controller!.enqueue({
      type: "finish",
      finishReason: "stop",
    } as never);
    controller.controller!.close();

    const message = await drain(stream);

    const part = message?.parts.find(
      (p) => p.type === "tool-write_file",
    ) as unknown as {
      state: string;
      approval?: { approved?: boolean };
    };

    // The refusal is recorded, so the UI can label the tool as denied
    // instead of showing it as a successful call.
    expect(part.approval?.approved).toBe(false);
  });
});
