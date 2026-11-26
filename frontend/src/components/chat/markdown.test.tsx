/**
 * Pins the streaming behaviour the chat relies on: an unfinished reply is
 * completed instead of flashing its raw Markdown, and the final text is
 * rendered as written.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Markdown } from "#/components/chat/markdown";
import { I18nProvider } from "#/i18n";

function renderMarkdown(text: string, streaming: boolean) {
  return render(
    <I18nProvider>
      <Markdown streaming={streaming}>{text}</Markdown>
    </I18nProvider>,
  );
}

describe("Markdown", () => {
  it("completes an unfinished emphasis span while streaming", () => {
    const { container } = renderMarkdown("**bo", true);

    expect(container.textContent).toContain("bo");
    expect(container.textContent).not.toContain("**");
    expect(container.querySelector(".flowdown")).not.toBeNull();
  });

  it("renders the final text as written once streaming ends", () => {
    const { container } = renderMarkdown("**bo", false);

    expect(container.textContent).toContain("**bo");
  });
});