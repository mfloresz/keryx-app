/**
 * Chat Store (Pinia)
 *
 * Manages the global chat state including the list of chats,
 * grouping by date, and active chat operations.
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { isToday, isYesterday, subMonths } from "date-fns";
import type { ChatIndexEntry } from "@/domain/chat/types";
import i18n from "@/i18n";
import { getChatRepository } from "@/services/runtime";

export interface ChatListItem {
  id: string;
  label: string;
  to: string;
  createdAt: string;
}

export const useChatStore = defineStore("chat", () => {
  const { t } = i18n.global;

  // State
  const chats = ref<ChatListItem[]>([]);
  const isLoading = ref(false);

  // Actions
  async function fetchChats(): Promise<boolean> {
    isLoading.value = true;
    try {
      const chatRepository = await getChatRepository();
      const data = (await chatRepository.listChats()) as ChatIndexEntry[];
      chats.value = data.map((chat) => ({
        id: chat.id,
        label: chat.title || "Untitled",
        to: `/chat/${chat.id}`,
        createdAt: String(chat.createdAt),
      }));
      return true;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Failed to fetch chats:", error);
      }
      chats.value = [];
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  function addChat(item: ChatListItem) {
    chats.value.unshift(item);
  }

  function updateChat(id: string, partial: Partial<ChatListItem>) {
    chats.value = chats.value.map((c) =>
      c.id === id ? { ...c, ...partial } : c,
    );
  }

  function removeChat(id: string) {
    chats.value = chats.value.filter((c) => c.id !== id);
  }

  async function deleteAllChats() {
    const chatRepository = await getChatRepository();
    await chatRepository.deleteAllChats();
    chats.value = [];
  }

  // Getters
  const groups = computed(() => {
    const today: ChatListItem[] = [];
    const yesterday: ChatListItem[] = [];
    const lastWeek: ChatListItem[] = [];
    const lastMonth: ChatListItem[] = [];
    const older: Record<string, ChatListItem[]> = {};

    const oneWeekAgo = subMonths(new Date(), 0.25);
    const oneMonthAgo = subMonths(new Date(), 1);

    chats.value.forEach((chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        today.push(chat);
      } else if (isYesterday(chatDate)) {
        yesterday.push(chat);
      } else if (chatDate >= oneWeekAgo) {
        lastWeek.push(chat);
      } else if (chatDate >= oneMonthAgo) {
        lastMonth.push(chat);
      } else {
        const monthYear = chatDate.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

        if (!older[monthYear]) {
          older[monthYear] = [];
        }
        older[monthYear].push(chat);
      }
    });

    const sortedMonthYears = Object.keys(older).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateB.getTime() - dateA.getTime();
    });

    const formattedGroups = [] as Array<{
      id: string;
      label: string;
      items: ChatListItem[];
    }>;

    if (today.length) {
      formattedGroups.push({
        id: "today",
        label: t("sidebar.today"),
        items: today,
      });
    }
    if (yesterday.length) {
      formattedGroups.push({
        id: "yesterday",
        label: t("sidebar.yesterday"),
        items: yesterday,
      });
    }
    if (lastWeek.length) {
      formattedGroups.push({
        id: "last-week",
        label: t("sidebar.last7Days"),
        items: lastWeek,
      });
    }
    if (lastMonth.length) {
      formattedGroups.push({
        id: "last-month",
        label: t("sidebar.last30Days"),
        items: lastMonth,
      });
    }

    sortedMonthYears.forEach((monthYear) => {
      if (older[monthYear]?.length) {
        formattedGroups.push({
          id: monthYear,
          label: monthYear,
          items: older[monthYear],
        });
      }
    });

    return formattedGroups;
  });

  return {
    chats,
    groups,
    isLoading,
    fetchChats,
    addChat,
    updateChat,
    removeChat,
    deleteAllChats,
  };
});
