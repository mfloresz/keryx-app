import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import { AppSidebar } from "#/components/layout/app-sidebar";
import { MobileHeader } from "#/components/layout/mobile-header";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "#/components/ui/sidebar";
import { TooltipProvider } from "#/components/ui/tooltip";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, loadSession } = useAuth();
  const { fetchChats } = useChatStore();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  // Public routes (login, invite) render without the app chrome.
  const isPublic = pathname === "/login" || pathname.startsWith("/invite/");

  // The router guard already resolved the session, but the auth store owns
  // it for the rest of the app — load it once on mount.
  const bootstrapped = React.useRef(false);
  React.useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void loadSession();
  }, [loadSession]);

  const chatsLoaded = React.useRef(false);
  React.useEffect(() => {
    if (isPublic || chatsLoaded.current) return;
    if (!session) return;
    chatsLoaded.current = true;
    void fetchChats();
  }, [session, isPublic, fetchChats]);

  if (isPublic) {
    return <>{children}</>;
  }

  if (isLoading || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <MobileHeader />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export { SidebarTrigger };
