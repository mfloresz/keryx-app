import type { ChatRecord, FavoriteMessageEntry } from "../domain/chat/types.js";

function getMessageTextContent(message: any): string {
  if (Array.isArray(message?.parts)) {
    return message.parts
      .filter(
        (part: any) => part?.type === "text" && typeof part.text === "string",
      )
      .map((part: any) => part.text)
      .join("");
  }

  return typeof message?.content === "string" ? message.content : "";
}

function toPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "[Empty message]";
  }
  return normalized.length > 220
    ? `${normalized.slice(0, 217)}...`
    : normalized;
}

function collectMessages(chat: ChatRecord): Map<string, any> {
  const messages = new Map<string, any>();

  const addMessage = (message: any) => {
    if (!message?.id || messages.has(message.id)) {
      return;
    }
    messages.set(message.id, message);
  };

  for (const message of chat.messages ?? []) {
    addMessage(message);
  }

  for (const branchState of Object.values(chat.branches ?? {})) {
    for (const snapshot of branchState.snapshots) {
      for (const message of snapshot.messages ?? []) {
        addMessage(message);
      }
    }
  }

  return messages;
}

export function getFavoriteMessagesFromChat(
  chat: ChatRecord,
): FavoriteMessageEntry[] {
  const upvotedMessageIds = new Set(
    (chat.votes ?? [])
      .filter(
        (vote: any) =>
          vote?.isUpvoted === true && typeof vote?.messageId === "string",
      )
      .map((vote: any) => vote.messageId),
  );

  if (upvotedMessageIds.size === 0) {
    return [];
  }

  const messagesById = collectMessages(chat);

  return Array.from(upvotedMessageIds)
    .map((messageId) => {
      const message = messagesById.get(messageId);
      if (!message || message.role !== "assistant") {
        return null;
      }

      return {
        chatId: chat.id,
        chatTitle: chat.title,
        chatCreatedAt: chat.createdAt,
        messageId,
        messagePreview: toPreview(getMessageTextContent(message)),
        messageCreatedAt:
          typeof message.createdAt === "string"
            ? message.createdAt
            : chat.createdAt,
      } satisfies FavoriteMessageEntry;
    })
    .filter((entry): entry is FavoriteMessageEntry => entry !== null)
    .sort(
      (a, b) =>
        new Date(b.messageCreatedAt).getTime() -
        new Date(a.messageCreatedAt).getTime(),
    );
}
