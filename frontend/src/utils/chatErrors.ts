import { IS_CLOUD_MODE } from "@/app/config";

export const CLOUD_ATTACHMENT_URL_ERROR =
  "Cloud mode only accepts inline data URLs for message attachments";

export function validateCloudAttachmentUrls(files: Array<{ url?: string }>): void {
  if (!IS_CLOUD_MODE) {
    return;
  }

  const hasUnsupportedAttachment = files.some(
    (file) => typeof file.url === "string" && file.url.length > 0 && !file.url.startsWith("data:"),
  );

  if (hasUnsupportedAttachment) {
    throw new Error(CLOUD_ATTACHMENT_URL_ERROR);
  }
}

export function getUserFacingChatError(
  message: string | null | undefined,
  t: (key: string) => string,
): string {
  if (message === CLOUD_ATTACHMENT_URL_ERROR) {
    return t("chat.unsupportedCloudAttachmentDescription");
  }

  return message || t("chat.failedCreate");
}
