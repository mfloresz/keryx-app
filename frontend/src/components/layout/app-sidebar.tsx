import * as React from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BotIcon,
  FolderIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";

import { CommandPalette } from "#/components/layout/command-palette";
import { SettingsDialog } from "#/components/settings/settings-dialog";
import { UserMenu } from "#/components/layout/user-menu";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar";
import { useI18n } from "#/i18n";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";
import { getChatRepository } from "#/services/runtime";

export function AppSidebar() {
  const { t } = useI18n();
  const { chats, groups, isLoading, updateChat, removeChat } = useChatStore();
  const { session } = useAuth();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const [searchOpen, setSearchOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [chatToDelete, setChatToDelete] = React.useState<string | null>(null);
  const [chatToRename, setChatToRename] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const isAdmin = session?.user.role === "admin";

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function confirmRename() {
    const id = chatToRename;
    const title = renameValue.trim();
    setChatToRename(null);
    if (!id || !title) return;
    try {
      const repo = await getChatRepository();
      await repo.updateTitle(id, title);
      updateChat(id, { label: title });
    } catch {
      // Non-fatal: the title stays as it was.
    }
  }

  async function confirmDelete() {
    const id = chatToDelete;
    setChatToDelete(null);
    if (!id) return;
    try {
      const repo = await getChatRepository();
      await repo.deleteChat(id);
      removeChat(id);
      if (pathname === `/chat/${id}`) {
        void navigate({ to: "/" });
      }
    } catch {
      // Non-fatal: the chat stays in the list.
    }
  }

  const groupLabel = (group: { id: string; labelKey?: string; label?: string }) =>
    group.labelKey ? t(group.labelKey) : (group.label ?? group.id);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => void navigate({ to: "/" })}
              tooltip={t("sidebar.newChat")}
            >
              <PlusIcon className="size-4" />
              <span className="font-medium">{t("sidebar.newChat")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setSearchOpen(true)}
              tooltip={t("sidebar.search")}
            >
              <SearchIcon className="size-4" />
              <span>{t("sidebar.search")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{"navigation"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/agents")}
                  onClick={() => void navigate({ to: "/agents" })}
                  tooltip={t("sidebar.agents")}
                >
                  <BotIcon className="size-4 opacity-70" />
                  <span>{t("sidebar.agents")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/projects")}
                  onClick={() => void navigate({ to: "/projects" })}
                  tooltip={t("sidebar.projects")}
                >
                  <FolderIcon className="size-4 opacity-70" />
                  <span>{t("sidebar.projects")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/favorites")}
                  onClick={() => void navigate({ to: "/favorites" })}
                  tooltip={t("sidebar.favorites")}
                >
                  <StarIcon className="size-4 opacity-70" />
                  <span>{t("sidebar.favorites")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1 overflow-hidden">
          <SidebarGroupLabel>{t("sidebar.recentChats")}</SidebarGroupLabel>
          <SidebarGroupContent>
            {isLoading && !chats.length ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {t("app.loading")}
              </p>
            ) : !chats.length ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                {t("sidebar.noChats")}
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.id}>
                    <div className="px-2 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {groupLabel(group)}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <div key={item.id} className="group/item relative">
                          <Link
                            to="/chat/$id"
                            params={{ id: item.id }}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeProps={{
                              className:
                                "bg-foreground font-medium text-background shadow-sm hover:bg-foreground hover:text-background",
                            }}
                          >
                            <MessageCircleIcon className="size-3.5 shrink-0 opacity-60" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("sidebar.actions")}
                                  className="absolute right-1 top-1/2 size-6 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100 data-[popup-open]:opacity-100"
                                />
                              }
                            >
                              <MoreHorizontalIcon className="size-3" />
                              <span className="sr-only">Actions</span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setChatToRename(item.id);
                                  setRenameValue(
                                    item.label === "Untitled" ? "" : item.label,
                                  );
                                }}
                              >
                                <PencilIcon className="mr-2 size-3.5" />
                                {t("sidebar.rename")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setChatToDelete(item.id)}
                              >
                                <Trash2Icon className="mr-2 size-3.5" />
                                {t("sidebar.delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserMenu
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAdmin={
            isAdmin ? () => void navigate({ to: "/admin" }) : undefined
          }
        />
      </SidebarFooter>

      <CommandPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      <ConfirmDialog
        open={chatToDelete !== null}
        onOpenChange={(open) => !open && setChatToDelete(null)}
        title={t("message.deleteTitle")}
        description={t("message.deleteDescription")}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmDialog
        open={chatToRename !== null}
        onOpenChange={(open) => !open && setChatToRename(null)}
        title={t("sidebar.rename")}
        confirmLabel={t("app.save")}
        onConfirm={() => void confirmRename()}
      >
        <input
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void confirmRename();
            }
          }}
          placeholder={t("sidebar.rename")}
          aria-label={t("sidebar.rename")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </ConfirmDialog>
    </Sidebar>
  );
}
