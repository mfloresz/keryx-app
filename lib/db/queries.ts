import "server-only";

import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import type { UserRole, UserStatus } from "@/lib/auth/types";
import { chatModels, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { ChatbotError } from "../errors";
import type {
  Chat,
  DBMessage,
  Document,
  Suggestion,
  User,
  Vote,
} from "./schema";
import {
  createRecord,
  deleteRecord,
  findFirstRecord,
  getRecordById,
  hashValue,
  listAllRecords,
  updateRecord,
  userRequest,
  publicRequest,
  type PocketBaseAuthResponse,
} from "@/lib/pocketbase/server";

const COLLECTIONS = {
  users: "users",
  chats: "chats",
  messages: "messages",
  votes: "votes",
  documents: "documents",
  suggestions: "suggestions",
  streams: "streams",
  invites: "invites",
  settings: "app_settings",
} as const;

export type AIProvider = "vercel_gateway" | "opencode_go";

export type AISettings = {
  id: string;
  activeProvider: AIProvider;
  userAllowedModelIds: string[];
  updatedAt: string;
};

export type Invite = {
  id: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  createdBy: string;
};

type PBUserRecord = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: UserRole;
  status?: UserStatus;
  created: string;
  updated: string;
};

type PBChatRecord = {
  id: string;
  chat_id: string;
  title: string;
  user: string;
  visibility: VisibilityType;
  created: string;
};

type PBMessageRecord = {
  id: string;
  message_id: string;
  chat: string;
  role: string;
  parts: unknown;
  attachments: unknown;
  created: string;
};

type PBVoteRecord = {
  id: string;
  chat_id: string;
  message_id: string;
  is_upvoted: boolean;
};

type PBDocumentRecord = {
  id: string;
  document_id: string;
  title: string;
  content: string | null;
  kind: "text" | "code" | "image" | "sheet";
  user: string;
  created: string;
};

type PBSuggestionRecord = {
  id: string;
  suggestion_id: string;
  document_id: string;
  document_created_at: string;
  original_text: string;
  suggested_text: string;
  description?: string | null;
  is_resolved: boolean;
  user: string;
  created: string;
};

type PBStreamRecord = {
  id: string;
  stream_id: string;
  chat_id: string;
  created: string;
};

type PBInviteRecord = {
  id: string;
  email: string;
  role: UserRole;
  token_hash: string;
  expires_at: string;
  used_at?: string | null;
  created_by: string;
  created: string;
};

type PBSettingsRecord = {
  id: string;
  slug: string;
  active_provider: AIProvider;
  user_allowed_models: string[];
  updated: string;
};

type RegisterInviteResult = {
  session: {
    token: string;
    user: User;
  };
  invite: Invite;
};

function escapeFilterValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function mapUser(record: PBUserRecord): User {
  return {
    id: record.id,
    email: record.email,
    name: record.name ?? null,
    image: record.image ?? null,
    role: record.role ?? "user",
    status: record.status ?? "active",
    createdAt: record.created,
    updatedAt: record.updated,
  };
}

function mapChat(record: PBChatRecord): Chat {
  return {
    id: record.chat_id,
    createdAt: record.created,
    title: record.title,
    userId: record.user,
    visibility: record.visibility,
  };
}

function mapMessage(record: PBMessageRecord): DBMessage {
  return {
    id: record.message_id,
    chatId: record.chat,
    role: record.role,
    parts: record.parts,
    attachments: record.attachments,
    createdAt: new Date(record.created),
  };
}

function mapVote(record: PBVoteRecord): Vote {
  return {
    chatId: record.chat_id,
    messageId: record.message_id,
    isUpvoted: record.is_upvoted,
  };
}

function mapDocument(record: PBDocumentRecord): Document {
  return {
    id: record.document_id,
    createdAt: new Date(record.created),
    title: record.title,
    content: record.content,
    kind: record.kind,
    userId: record.user,
  };
}

function mapSuggestion(record: PBSuggestionRecord): Suggestion {
  return {
    id: record.suggestion_id,
    documentId: record.document_id,
    documentCreatedAt: new Date(record.document_created_at),
    originalText: record.original_text,
    suggestedText: record.suggested_text,
    description: record.description ?? null,
    isResolved: record.is_resolved,
    userId: record.user,
    createdAt: new Date(record.created),
  };
}

function mapInvite(record: PBInviteRecord): Invite {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    expiresAt: record.expires_at,
    usedAt: record.used_at ?? null,
    createdAt: record.created,
    createdBy: record.created_by,
  };
}

