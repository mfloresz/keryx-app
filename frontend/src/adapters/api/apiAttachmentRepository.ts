import type { AttachmentRepository } from "@/domain/chat/ports";
import type { AttachmentFile } from "@/components/ai-elements/prompt-input/types";
import { getAuthAdapter } from "@/services/runtime";

interface UploadedAttachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
}

async function uploadFiles(
  chatId: string,
  files: AttachmentFile[],
): Promise<UploadedAttachment[]> {
  const auth = await getAuthAdapter();
  const headers = await auth.getAuthorizationHeaders();

  const form = new FormData();
  files.forEach((f, i) => {
    const file = f.file as File;
    form.append("files", file, file.name);
    // Markdown conversion produced client-side, paired with files[i] by index.
    // Sent as a plain text field (no filename) so the backend reads it from
    // the multipart values (a Blob with filename would land in the files
    // section and the conversion would be silently dropped).
    if (f.convertedMarkdown) {
      form.append(`converted_${i}`, f.convertedMarkdown);
    }
  });

  const response = await fetch(`/api/chats/${chatId}/attachments`, {
    method: "POST",
    headers, // no content-type: the browser sets the multipart boundary
    body: form,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Failed to upload attachment (${response.status})`,
    );
  }

  const body = (await response.json()) as {
    attachments: UploadedAttachment[];
  };
  return body.attachments ?? [];
}

export const apiAttachmentRepository: AttachmentRepository = {
  async persistFiles(chatId, files) {
    // Files already persisted (no raw File blob) are returned as-is.
    const pending = files.filter(
      (f) => f.file && !f.providerMetadata?.keryx?.storageKey,
    );
    const uploaded = new Map<File, UploadedAttachment>();
    if (pending.length) {
      const results = await uploadFiles(chatId, pending);
      pending.forEach((f, i) => {
        const result = results[i];
        if (result) uploaded.set(f.file as File, result);
      });
    }

    return files.map((file: AttachmentFile) => {
      const result = file.file ? uploaded.get(file.file) : undefined;
      if (result) {
        return {
          type: "file",
          url: `/api/attachments/${result.id}`,
          filename: result.filename,
          mediaType: result.mediaType,
          providerMetadata: {
            keryx: { storageKey: result.id, size: result.size },
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
    });
  },
};
