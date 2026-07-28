import type { ChatRecord } from "@/domain/chat/types";
import type { ChatRepository } from "@/domain/chat/ports";
import { getAuthAdapter } from "@/services/runtime";

async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter();
  return await auth.getAuthorizationHeaders();
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    ...(await authHeaders()),
    ...(init?.headers ?? {}),
  };
  return fetch(path, { ...init, headers });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Request failed: ${response.url}`,
    );
  }
  return (await response.json()) as T;
}

export const apiChatRepository: ChatRepository = {
  async listChats() {
    return readJson(await apiFetch("/api/chats"));
  },

  async createChat(chat) {
    return readJson<ChatRecord>(
      await apiFetch("/api/chats", {
        method: "POST",
        body: JSON.stringify(chat),
      }),
    );
  },

  async getChat(chatId) {
    const response = await apiFetch(`/api/chats/${chatId}`);
    if (response.status === 404) return null;
    return readJson(response);
  },

  async deleteChat(chatId) {
    await readJson(
      await apiFetch(`/api/chats/${chatId}`, { method: "DELETE" }),
    );
  },

  async deleteAllChats() {
    await readJson(
      await apiFetch("/api/chats", { method: "DELETE" }),
    );
  },

  async updateTitle(chatId, title) {
    return readJson(
      await apiFetch(`/api/chats/${chatId}/title`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    );
  },

  async updateVisibility(chatId, visibility) {
    return readJson(
      await apiFetch(`/api/chats/${chatId}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    );
  },

  async deleteMessage(chatId, payload) {
    await readJson(
      await apiFetch(`/api/chats/${chatId}/messages`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      }),
    );
  },

  async switchBranch(chatId, payload) {
    return readJson(
      await apiFetch(`/api/chats/${chatId}/branches`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  },

  async listFavorites() {
    return readJson(await apiFetch("/api/favorites"));
  },

  async getVotes(chatId) {
    return readJson(await apiFetch(`/api/chats/${chatId}/votes`));
  },

  async saveVote(chatId, payload) {
    return readJson(
      await apiFetch(`/api/chats/${chatId}/votes`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  },
};
