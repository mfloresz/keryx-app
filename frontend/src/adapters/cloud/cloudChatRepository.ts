import type { ChatRepository } from "@/domain/chat/ports";
import { getAuthAdapter } from "@/services/runtime";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const auth = await getAuthAdapter();
  const headers = {
    "content-type": "application/json",
    ...(await auth.getAuthorizationHeaders()),
    ...(init?.headers ?? {}),
  };

  const response = await fetch(path, { ...init, headers });
  if (response.ok) {
    return response;
  }

  const payload = await response.json().catch(() => null);
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : `Request failed: ${path}`;
  throw new Error(message);
}

export const cloudChatRepository: ChatRepository = {
  async listChats() {
    return await readJson(await request("/api/chats"));
  },

  async createChat(chat) {
    await readJson(
      await request("/api/chats", {
        method: "POST",
        body: JSON.stringify(chat),
      }),
    );
  },

  async getChat(chatId) {
    const response = await fetch(`/api/chats/${chatId}`, {
      headers: await (await getAuthAdapter()).getAuthorizationHeaders(),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        typeof payload?.message === "string"
          ? payload.message
          : "Failed to load chat",
      );
    }
    return await readJson(response);
  },

  async deleteChat(chatId) {
    await readJson(await request(`/api/chats/${chatId}`, { method: "DELETE" }));
  },

  async deleteAllChats() {
    await readJson(await request("/api/chats", { method: "DELETE" }));
  },

  async updateTitle(chatId, title) {
    return await readJson(
      await request(`/api/chats/title/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    );
  },

  async updateVisibility(chatId, visibility) {
    return await readJson(
      await request(`/api/chats/visibility/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
    );
  },

  async deleteMessage(chatId, payload) {
    await readJson(
      await request(`/api/chats/messages/${chatId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      }),
    );
  },

  async switchBranch(chatId, payload) {
    return await readJson(
      await request(`/api/chats/branches/${chatId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  },

  async listFavorites() {
    return await readJson(await request("/api/favorites"));
  },

  async getVotes(chatId) {
    return await readJson(await request(`/api/chats/votes/${chatId}`));
  },

  async saveVote(chatId, payload) {
    return await readJson(
      await request(`/api/chats/votes/${chatId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  },
};
