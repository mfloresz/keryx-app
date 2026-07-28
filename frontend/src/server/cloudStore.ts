import type {
  ChatIndexEntry,
  ChatRecord,
  FavoriteMessageEntry,
} from "../domain/chat/types.js";
import {
  deleteRows,
  insertRows,
  selectRows,
  updateRows,
} from "./supabaseRest.js";
import { getFavoriteMessagesFromChat } from "../shared/favorites.js";

export interface ChatStorage {
  listChats(ownerId: string): Promise<ChatIndexEntry[]>;
  getChat(chatId: string, ownerId: string): Promise<ChatRecord | null>;
  listFavorites(ownerId: string): Promise<FavoriteMessageEntry[]>;
  saveChat(chat: ChatRecord, ownerId: string): Promise<void>;
  saveChatContent(chat: ChatRecord, ownerId: string): Promise<void>;
  updateTitle(
    chatId: string,
    ownerId: string,
    title: string | null,
  ): Promise<ChatRecord | null>;
  updateGeneratedTitle(
    chatId: string,
    ownerId: string,
    title: string,
  ): Promise<void>;
  updateVisibility(
    chatId: string,
    ownerId: string,
    visibility: ChatRecord["visibility"],
  ): Promise<ChatRecord | null>;
  deleteChat(chatId: string, ownerId: string): Promise<void>;
  deleteAllChats(ownerId: string): Promise<void>;
}

interface ChatRow {
  id: string;
  owner_id: string;
  title: string | null;
  visibility: "public" | "private";
  created_at: string;
  updated_at: string;
  data: ChatRecord;
}

const TABLE = "keryx_chats";

function mapChatRow(row: ChatRow): ChatRecord {
  return {
    ...row.data,
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    createdAt: row.created_at,
  };
}

export async function getChatStorage(): Promise<ChatStorage> {
  return {
    async listChats(ownerId?: string) {
      const rows = await selectRows<ChatRow>(TABLE, {
        select: "id,title,created_at,updated_at",
        owner_id: `eq.${ownerId}`,
        order: "created_at.desc",
      });
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
      }));
    },

    async getChat(chatId: string, ownerId?: string) {
      const rows = await selectRows<ChatRow>(TABLE, {
        select: "id,owner_id,title,visibility,created_at,updated_at,data",
        id: `eq.${chatId}`,
        owner_id: `eq.${ownerId}`,
        limit: "1",
      });
      const row = rows[0];
      return row ? mapChatRow(row) : null;
    },

    async listFavorites(ownerId: string) {
      const rows = await selectRows<ChatRow>(TABLE, {
        select: "id,title,created_at,data",
        owner_id: `eq.${ownerId}`,
        order: "created_at.desc",
      });

      return rows
        .flatMap((row) =>
          getFavoriteMessagesFromChat({
            ...row.data,
            id: row.id,
            title: row.title,
            createdAt: row.created_at,
          }),
        )
        .sort(
          (a, b) =>
            new Date(b.messageCreatedAt).getTime() -
            new Date(a.messageCreatedAt).getTime(),
        );
    },

    async saveChat(chat: ChatRecord, ownerId?: string) {
      const now = new Date().toISOString();
      await insertRows<ChatRow>(
        TABLE,
        {
          id: chat.id,
          owner_id: ownerId,
          title: chat.title,
          visibility: chat.visibility,
          created_at: chat.createdAt,
          updated_at: now,
          data: chat,
        },
        { upsert: true, onConflict: "id" },
      );
    },

    async saveChatContent(chat: ChatRecord, ownerId: string) {
      await updateRows<ChatRow>(
        TABLE,
        {
          id: `eq.${chat.id}`,
          owner_id: `eq.${ownerId}`,
        },
        {
          data: chat,
          updated_at: new Date().toISOString(),
        },
      );
    },

    async updateTitle(chatId: string, ownerId: string, title: string | null) {
      const rows = await updateRows<ChatRow>(
        TABLE,
        {
          id: `eq.${chatId}`,
          owner_id: `eq.${ownerId}`,
        },
        {
          title,
          updated_at: new Date().toISOString(),
        },
      );
      const row = rows[0];
      return row ? mapChatRow(row) : null;
    },

    async updateGeneratedTitle(chatId: string, ownerId: string, title: string) {
      await updateRows<ChatRow>(
        TABLE,
        {
          id: `eq.${chatId}`,
          owner_id: `eq.${ownerId}`,
          or: "(title.is.null,title.eq.)",
        },
        {
          title,
          updated_at: new Date().toISOString(),
        },
      );
    },

    async updateVisibility(
      chatId: string,
      ownerId: string,
      visibility: ChatRecord["visibility"],
    ) {
      const rows = await updateRows<ChatRow>(
        TABLE,
        {
          id: `eq.${chatId}`,
          owner_id: `eq.${ownerId}`,
        },
        {
          visibility,
          updated_at: new Date().toISOString(),
        },
      );
      const row = rows[0];
      return row ? mapChatRow(row) : null;
    },

    async deleteChat(chatId: string, ownerId?: string) {
      await deleteRows(TABLE, {
        id: `eq.${chatId}`,
        owner_id: `eq.${ownerId}`,
      });
    },

    async deleteAllChats(ownerId?: string) {
      await deleteRows(TABLE, {
        owner_id: `eq.${ownerId}`,
      });
    },
  };
}
