import { createRootRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "#/components/layout/app-shell";
import { ErrorBoundary } from "#/components/layout/error-boundary";
import { NotFound } from "#/components/layout/not-found";
import { getAuthAdapter } from "#/services/runtime";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const pathname = location.pathname;
    const isPublic =
      pathname === "/login" ||
      pathname.startsWith("/invite/") ||
      pathname.startsWith("/share/");

    const auth = await getAuthAdapter();
    const session = await auth.getSession();

    // A signed-in user has no reason to see the login screen.
    if (session && pathname === "/login") {
      throw redirect({ to: "/" });
    }

    if (!session && !isPublic) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorBoundary,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
