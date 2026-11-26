import type { LanguageModelUsage } from "ai";

export interface ChatBranchSnapshot {
  id: string;
  label: string;
  createdAt: string;
  messages: unknown[];
}

export interface ChatBranchState {
  rootMessageId: string;
  includeRoot: boolean;
  currentSnapshotId: string;
  snapshots: ChatBranchSnapshot[];
}

export interface ChatRecord {
  id: string;
  title: string | null;
  visibility: "public" | "private";
  createdAt: string;
  messages: unknown[];
  votes: unknown[];
  webSearch?: boolean;
  agentId?: string | null;
  preset?: string | null;
  projectId?: string | null;
  lastUsage?: LanguageModelUsage;
  branches?: Record<string, ChatBranchState>;
}

export interface ChatIndexEntry {
  id: string;
  title: string | null;
  visibility: "public" | "private";
  createdAt: string;
}

/** Read-only view of a shared chat, served to unauthenticated visitors. */
export interface PublicChatRecord {
  id: string;
  title: string;
  messages: unknown[];
  createdAt: string;
}

export interface FavoriteMessageEntry {
  chatId: string;
  chatTitle: string | null;
  chatCreatedAt: string;
  messageId: string;
  messagePreview: string;
  messageCreatedAt: string;
}

export interface AttachmentReference {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
}
