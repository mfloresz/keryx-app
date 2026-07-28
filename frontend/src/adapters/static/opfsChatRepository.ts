import type { ChatRepository } from "@/domain/chat/ports";

async function readJson<T>(response: Response): Promise<T> {
  if (typeof response.json !== "function") {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function assertResponse(
  response: Response,
  fallback: string,
): Promise<Response> {
  if (response.ok !== false) {
    return response;
  }

  const payload = await response.json().catch(() => null);
  const message =
    typeof payload?.message === "string" ? payload.message : fallback;
  throw new Error(message);
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  const headers =
    init?.body && !init.headers
      ? { "content-type": "application/json" }
      : init?.headers;
  if (!init && !headers) {
    return await fetch(input);
  }

  return await fetch(input, { ...init, headers });
}

export const opfsChatRepository: ChatRepository = {
  async listChats() {
    const response = await assertResponse(
      await request("/api/chats"),
      "Failed to list chats",
    );
    return await readJson(response);
  },

  async createChat(chat) {
    const response = await fetch("/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chat),
    });
    await assertResponse(response, "Failed to create chat");
  },

  async getChat(chatId) {
    const response = await request(`/api/chats/${chatId}`);
    if (response.status === 404) {
      return null;
    }
    return await readJson(
      await assertResponse(response, "Failed to load chat"),
    );
  },

  async deleteChat(chatId) {
    const response = await assertResponse(
      await request(`/api/chats/${chatId}`, { method: "DELETE" }),
      "Failed to delete chat",
    );
    await readJson(response);
  },

  async deleteAllChats() {
    const response = await assertResponse(
      await request("/api/chats", { method: "DELETE" }),
      "Failed to delete chats",
    );
    await readJson(response);
  },

  async updateTitle(chatId, title) {
    const response = await assertResponse(
      await request(`/api/chats/title/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
      "Failed to rename chat",
    );
    return await readJson(response);
  },

  async updateVisibility(chatId, visibility) {
    const response = await assertResponse(
      await request(`/api/chats/visibility/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility }),
      }),
      "Failed to update visibility",
    );
    return await readJson(response);
  },

  async deleteMessage(chatId, payload) {
    const response = await assertResponse(
      await request(`/api/chats/messages/${chatId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      }),
      "Failed to update message branch",
    );
    await readJson(response);
  },

  async switchBranch(chatId, payload) {
    const response = await assertResponse(
      await request(`/api/chats/branches/${chatId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      "Failed to switch branch",
    );
    return await readJson(response);
  },

  async listFavorites() {
    const response = await assertResponse(
      await request("/api/favorites"),
      "Failed to load favorites",
    );
    return await readJson(response);
  },

  async getVotes(chatId) {
    const response = await assertResponse(
      await request(`/api/chats/votes/${chatId}`),
      "Failed to load votes",
    );
    return await readJson(response);
  },

  async saveVote(chatId, payload) {
    const response = await assertResponse(
      await request(`/api/chats/votes/${chatId}`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      "Failed to save vote",
    );
    return await readJson(response);
  },
};
