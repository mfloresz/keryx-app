export interface ChatBranchSnapshot {
  id: string;
  label: string;
  createdAt: string;
  messages: any[];
}

export interface ChatBranchState {
  rootMessageId: string;
  includeRoot: boolean;
  currentSnapshotId: string;
  snapshots: ChatBranchSnapshot[];
}

import type { LanguageModelUsage } from "ai";

export interface ChatRecord {
  id: string;
  title: string | null;
  visibility: "public" | "private";
  createdAt: string;
  messages: any[];
  votes: any[];
  webSearch?: boolean;
  lastUsage?: LanguageModelUsage;
  branches?: Record<string, ChatBranchState>;
}

export interface ChatIndexEntry {
  id: string;
  title: string | null;
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
