import type { AttachmentRepository } from "@/domain/chat/ports";
import type { AttachmentFile } from "@/components/ai-elements/prompt-input/types";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read attachment"));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read attachment"));
    reader.readAsDataURL(file);
  });
}

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

export const cloudAttachmentRepository: AttachmentRepository = {
  async persistFiles(_chatId, files) {
    return await Promise.all(
      files.map(async (file: AttachmentFile) => {
        if (file.file) {
          const mediaType = inferMediaType(file.file);
          const correctedFile = new File([file.file], file.file.name, {
            type: mediaType,
          });
          return {
            type: "file",
            url: await fileToDataUrl(correctedFile),
            filename: correctedFile.name,
            mediaType,
            providerMetadata: {
              keryx: {
                inline: true,
                size: correctedFile.size,
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