function mapSettings(record: PBSettingsRecord): AISettings {
  return {
    id: record.id,
    activeProvider: record.active_provider,
    userAllowedModelIds: record.user_allowed_models ?? [DEFAULT_CHAT_MODEL],
    updatedAt: record.updated,
  };
}

async function getChatRecordByExternalId(chatId: string) {
  return findFirstRecord<PBChatRecord>(
    COLLECTIONS.chats,
    `chat_id = "${escapeFilterValue(chatId)}"`,
  );
}

async function getMessageRecordByExternalId(messageId: string) {
  return findFirstRecord<PBMessageRecord>(
    COLLECTIONS.messages,
    `message_id = "${escapeFilterValue(messageId)}"`,
  );
}

async function getInviteRecordByToken(token: string) {
  const tokenHash = await hashValue(token);

  return findFirstRecord<PBInviteRecord>(
    COLLECTIONS.invites,
    `token_hash = "${tokenHash}"`,
  );
}

async function getSettingsRecord() {
  return findFirstRecord<PBSettingsRecord>(
    COLLECTIONS.settings,
    `slug = "global"`,
  );
}

async function ensureSettingsRecord() {
  const existing = await getSettingsRecord();

  if (existing) {
    return existing;
  }

  return createRecord<PBSettingsRecord>(COLLECTIONS.settings, {
    slug: "global",
    active_provider: "vercel_gateway",
    user_allowed_models: chatModels.map((model) => model.id),
  });
}

export async function getUser(email: string): Promise<User[]> {
  try {
    const users = await listAllRecords<PBUserRecord>(
      COLLECTIONS.users,
      new URLSearchParams({
        filter: `email = "${escapeFilterValue(email)}"`,
      }),
    );

    return users.items.map(mapUser);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email",
    );
  }
}

export async function getUserById(id: string): Promise<User | null> {
  try {
    const user = await getRecordById<PBUserRecord>(COLLECTIONS.users, id);
    return mapUser(user);
  } catch (_error) {
    return null;
  }
}

export async function createUser(email: string, password: string) {
  try {
    const created = await createRecord<PBUserRecord>(COLLECTIONS.users, {
      email,
      password,
      passwordConfirm: password,
      role: "user",
      status: "active",
      emailVisibility: false,
      verified: true,
    });

    return mapUser(created);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }
}

export async function authenticateUser(email: string, password: string) {
  try {
    const response = await publicRequest<PocketBaseAuthResponse<PBUserRecord>>(
      `/api/collections/${COLLECTIONS.users}/auth-with-password`,
      {
        method: "POST",
        body: JSON.stringify({ identity: email, password }),
      },
    );

    const user = mapUser(response.record);

    if (user.status !== "active") {
      throw new Error("Account disabled");
    }

    return {
      token: response.token,
      user,
    };
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to authenticate");
  }
}

