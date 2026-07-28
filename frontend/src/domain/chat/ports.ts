import type { AttachmentFile } from "@/components/ai-elements/prompt-input/types";
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
  listFavorites(): Promise<FavoriteMessageEntry[]>;
  getVotes(chatId: string): Promise<Array<Record<string, any>>>;
  saveVote(chatId: string, request: VoteRequest): Promise<Record<string, any>>;
}

export interface AttachmentRepository {
  persistFiles(chatId: string, files: AttachmentFile[]): Promise<any[]>;
}
