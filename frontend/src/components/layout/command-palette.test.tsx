import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./command-palette";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
}));

vi.mock("#/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    toggleLocale: vi.fn<() => void>(),
  }),
}));

vi.mock("#/stores/chat", () => ({
  useChatStore: () => ({ groups: [] }),
}));

// cmdk observes its list size; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
Element.prototype.scrollIntoView = () => {};

function Harness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open search</button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

describe("CommandPalette", () => {
  it("opens when the search button is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "open search" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