export async function refreshUserSession(token: string) {
  try {
    const response = await userRequest<PocketBaseAuthResponse<PBUserRecord>>(
      token,
      `/api/collections/${COLLECTIONS.users}/auth-refresh`,
      {
        method: "POST",
      },
    );

    const user = mapUser(response.record);

    if (user.status !== "active") {
      return null;
    }

    return {
      token: response.token,
      user,
    };
  } catch (_error) {
    return null;
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    const existing = await getChatRecordByExternalId(id);

    if (existing) {
      return mapChat(existing);
    }

    const record = await createRecord<PBChatRecord>(COLLECTIONS.chats, {
      chat_id: id,
      title,
      user: userId,
      visibility,
    });

    return mapChat(record);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    const chatRecord = await getChatRecordByExternalId(id);

    if (!chatRecord) {
      return null;
    }

    const [votes, messages, streams] = await Promise.all([
      listAllRecords<PBVoteRecord>(
        COLLECTIONS.votes,
        new URLSearchParams({
          filter: `chat_id = "${escapeFilterValue(id)}"`,
        }),
      ),
      listAllRecords<PBMessageRecord>(
        COLLECTIONS.messages,
        new URLSearchParams({
          filter: `chat = "${escapeFilterValue(id)}"`,
        }),
      ),
      listAllRecords<PBStreamRecord>(
        COLLECTIONS.streams,
        new URLSearchParams({
          filter: `chat_id = "${escapeFilterValue(id)}"`,
        }),
      ),
    ]);

    await Promise.all([
      ...votes.items.map((record) =>
        deleteRecord(COLLECTIONS.votes, record.id),
      ),
      ...messages.items.map((record) =>
        deleteRecord(COLLECTIONS.messages, record.id),
      ),
      ...streams.items.map((record) =>
        deleteRecord(COLLECTIONS.streams, record.id),
      ),
    ]);

    await deleteRecord(COLLECTIONS.chats, chatRecord.id);

    return mapChat(chatRecord);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id",
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const chats = await listAllRecords<PBChatRecord>(
      COLLECTIONS.chats,
      new URLSearchParams({
        filter: `user = "${escapeFilterValue(userId)}"`,
      }),
    );

    for (const chat of chats.items) {
      await deleteChatById({ id: chat.chat_id });
    }

    return { deletedCount: chats.items.length };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id",
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const filters = [`user = "${escapeFilterValue(id)}"`];

    if (startingAfter) {
      const selected = await getChatById({ id: startingAfter });
      if (!selected) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`,
        );
      }
      filters.push(`created > "${selected.createdAt}"`);
    }

    if (endingBefore) {
      const selected = await getChatById({ id: endingBefore });
      if (!selected) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`,
        );
      }
      filters.push(`created < "${selected.createdAt}"`);
    }

    const result = await listAllRecords<PBChatRecord>(
      COLLECTIONS.chats,
      new URLSearchParams({
        filter: filters.join(" && "),
        sort: "-created",
        perPage: String(limit + 1),
      }),
    );

    const chats = result.items.map(mapChat);
    const hasMore = chats.length > limit;

    return {
      chats: hasMore ? chats.slice(0, limit) : chats,
      hasMore,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }

    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id",
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const chat = await getChatRecordByExternalId(id);
    return chat ? mapChat(chat) : null;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({
  messages,
  userId,
}: {
  messages: DBMessage[];
  userId: string;
}) {
  try {
    return Promise.all(
      messages.map((currentMessage) =>
        createRecord<PBMessageRecord>(COLLECTIONS.messages, {
          message_id: currentMessage.id,
          chat: currentMessage.chatId,
          user: userId,
          role: currentMessage.role,
          parts: currentMessage.parts,
          attachments: currentMessage.attachments,
          created: currentMessage.createdAt.toISOString(),
        }),
      ),
    );
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    const existing = await getMessageRecordByExternalId(id);

    if (!existing) {
      return null;
    }

    return updateRecord<PBMessageRecord>(COLLECTIONS.messages, existing.id, {
      parts,
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to update message");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    const result = await listAllRecords<PBMessageRecord>(
      COLLECTIONS.messages,
      new URLSearchParams({
        filter: `chat = "${escapeFilterValue(id)}"`,
        sort: "created",
      }),
    );

    return result.items.map(mapMessage);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id",
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const existing = await findFirstRecord<PBVoteRecord>(
      COLLECTIONS.votes,
      `chat_id = "${escapeFilterValue(chatId)}" && message_id = "${escapeFilterValue(messageId)}"`,
    );

    if (existing) {
      return updateRecord<PBVoteRecord>(COLLECTIONS.votes, existing.id, {
        is_upvoted: type === "up",
      });
    }

    return createRecord<PBVoteRecord>(COLLECTIONS.votes, {
      chat_id: chatId,
      message_id: messageId,
      is_upvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    const result = await listAllRecords<PBVoteRecord>(
      COLLECTIONS.votes,
      new URLSearchParams({
        filter: `chat_id = "${escapeFilterValue(id)}"`,
      }),
    );

    return result.items.map(mapVote);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id",
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    const record = await createRecord<PBDocumentRecord>(COLLECTIONS.documents, {
      document_id: id,
      title,
      kind,
      content,
      user: userId,
    });

    return mapDocument(record);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save document");
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  try {
    const latest = await findFirstRecord<PBDocumentRecord>(
      COLLECTIONS.documents,
      `document_id = "${escapeFilterValue(id)}"`,
      "-created",
    );

    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return updateRecord<PBDocumentRecord>(COLLECTIONS.documents, latest.id, {
      content,
    });
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }

    throw new ChatbotError(
      "bad_request:database",
      "Failed to update document content",
    );
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const result = await listAllRecords<PBDocumentRecord>(
      COLLECTIONS.documents,
      new URLSearchParams({
        filter: `document_id = "${escapeFilterValue(id)}"`,
        sort: "created",
      }),
    );

    return result.items.map(mapDocument);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get documents by id",
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const record = await findFirstRecord<PBDocumentRecord>(
      COLLECTIONS.documents,
      `document_id = "${escapeFilterValue(id)}"`,
      "-created",
    );

    return record ? mapDocument(record) : null;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document by id",
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    const [suggestions, documents] = await Promise.all([
      listAllRecords<PBSuggestionRecord>(
        COLLECTIONS.suggestions,
        new URLSearchParams({
          filter: `document_id = "${escapeFilterValue(id)}" && document_created_at > "${timestamp.toISOString()}"`,
        }),
      ),
      listAllRecords<PBDocumentRecord>(
        COLLECTIONS.documents,
        new URLSearchParams({
          filter: `document_id = "${escapeFilterValue(id)}" && created > "${timestamp.toISOString()}"`,
        }),
      ),
    ]);

    await Promise.all([
      ...suggestions.items.map((record) =>
        deleteRecord(COLLECTIONS.suggestions, record.id),
      ),
      ...documents.items.map((record) =>
        deleteRecord(COLLECTIONS.documents, record.id),
      ),
    ]);

    return documents.items.map(mapDocument);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp",
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return Promise.all(
      suggestions.map((suggestion) =>
        createRecord<PBSuggestionRecord>(COLLECTIONS.suggestions, {
          suggestion_id: suggestion.id,
          document_id: suggestion.documentId,
          document_created_at: suggestion.documentCreatedAt.toISOString(),
          original_text: suggestion.originalText,
          suggested_text: suggestion.suggestedText,
          description: suggestion.description,
          is_resolved: suggestion.isResolved,
          user: suggestion.userId,
          created: suggestion.createdAt.toISOString(),
        }),
      ),
    );
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save suggestions",
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    const result = await listAllRecords<PBSuggestionRecord>(
      COLLECTIONS.suggestions,
      new URLSearchParams({
        filter: `document_id = "${escapeFilterValue(documentId)}"`,
      }),
    );

    return result.items.map(mapSuggestion);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id",
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const record = await getMessageRecordByExternalId(id);
    return record ? [mapMessage(record)] : [];
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id",
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messages = await listAllRecords<PBMessageRecord>(
      COLLECTIONS.messages,
      new URLSearchParams({
        filter: `chat = "${escapeFilterValue(chatId)}" && created >= "${timestamp.toISOString()}"`,
      }),
    );

    const messageIds = messages.items.map((record) => record.message_id);

    if (messageIds.length > 0) {
      const voteFilters = messageIds
        .map((messageId) => `message_id = "${escapeFilterValue(messageId)}"`)
        .join(" || ");

      const votes = await listAllRecords<PBVoteRecord>(
        COLLECTIONS.votes,
        new URLSearchParams({
          filter: `chat_id = "${escapeFilterValue(chatId)}" && (${voteFilters})`,
        }),
      );

      await Promise.all([
        ...votes.items.map((record) =>
          deleteRecord(COLLECTIONS.votes, record.id),
        ),
        ...messages.items.map((record) =>
          deleteRecord(COLLECTIONS.messages, record.id),
        ),
      ]);
    }
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp",
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    const chat = await getChatRecordByExternalId(chatId);

    if (!chat) {
      return null;
    }

    return updateRecord<PBChatRecord>(COLLECTIONS.chats, chat.id, {
      visibility,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id",
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    const chat = await getChatRecordByExternalId(chatId);

    if (!chat) {
      return null;
    }

    return updateRecord<PBChatRecord>(COLLECTIONS.chats, chat.id, { title });
  } catch (_error) {
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000,
    ).toISOString();

    const result = await listAllRecords<PBMessageRecord>(
      COLLECTIONS.messages,
      new URLSearchParams({
        filter: `user = "${escapeFilterValue(id)}" && created >= "${cutoffTime}" && role = "user"`,
      }),
    );

    return result.items.length;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id",
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await createRecord<PBStreamRecord>(COLLECTIONS.streams, {
      stream_id: streamId,
      chat_id: chatId,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create stream id",
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const result = await listAllRecords<PBStreamRecord>(
      COLLECTIONS.streams,
      new URLSearchParams({
        filter: `chat_id = "${escapeFilterValue(chatId)}"`,
        sort: "created",
      }),
    );

    return result.items.map((record) => record.stream_id);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get stream ids by chat id",
    );
  }
}

export async function getAiSettings() {
  try {
    const record = await ensureSettingsRecord();
    return mapSettings(record);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get AI settings");
  }
}

export async function updateAiSettings({
  activeProvider,
  userAllowedModelIds,
}: {
  activeProvider: AIProvider;
  userAllowedModelIds: string[];
}) {
  try {
    const record = await ensureSettingsRecord();

    const updated = await updateRecord<PBSettingsRecord>(
      COLLECTIONS.settings,
      record.id,
      {
        active_provider: activeProvider,
        user_allowed_models: userAllowedModelIds,
      },
    );

    return mapSettings(updated);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update AI settings",
    );
  }
}

export async function listUsersForAdmin() {
  try {
    const result = await listAllRecords<PBUserRecord>(
      COLLECTIONS.users,
      new URLSearchParams({ sort: "email" }),
    );

    return result.items.map(mapUser);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to list users");
  }
}

export async function setUserStatusById({
  userId,
  status,
}: {
  userId: string;
  status: UserStatus;
}) {
  try {
    const updated = await updateRecord<PBUserRecord>(
      COLLECTIONS.users,
      userId,
      { status },
    );

    return mapUser(updated);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update user status",
    );
  }
}

export async function deleteUserByIdAdmin({ userId }: { userId: string }) {
  try {
    await deleteAllChatsByUserId({ userId });

    const [documents, suggestions] = await Promise.all([
      listAllRecords<PBDocumentRecord>(
        COLLECTIONS.documents,
        new URLSearchParams({
          filter: `user = "${escapeFilterValue(userId)}"`,
        }),
      ),
      listAllRecords<PBSuggestionRecord>(
        COLLECTIONS.suggestions,
        new URLSearchParams({
          filter: `user = "${escapeFilterValue(userId)}"`,
        }),
      ),
    ]);

    await Promise.all([
      ...documents.items.map((record) =>
        deleteRecord(COLLECTIONS.documents, record.id),
      ),
      ...suggestions.items.map((record) =>
        deleteRecord(COLLECTIONS.suggestions, record.id),
      ),
    ]);

    await deleteRecord(COLLECTIONS.users, userId);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to delete user");
  }
}

export async function createInvite({
  email,
  role,
  expiresAt,
  createdBy,
}: {
  email: string;
  role: UserRole;
  expiresAt: string;
  createdBy: string;
}) {
  try {
    const token = crypto.randomUUID();
    const tokenHash = await hashValue(token);

    const existingInvites = await listAllRecords<PBInviteRecord>(
      COLLECTIONS.invites,
      new URLSearchParams({
        filter: `email = "${escapeFilterValue(email)}" && used_at = ""`,
      }),
    );

    await Promise.all(
      existingInvites.items.map((invite) =>
        updateRecord<PBInviteRecord>(COLLECTIONS.invites, invite.id, {
          used_at: new Date().toISOString(),
        }),
      ),
    );

    const record = await createRecord<PBInviteRecord>(COLLECTIONS.invites, {
      email,
      role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: createdBy,
    });

    return {
      invite: mapInvite(record),
      token,
    };
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create invite");
  }
}

export async function listInvitesForAdmin() {
  try {
    const result = await listAllRecords<PBInviteRecord>(
      COLLECTIONS.invites,
      new URLSearchParams({ sort: "-created" }),
    );

    return result.items.map(mapInvite);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to list invites");
  }
}

export async function getInviteByToken(token: string) {
  try {
    const invite = await getInviteRecordByToken(token);

    if (!invite) {
      return null;
    }

    return mapInvite(invite);
  } catch (_error) {
    return null;
  }
}

export async function registerUserFromInvite({
  token,
  password,
}: {
  token: string;
  password: string;
}): Promise<RegisterInviteResult> {
  try {
    const inviteRecord = await getInviteRecordByToken(token);

    if (!inviteRecord) {
      throw new ChatbotError("bad_request:database", "Invite not found");
    }

    const invite = mapInvite(inviteRecord);

    if (invite.usedAt) {
      throw new ChatbotError("bad_request:database", "Invite already used");
    }

    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new ChatbotError("bad_request:database", "Invite expired");
    }

    const existingUsers = await getUser(invite.email);

    let user = existingUsers[0];

    if (!user) {
      user = await createUser(invite.email, password);
      await updateRecord<PBUserRecord>(COLLECTIONS.users, user.id, {
        role: invite.role,
        status: "active",
      });
      user = (await getUserById(user.id)) as User;
    }

    if (!user || user.status !== "active") {
      throw new ChatbotError("bad_request:database", "User is not active");
    }

    await updateRecord<PBInviteRecord>(COLLECTIONS.invites, invite.id, {
      used_at: new Date().toISOString(),
    });

    const session = await authenticateUser(invite.email, password);

    return {
      session,
      invite,
    };
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }

    throw new ChatbotError(
      "bad_request:database",
      "Failed to register user from invite",
    );
  }
}
