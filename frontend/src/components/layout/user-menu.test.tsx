import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserMenu } from "./user-menu";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => {},
}));

vi.mock("#/stores/auth", () => ({
  useAuth: () => ({
    session: { user: { role: "admin" } },
    userName: "Admin",
    userEmail: "admin@keryx.app",
    avatarUrl: null,
    logout: vi.fn(async () => {}),
  }),
}));

vi.mock("#/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    toggleLocale: vi.fn(),
  }),
}));

vi.mock("#/composables/use-theme", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
  }),
}));

// Regression check: opening the menu must not throw Base UI error #31
// ("MenuGroupContext is missing"), which happened when DropdownMenuLabel
// was rendered outside a DropdownMenuGroup and crashed the whole app.
describe("UserMenu", () => {
  it("opens the dropdown without crashing", async () => {
    const user = userEvent.setup();

    render(<UserMenu onOpenSettings={() => {}} onOpenAdmin={() => {}} />);

    await user.click(screen.getByRole("button", { name: "User menu" }));

    expect(
      await screen.findByRole("menuitem", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeInTheDocument();
  });
});
