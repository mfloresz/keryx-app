import type {
  AttachmentFilePayload,
  AttachmentRepository,
} from "#/domain/chat/ports";
import { getAuthAdapter } from "#/services/runtime";

interface UploadedAttachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
}

async function uploadFiles(
  chatId: string,
  files: AttachmentFilePayload[],
): Promise<UploadedAttachment[]> {
  const auth = await getAuthAdapter();
  const headers = await auth.getAuthorizationHeaders();

  const form = new FormData();
  files.forEach((f) => {
    if (f.file) {
      form.append("files", f.file, f.file.name);
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
    const pending = files.filter((f) => f.file);
    const uploaded = new Map<File, UploadedAttachment>();
    if (pending.length) {
      const results = await uploadFiles(chatId, pending);
      pending.forEach((f, i) => {
        const result = results[i];
        if (result) uploaded.set(f.file!, result);
      });
    }

    return files.map((file) => {
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
        url: file.url ?? "",
        filename: file.filename,
        mediaType: file.mediaType,
      };
    });
  },
};
