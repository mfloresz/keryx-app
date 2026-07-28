import type { AttachmentFile } from "@/components/ai-elements/prompt-input/types";
import { getAttachmentRepository, getChatRepository } from "@/services/runtime";

export async function persistAttachmentFiles(
  chatId: string,
  files: AttachmentFile[],
): Promise<any[]> {
  const attachmentRepository = await getAttachmentRepository();
  return await attachmentRepository.persistFiles(chatId, files);
}

export async function persistChatRecord(chat: Record<string, any>): Promise<void> {
  const chatRepository = await getChatRepository();
  await chatRepository.createChat(chat as any);
}
