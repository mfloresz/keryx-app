import { IS_CLOUD_MODE } from "@/app/config";
import type { AttachmentRepository, ChatRepository } from "@/domain/chat/ports";
import type { ModelRepository } from "@/domain/models/ports";
import type { AuthAdapter } from "@/domain/auth/ports";

let chatRepositoryPromise: Promise<ChatRepository> | null = null;
let attachmentRepositoryPromise: Promise<AttachmentRepository> | null = null;
let modelRepositoryPromise: Promise<ModelRepository> | null = null;
let authAdapterPromise: Promise<AuthAdapter> | null = null;

export function getChatRepository(): Promise<ChatRepository> {
  if (!chatRepositoryPromise) {
    chatRepositoryPromise = IS_CLOUD_MODE
      ? import("@/adapters/cloud/cloudChatRepository").then(
          (module) => module.cloudChatRepository,
        )
      : import("@/adapters/static/opfsChatRepository").then(
          (module) => module.opfsChatRepository,
        );
  }
  return chatRepositoryPromise;
}

export function getAttachmentRepository(): Promise<AttachmentRepository> {
  if (!attachmentRepositoryPromise) {
    attachmentRepositoryPromise = IS_CLOUD_MODE
      ? import("@/adapters/cloud/cloudAttachmentRepository").then(
          (module) => module.cloudAttachmentRepository,
        )
      : import("@/adapters/static/opfsAttachmentRepository").then(
          (module) => module.opfsAttachmentRepository,
        );
  }
  return attachmentRepositoryPromise;
}

export function getModelRepository(): Promise<ModelRepository> {
  if (!modelRepositoryPromise) {
    modelRepositoryPromise = IS_CLOUD_MODE
      ? import("@/adapters/cloud/cloudModelRepository").then(
          (module) => module.cloudModelRepository,
        )
      : import("@/adapters/static/staticModelRepository").then(
          (module) => module.staticModelRepository,
        );
  }
  return modelRepositoryPromise;
}

export function getAuthAdapter(): Promise<AuthAdapter> {
  if (!authAdapterPromise) {
    authAdapterPromise = IS_CLOUD_MODE
      ? import("@/adapters/cloud/cloudAuthAdapter").then(
          (module) => module.cloudAuthAdapter,
        )
      : import("@/adapters/static/staticAuthAdapter").then(
          (module) => module.staticAuthAdapter,
        );
  }
  return authAdapterPromise;
}
