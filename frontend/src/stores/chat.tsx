import * as React from "react";

import type { ChatIndexEntry } from "#/domain/chat/types";
import { getChatRepository } from "#/services/runtime";

export interface ChatListItem {
  id: string;
  label: string;
  to: string;
  createdAt: string;
}

export interface ChatGroup {
  id: string;
  /** i18n key for the group heading, or undefined for month groups. */
  labelKey?: string;
  /** Display label for month groups (e.g. "October 2026"). */
  label?: string;
  items: ChatListItem[];
}

interface ChatContextValue {
  chats: ChatListItem[];
  groups: ChatGroup[];
  isLoading: boolean;
  fetchChats: () => Promise<boolean>;
  addChat: (item: ChatListItem) => void;
  updateChat: (id: string, partial: Partial<ChatListItem>) => void;
  removeChat: (id: string) => void;
  deleteAllChats: () => Promise<void>;
}

const ChatContext = React.createContext<ChatContextValue | null>(null);

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Groups chats by age the way the sidebar does: today, yesterday, the last
 * 7 days, the last 30 days, then one group per calendar month.
 */
function groupChats(chats: ChatListItem[]): ChatGroup[] {
  const now = new Date();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 7 * DAY_MS;
  const monthStart = todayStart - 30 * DAY_MS;

  const today: ChatListItem[] = [];
  const yesterday: ChatListItem[] = [];
  const lastWeek: ChatListItem[] = [];
  const lastMonth: ChatListItem[] = [];
  const older: Record<string, ChatListItem[]> = {};

  for (const chat of chats) {
    const time = new Date(chat.createdAt).getTime();
    if (Number.isNaN(time)) {
      older["Older"] ??= [];
      older["Older"].push(chat);
      continue;
    }

    if (time >= todayStart) {
      today.push(chat);
    } else if (time >= yesterdayStart) {
      yesterday.push(chat);
    } else if (time >= weekStart) {
      lastWeek.push(chat);
    } else if (time >= monthStart) {
      lastMonth.push(chat);
    } else {
      const monthYear = new Date(time).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      older[monthYear] ??= [];
      older[monthYear].push(chat);
    }
  }

  const sortedMonthYears = Object.keys(older).sort((a, b) => {
    const dateA = new Date(a).getTime();
    const dateB = new Date(b).getTime();
    return dateB - dateA;
  });

  const groups: ChatGroup[] = [];
  if (today.length)
    groups.push({ id: "today", labelKey: "sidebar.today", items: today });
  if (yesterday.length)
    groups.push({ id: "yesterday", labelKey: "sidebar.yesterday", items: yesterday });
  if (lastWeek.length)
    groups.push({ id: "last-week", labelKey: "sidebar.last7Days", items: lastWeek });
  if (lastMonth.length)
    groups.push({ id: "last-month", labelKey: "sidebar.last30Days", items: lastMonth });
  for (const monthYear of sortedMonthYears) {
    if (older[monthYear]?.length) {
      groups.push({ id: monthYear, label: monthYear, items: older[monthYear] });
    }
  }

  return groups;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = React.useState<ChatListItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  const fetchChats = React.useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const chatRepository = await getChatRepository();
      const data = (await chatRepository.listChats()) as ChatIndexEntry[];
      setChats(
        data.map((chat) => ({
          id: chat.id,
          label: chat.title || "Untitled",
          to: `/chat/${chat.id}`,
          createdAt: String(chat.createdAt),
        })),
      );
      return true;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to fetch chats:", error);
      }
      setChats([]);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const addChat = React.useCallback((item: ChatListItem) => {
    setChats((current) => [item, ...current]);
  }, []);

  const updateChat = React.useCallback(
    (id: string, partial: Partial<ChatListItem>) => {
      setChats((current) =>
        current.map((c) => (c.id === id ? { ...c, ...partial } : c)),
      );
    },
    [],
  );

  const removeChat = React.useCallback((id: string) => {
    setChats((current) => current.filter((c) => c.id !== id));
  }, []);

  const deleteAllChats = React.useCallback(async () => {
    const chatRepository = await getChatRepository();
    await chatRepository.deleteAllChats();
    setChats([]);
  }, []);

  const groups = React.useMemo(() => groupChats(chats), [chats]);

  const value = React.useMemo<ChatContextValue>(
    () => ({
      chats,
      groups,
      isLoading,
      fetchChats,
      addChat,
      updateChat,
      removeChat,
      deleteAllChats,
    }),
    [
      chats,
      groups,
      isLoading,
      fetchChats,
      addChat,
      updateChat,
      removeChat,
      deleteAllChats,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatContextValue {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error("useChatStore must be used inside a ChatProvider");
  }
  return context;
}
