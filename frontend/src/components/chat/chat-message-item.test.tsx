/**
 * Render tests for the assistant message.
 *
 * These pin the two regressions that were found during the migration audit:
 * a live tool call showed up as an unnamed "tool", and a finished reasoning
 * block stayed expanded forever.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { ChatMessageItem } from "#/components/chat/chat-message-item";
import { I18nProvider } from "#/i18n";

function renderMessage(
  parts: unknown[],
  options: { isStreaming?: boolean } = {},
) {
  return render(
    <I18nProvider>
      <ChatMessageItem
        message={{ id: "m1", role: "assistant", parts } as never}
        isStreaming={options.isStreaming ?? false}
      />
    </I18nProvider>,
  );
}

describe("ChatMessageItem", () => {
  it("shows the tool name for a live (static) tool part", () => {
    // The SDK represents live tool calls as "tool-<name>" parts.
    const { container } = renderMessage([
      {
        type: "tool-read_file",
        toolCallId: "c1",
        state: "output-available",
        input: { path: "a.md" },
        output: "contenido",
      },
    ]);

    expect(container.textContent).toContain("read_file");
    expect(container.textContent).not.toContain("toolrunning");
  });

  it("shows the tool name for a persisted (dynamic) tool part", () => {
    const { container } = renderMessage([
      {
        type: "dynamic-tool",
        toolCallId: "c2",
        toolName: "read_file",
        state: "output-available",
        input: { path: "a.md" },
        output: "contenido",
      },
    ]);

    expect(container.textContent).toContain("read_file");
  });

  it("keeps the reasoning collapsed once the model stops thinking", async () => {
    const { container, rerender } = render(
      <I18nProvider>
        <ChatMessageItem
          message={{
            id: "m1",
            role: "assistant",
            parts: [
              { type: "reasoning", text: "Pensando...", state: "streaming" },
            ],
          } as never}
          isStreaming={true}
        />
      </I18nProvider>,
    );

    // While streaming the reasoning is visible.
    expect(container.textContent).toContain("Pensando...");

    rerender(
      <I18nProvider>
        <ChatMessageItem
          message={{
            id: "m1",
            role: "assistant",
            parts: [
              { type: "reasoning", text: "Pensando...", state: "done" },
              { type: "text", text: "Respuesta", state: "done" },
            ],
          } as never}
          isStreaming={false}
        />
      </I18nProvider>,
    );

    // The label switches to the finished wording.
    expect(container.textContent).toContain("Thought");
  });

  it("renders each reasoning block separately", async () => {
    const { container } = renderMessage([
      { type: "reasoning", text: "primera reflexion", state: "done" },
      { type: "reasoning", text: "segunda reflexion", state: "done" },
      { type: "text", text: "Respuesta", state: "done" },
    ]);

    // Two separate collapsible rows, not one merged block.
    const triggers = container.querySelectorAll(
      "[data-slot=trace-collapsible-trigger]",
    );
    expect(triggers).toHaveLength(2);

    // Each row keeps its own text: expanding one reveals only its block.
    const first = triggers[0] as HTMLButtonElement;
    fireEvent.click(first);

    const expanded = container.querySelector(
      "[data-slot=trace-collapsible-content]",
    );
    expect(expanded?.textContent).toContain("primera reflexion");
    expect(expanded?.textContent).not.toContain("segunda reflexion");
  });

  it("shows the approval prompt for a tool awaiting consent", () => {
    const { container } = renderMessage([
      {
        type: "tool-write_file",
        toolCallId: "c3",
        state: "approval-requested",
        input: { path: "a.md" },
        approval: {
          id: "appr_1",
          requestReason: "The agent wants to write a.md in the workspace.",
        },
      },
    ]);

    expect(container.textContent).toContain("write_file");
    expect(container.textContent).toContain("a.md");
  });

  it("renders an attachment with its filename and media type", () => {
    const { container } = renderMessage([
      {
        type: "file",
        url: "https://example.com/doc.pdf",
        filename: "doc.pdf",
        mediaType: "application/pdf",
      },
    ]);

    expect(container.textContent).toContain("doc.pdf");
    expect(container.textContent).toContain("application/pdf");
  });

  it("renders an image attachment with a preview", () => {
    const { container } = renderMessage([
      {
        type: "file",
        url: "https://example.com/pic.png",
        filename: "pic.png",
        mediaType: "image/png",
      },
    ]);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/pic.png");
  });
});
