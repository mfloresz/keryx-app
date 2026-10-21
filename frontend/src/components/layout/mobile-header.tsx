import { useRouterState } from "@tanstack/react-router";

import { SidebarTrigger } from "#/components/ui/sidebar";
import { useChatStore } from "#/stores/chat";

/**
 * Header shown only on small screens. The desktop layout has a persistent
 * sidebar, so the trigger and the active chat title live here instead.
 */
export function MobileHeader() {
  const routerState = useRouterState();
  const { chats } = useChatStore();

  const chatId = routerState.location.pathname.startsWith("/chat/")
    ? routerState.location.pathname.slice("/chat/".length)
    : null;

  const title = chatId
    ? (chats.find((c) => c.id === chatId)?.label ?? "Untitled")
    : "Keryx";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:hidden">
      <SidebarTrigger className="-ml-1" />
      <span className="truncate text-sm font-medium">{title}</span>
    </header>
  );
}
