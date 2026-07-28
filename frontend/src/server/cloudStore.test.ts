import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const selectRows = vi.fn();
const insertRows = vi.fn();
const updateRows = vi.fn();
const deleteRows = vi.fn();

vi.mock("./supabaseRest.js", () => ({
  selectRows,
  insertRows,
  updateRows,
  deleteRows,
}));

describe("cloudStore", () => {
  beforeEach(() => {
    vi.resetModules();
    selectRows.mockReset();
    insertRows.mockReset();
    updateRows.mockReset();
    deleteRows.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats persisted metadata columns as the source of truth when reading chats", async () => {
    selectRows.mockResolvedValueOnce([
      {
        id: "chat-1",
        owner_id: "user-1",
        title: "Fresh title",
        visibility: "public",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:05:00.000Z",
        data: {
          id: "stale-id",
          title: "Old title",
          visibility: "private",
          createdAt: "2025-12-31T23:59:59.000Z",
          messages: [],
          votes: [],
        },
      },
    ]);

    const { getChatStorage } = await import("./cloudStore.js");
    const storage = await getChatStorage();
    const chat = await storage.getChat("chat-1", "user-1");

    expect(chat).toEqual({
      id: "chat-1",
      title: "Fresh title",
      visibility: "public",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      votes: [],
    });
  });

  it("updates title without rewriting the full chat payload", async () => {
    updateRows.mockResolvedValueOnce([
      {
        id: "chat-1",
        owner_id: "user-1",
        title: "Renamed",
        visibility: "private",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:05:00.000Z",
        data: {
          id: "chat-1",
          title: "Old title",
          visibility: "private",
          createdAt: "2026-01-01T00:00:00.000Z",
          messages: [{ id: "m1" }],
          votes: [],
        },
      },
    ]);

    const { getChatStorage } = await import("./cloudStore.js");
    const storage = await getChatStorage();
    const chat = await storage.updateTitle("chat-1", "user-1", "Renamed");

    expect(updateRows).toHaveBeenCalledWith(
      "keryx_chats",
      {
        id: "eq.chat-1",
        owner_id: "eq.user-1",
      },
      expect.objectContaining({
        title: "Renamed",
      }),
    );
    expect(chat).toEqual({
      id: "chat-1",
      title: "Renamed",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [{ id: "m1" }],
      votes: [],
    });
    expect(insertRows).not.toHaveBeenCalled();
  });

  it("updates chat content without touching title or visibility columns", async () => {
    updateRows.mockResolvedValueOnce([]);

    const { getChatStorage } = await import("./cloudStore.js");
    const storage = await getChatStorage();
    await storage.saveChatContent(
      {
        id: "chat-1",
        title: "Stale local title",
        visibility: "public",
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "m1" }],
        votes: [{ messageId: "m1", isUpvoted: true }],
      },
      "user-1",
    );

    expect(updateRows).toHaveBeenCalledWith(
      "keryx_chats",
      {
        id: "eq.chat-1",
        owner_id: "eq.user-1",
      },
      expect.objectContaining({
        data: {
          id: "chat-1",
          title: "Stale local title",
          visibility: "public",
          createdAt: "2026-01-01T00:00:00.000Z",
          messages: [{ id: "m1" }],
          votes: [{ messageId: "m1", isUpvoted: true }],
        },
      }),
    );
    const payload = updateRows.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("visibility");
    expect(insertRows).not.toHaveBeenCalled();
  });

  it("only applies generated titles when the persisted title is still empty", async () => {
    updateRows.mockResolvedValueOnce([]);

    const { getChatStorage } = await import("./cloudStore.js");
    const storage = await getChatStorage();
    await storage.updateGeneratedTitle("chat-1", "user-1", "Generated");

    expect(updateRows).toHaveBeenCalledWith(
      "keryx_chats",
      {
        id: "eq.chat-1",
        owner_id: "eq.user-1",
        or: "(title.is.null,title.eq.)",
      },
      expect.objectContaining({
        title: "Generated",
      }),
    );
  });
});
