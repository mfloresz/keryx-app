/**
 * OPFS (Origin Private File System) Storage Utility
 *
 * Tipos compartidos y helpers puros (sin I/O) para la persistencia OPFS.
 *
 * Todas las operaciones de I/O se ejecutan en un Worker dedicado
 * (ver opfsWorkerClient.ts y opfs.worker.ts). Este archivo exporta
 * únicamente los tipos y funciones que no requieren acceso al sistema
 * de archivos, para que el main thread pueda usarlas directamente.
 */

export type {
  AttachmentReference,
  ChatBranchSnapshot,
  ChatBranchState,
  ChatIndexEntry,
  ChatRecord,
} from "../domain/chat/types";

export const ATTACHMENT_URL_PREFIX = "attachment://";

function getAttachmentMetadata(part: any): Record<string, any> | undefined {
  const providerMetadata = part?.providerMetadata;
  if (!providerMetadata || typeof providerMetadata !== "object") {
    return undefined;
  }

  const keryx = (providerMetadata as Record<string, any>).keryx;
  if (!keryx || typeof keryx !== "object") {
    return undefined;
  }

  return keryx as Record<string, any>;
}

/**
 * Extract the attachment storage key from a message part.
 */
export function getAttachmentStorageKey(part: any): string | null {
  if (
    typeof part?.url === "string" &&
    part.url.startsWith(ATTACHMENT_URL_PREFIX)
  ) {
    return part.url.slice(ATTACHMENT_URL_PREFIX.length);
  }

  const metadata = getAttachmentMetadata(part);
  if (
    typeof metadata?.storageKey === "string" &&
    metadata.storageKey.length > 0
  ) {
    return metadata.storageKey;
  }

  return null;
}

/**
 * Create an attachment:// URL for a given attachment ID.
 */
export function createAttachmentUrl(attachmentId: string): string {
  return `${ATTACHMENT_URL_PREFIX}${attachmentId}`;
}
