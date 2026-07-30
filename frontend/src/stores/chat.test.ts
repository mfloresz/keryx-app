import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "./chat";

describe("chat store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    globalThis.fetch = vi.fn();
  });

  it("fetchChats carga y transforma los chats desde /api/chats", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "1",
          title: "Hola",
          createdAt: "2024-01-15T10:00:00Z",
          messages: [],
          votes: [],
          visibility: "private",
        },
      ],
    });
    globalThis.fetch = mockFetch;

    const store = useChatStore();
    await store.fetchChats();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chats",
      expect.objectContaining({
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );
    expect(store.chats).toHaveLength(1);
    expect(store.chats[0]).toEqual({
      id: "1",
      label: "Hola",
      to: "/chat/1",
      createdAt: "2024-01-15T10:00:00Z",
    });
  });

  it("groups agrupa chats por fecha", () => {
    const now = Date.now();
    const store = useChatStore();
    store.chats = [
      {
        id: "1",
        label: "Hoy",
        to: "/chat/1",
        createdAt: new Date(now).toISOString(),
      },
      {
        id: "2",
        label: "Ayer",
        to: "/chat/2",
        createdAt: new Date(now - 86400000).toISOString(),
      },
      {
        id: "3",
        label: "Hace 40 días",
        to: "/chat/3",
        createdAt: new Date(now - 86400000 * 40).toISOString(),
      },
    ];

    const groups = store.groups;
    expect(groups.find((g) => g.id === "today")?.items).toHaveLength(1);
    expect(groups.find((g) => g.id === "yesterday")?.items).toHaveLength(1);

    // El chat de hace 40 días debe estar en algún grupo "older"
    const olderGroup = groups.find(
      (g) => !["today", "yesterday", "last-week", "last-month"].includes(g.id),
    );
    expect(olderGroup!.items).toHaveLength(1);
    expect(olderGroup!.items[0]!.id).toBe("3");
  });

  it("updateChat modifica solo el chat indicado", () => {
    const store = useChatStore();
    store.chats = [
      { id: "1", label: "A", to: "/chat/1", createdAt: "2024-01-01" },
      { id: "2", label: "B", to: "/chat/2", createdAt: "2024-01-01" },
    ];
    store.updateChat("1", { label: "Nuevo" });
    expect(store.chats[0]!.label).toBe("Nuevo");
    expect(store.chats[1]!.label).toBe("B");
  });

  it("removeChat elimina el chat del estado", () => {
    const store = useChatStore();
    store.chats = [
      { id: "1", label: "A", to: "/chat/1", createdAt: "2024-01-01" },
    ];
    store.removeChat("1");
    expect(store.chats).toHaveLength(0);
  });

  it("deleteAllChats limpia el estado tras llamar al API", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    const store = useChatStore();
    store.chats = [
      { id: "1", label: "A", to: "/chat/1", createdAt: "2024-01-01" },
    ];
    await store.deleteAllChats();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chats",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(store.chats).toHaveLength(0);
  });
});
