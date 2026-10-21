import type { ChatIndexEntry, ChatRecord, FavoriteMessageEntry } from "./types";

export interface DeleteMessageRequest {
  messageId: string;
  type: "edit" | "regenerate";
}

export interface BranchSelectionRequest {
  rootMessageId: string;
  snapshotId: string;
}

export interface VoteRequest {
  messageId: string;
  isUpvoted?: boolean;
}

export interface ChatVote {
  messageId: string;
  isUpvoted: boolean;
}

export interface ChatRepository {
  listChats(): Promise<ChatIndexEntry[]>;
  createChat(chat: ChatRecord): Promise<ChatRecord>;
  getChat(chatId: string): Promise<ChatRecord | null>;
  deleteChat(chatId: string): Promise<void>;
  deleteAllChats(): Promise<void>;
  updateTitle(chatId: string, title: string | null): Promise<ChatRecord>;
  updateVisibility(
    chatId: string,
    visibility: ChatRecord["visibility"],
  ): Promise<ChatRecord>;
  deleteMessage(chatId: string, request: DeleteMessageRequest): Promise<void>;
  switchBranch(
    chatId: string,
    request: BranchSelectionRequest,
  ): Promise<ChatRecord>;
  forkChat(chatId: string, messageId: string): Promise<ChatRecord>;
  updatePreset(chatId: string, preset: string): Promise<ChatRecord>;
  updateAgent(chatId: string, agentId: string | null): Promise<ChatRecord>;
  updateProject(chatId: string, projectId: string | null): Promise<ChatRecord>;
  listFavorites(): Promise<FavoriteMessageEntry[]>;
  getVotes(chatId: string): Promise<ChatVote[]>;
  saveVote(
    chatId: string,
    request: VoteRequest,
  ): Promise<Record<string, unknown>>;
}

export interface AttachmentFilePayload {
  /** Raw bytes, present only for files that still need uploading. */
  file?: File;
  /** Backend URL, present only for files that were already uploaded. */
  url?: string;
  filename: string;
  mediaType: string;
  /**
   * Markdown produced by the client-side document conversion. Sent
   * alongside the file so the backend can use the text instead of
   * extracting it again.
   */
  convertedMarkdown?: string;
}

export interface AttachmentRepository {
  persistFiles(
    chatId: string,
    files: AttachmentFilePayload[],
  ): Promise<Array<Record<string, unknown>>>;
}
