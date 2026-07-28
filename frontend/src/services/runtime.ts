import type { AttachmentRepository, ChatRepository } from "@/domain/chat/ports";
import type { ModelRepository } from "@/domain/models/ports";
import type { AuthAdapter } from "@/domain/auth/ports";

let chatRepositoryPromise: Promise<ChatRepository> | null = null;
let attachmentRepositoryPromise: Promise<AttachmentRepository> | null = null;
let modelRepositoryPromise: Promise<ModelRepository> | null = null;
let authAdapterPromise: Promise<AuthAdapter> | null = null;

export function getChatRepository(): Promise<ChatRepository> {
  if (!chatRepositoryPromise) {
    chatRepositoryPromise = import("@/adapters/api/apiChatRepository").then(
      (m) => m.apiChatRepository,
    );
  }
  return chatRepositoryPromise;
}

export function getAttachmentRepository(): Promise<AttachmentRepository> {
  if (!attachmentRepositoryPromise) {
    attachmentRepositoryPromise = import("@/adapters/api/apiAttachmentRepository").then(
      (m) => m.apiAttachmentRepository,
    );
  }
  return attachmentRepositoryPromise;
}

export function getModelRepository(): Promise<ModelRepository> {
  if (!modelRepositoryPromise) {
    modelRepositoryPromise = import("@/adapters/api/apiModelRepository").then(
      (m) => m.apiModelRepository,
    );
  }
  return modelRepositoryPromise;
}

export function getAuthAdapter(): Promise<AuthAdapter> {
  if (!authAdapterPromise) {
    authAdapterPromise = import("@/adapters/api/apiAuthAdapter").then(
      (m) => m.apiAuthAdapter,
    );
  }
  return authAdapterPromise;
}
