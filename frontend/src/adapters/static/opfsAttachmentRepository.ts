import type { AttachmentRepository } from "@/domain/chat/ports";
import type { AttachmentFile } from "@/components/ai-elements/prompt-input/types";
import { createAttachmentUrl } from "@/utils/opfs";
import { saveAttachment } from "@/utils/opfsWorkerClient";

function inferMediaType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }

  const ext = file.name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
  };

  return map[ext ?? ""] ?? "application/octet-stream";
}

export const opfsAttachmentRepository: AttachmentRepository = {
  async persistFiles(chatId, files) {
    return await Promise.all(
      files.map(async (file: AttachmentFile) => {
        if (file.file) {
          const mediaType = inferMediaType(file.file);
          const correctedFile = new File([file.file], file.file.name, {
            type: mediaType,
          });
          const savedAttachment = await saveAttachment(chatId, correctedFile);
          return {
            type: "file",
            url: createAttachmentUrl(savedAttachment.id),
            filename: savedAttachment.filename,
            mediaType,
            providerMetadata: {
              keryx: {
                storageKey: savedAttachment.id,
                size: savedAttachment.size,
              },
            },
          };
        }

        return {
          type: "file",
          url: file.url,
          filename: file.filename,
          mediaType: file.mediaType,
          providerMetadata: file.providerMetadata,
        };
      }),
    );
  },
};
