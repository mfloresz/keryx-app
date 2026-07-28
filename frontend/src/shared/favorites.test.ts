import { describe, expect, it } from "vitest";
import { getFavoriteMessagesFromChat } from "./favorites";

describe("favorites aggregator", () => {
  it("assigns ids to messages that arrive without one before storage sanitization", async () => {
    const { sanitizeMessagesForStorage } = await import("./chatCore");
    const messages = sanitizeMessagesForStorage([
      {
        id: "",
        role: "assistant",
        parts: [{ type: "text", text: "missing id" }],
      },
    ] as any);

    expect(typeof messages[0].id).toBe("string");
    expect(messages[0].id.length).toBeGreaterThan(0);
  });

  it("includes upvoted assistant messages from branch snapshots when they are not in the active transcript", () => {
    const favorites = getFavoriteMessagesFromChat({
      id: "chat-1",
      title: "My Chat",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      messages: [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      votes: [{ messageId: "a1", isUpvoted: true }],
      branches: {
        u1: {
          rootMessageId: "u1",
          includeRoot: false,
          currentSnapshotId: "snap-2",
          snapshots: [
            {
              id: "snap-1",
              label: "Original",
              createdAt: "2026-01-01T00:01:00.000Z",
              messages: [
                {
                  id: "a1",
                  role: "assistant",
                  createdAt: "2026-01-01T00:02:00.000Z",
                  parts: [{ type: "text", text: "Favorite branch answer" }],
                },
              ],
            },
            {
              id: "snap-2",
              label: "Alternative",
              createdAt: "2026-01-01T00:03:00.000Z",
              messages: [
                {
                  id: "a2",
                  role: "assistant",
                  createdAt: "2026-01-01T00:04:00.000Z",
                  parts: [{ type: "text", text: "Current answer" }],
                },
              ],
            },
          ],
        },
      },
    } as any);

    expect(favorites).toEqual([
      {
        chatId: "chat-1",
        chatTitle: "My Chat",
        chatCreatedAt: "2026-01-01T00:00:00.000Z",
        messageId: "a1",
        messagePreview: "Favorite branch answer",
        messageCreatedAt: "2026-01-01T00:02:00.000Z",
      },
    ]);
  });
});
