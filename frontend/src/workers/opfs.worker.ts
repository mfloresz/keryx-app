/**
 * OPFS Worker
 *
 * Ejecuta todas las operaciones de I/O de OPFS en un hilo separado,
 * liberando el main thread de bloqueos por lectura/escritura de archivos.
 *
 * Usa la misma lógica que el original opfs.ts, pero dentro de un Worker
 * dedicado. La comunicación con el main thread se hace mediante mensajes
 * postMessage con el protocolo definido en opfs-protocol.ts.
 */

import type { OpfsRequest, OpfsResponse } from "./opfs-protocol";
import type {
  AttachmentReference,
  ChatIndexEntry,
  ChatRecord,
} from "@/utils/opfs";

// ─── Constantes ────────────────────────────────────────────────────────────

const CHATS_DIR = "chats";
const ATTACHMENTS_DIR = "attachments";
const ATTACHMENT_URL_PREFIX = "attachment://";
const INDEX_FILE = "index.json";

// ─── Helpers internos ──────────────────────────────────────────────────────

async function getDir(path: string[]): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  let dir = root;
  for (const name of path) {
    dir = await dir.getDirectoryHandle(name, { create: true });
  }
  return dir;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

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

function getAttachmentIdFromPart(part: any): string | null {
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

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : "");
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("Failed to read attachment"));
      reader.readAsDataURL(blob);
    });
  }

  if (typeof btoa !== "function") {
    throw new Error("Data URL encoding is not supported in this environment");
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, bytes.length);
    const chunk = bytes.subarray(offset, end);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const mimeType = (blob as File).type || "application/octet-stream";
  const base64 = await blobToBase64(blob);
  return `data:${mimeType};base64,${base64}`;
}

// ─── Gestión de Object URLs ───────────────────────────────────────────────

const chatObjectUrls = new Map<string, string[]>();

function revokeObjectUrlsForChat(chatId: string): void {
  const urls = chatObjectUrls.get(chatId);
  if (urls) {
    urls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    });
    chatObjectUrls.delete(chatId);
  }
}

// ─── Hydration ─────────────────────────────────────────────────────────────

async function hydrateChatRecord(
  chat: ChatRecord | null,
): Promise<ChatRecord | null> {
  if (!chat) {
    return null;
  }

  // Revoke previous object URLs for this chat before creating new ones
  revokeObjectUrlsForChat(chat.id);
  const objectUrls: string[] = [];

  const hydrated = cloneJson(chat);

  const hydrateMessageParts = async (parts: any[]) => {
    return await Promise.all(
      parts.map(async (part) => {
        if (part?.type !== "file") {
          return part;
        }

        const attachmentId = getAttachmentIdFromPart(part);
        if (!attachmentId) {
          return part;
        }

        const file = await getAttachment(chat.id, attachmentId);
        if (!file) {
          return part;
        }

        const objectUrl =
          typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(file)
            : await blobToDataUrl(file);

        if (objectUrl.startsWith("blob:")) {
          objectUrls.push(objectUrl);
        }

        return {
          ...part,
          url: objectUrl,
          filename: part.filename || file.name,
          mediaType: part.mediaType || file.type,
          providerMetadata: {
            ...(part.providerMetadata ?? {}),
            keryx: {
              ...(getAttachmentMetadata(part) ?? {}),
              storageKey: attachmentId,
            },
          },
        };
      }),
    );
  };

  hydrated.messages = await Promise.all(
    hydrated.messages.map(async (message: any) => ({
      ...message,
      parts: Array.isArray(message.parts)
        ? await hydrateMessageParts(message.parts)
        : message.parts,
    })),
  );

  // Hydrate attachments in branch snapshots so they render correctly when switching branches
  if (hydrated.branches) {
    for (const branchState of Object.values(hydrated.branches)) {
      for (const snapshot of branchState.snapshots) {
        snapshot.messages = await Promise.all(
          snapshot.messages.map(async (message: any) => ({
            ...message,
            parts: Array.isArray(message.parts)
              ? await hydrateMessageParts(message.parts)
              : message.parts,
          })),
        );
      }
    }
  }

  chatObjectUrls.set(chat.id, objectUrls);
  return hydrated;
}

// ─── Índice ligero de chats ───────────────────────────────────────────────
//
// Para evitar leer y parsear todos los archivos .json al listar,
// mantenemos un archivo index.json con solo los metadatos ligeros.

async function readIndex(): Promise<ChatIndexEntry[]> {
  try {
    const dir = await getDir([CHATS_DIR]);
    const handle = await dir.getFileHandle(INDEX_FILE);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text) as ChatIndexEntry[];
  } catch {
    return [];
  }
}

async function writeIndex(entries: ChatIndexEntry[]): Promise<void> {
  const dir = await getDir([CHATS_DIR]);
  const handle = await dir.getFileHandle(INDEX_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(entries));
  await writable.close();
}

/**
 * Migración silenciosa: si no existe index.json, lo construye
 * a partir de los archivos .json existentes.
 */
async function ensureIndex(): Promise<void> {
  try {
    const dir = await getDir([CHATS_DIR]);
    await dir.getFileHandle(INDEX_FILE);
    // Ya existe, no hay que migrar
    return;
  } catch {
    // No existe — construir desde archivos existentes
  }

  const entries: ChatIndexEntry[] = [];
  try {
    const dir = await getDir([CHATS_DIR]);
    for await (const [name, handle] of (dir as any).entries()) {
      if (
        handle.kind === "file" &&
        name.endsWith(".json") &&
        name !== INDEX_FILE
      ) {
        try {
          const file = await handle.getFile();
          const chat: ChatRecord = JSON.parse(await file.text());
          entries.push({
            id: chat.id,
            title: chat.title,
            createdAt: chat.createdAt,
          });
        } catch {
          // ignorar archivos corruptos
        }
      }
    }
  } catch {
    // ignorar errores de directorio
  }

  await writeIndex(entries);
}

// Llamar a ensureIndex al cargar el Worker (migración automática al primer arranque)
ensureIndex().catch(() => {});

// ─── Operaciones CRUD ──────────────────────────────────────────────────────

async function readChat(id: string): Promise<ChatRecord | null> {
  try {
    const dir = await getDir([CHATS_DIR]);
    const handle = await dir.getFileHandle(`${id}.json`);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Lista los chats usando el índice ligero.
 * O(1) archivo leído vs O(n) archivos de la versión anterior.
 */
async function listChats(): Promise<ChatIndexEntry[]> {
  const index = await readIndex();
  return index.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

async function getChat(id: string): Promise<ChatRecord | null> {
  return await hydrateChatRecord(await readChat(id));
}

async function getStoredChat(id: string): Promise<ChatRecord | null> {
  return await readChat(id);
}

/**
 * Guarda un chat y actualiza el índice.
 */
async function saveChat(chat: ChatRecord): Promise<void> {
  // Escribir archivo del chat
  const dir = await getDir([CHATS_DIR]);
  const handle = await dir.getFileHandle(`${chat.id}.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(chat));
  await writable.close();

  // Actualizar índice
  const index = await readIndex();
  const existingIdx = index.findIndex((e) => e.id === chat.id);
  const entry: ChatIndexEntry = {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
  };
  if (existingIdx >= 0) {
    index[existingIdx] = entry;
  } else {
    index.push(entry);
  }
  await writeIndex(index);
}

/**
 * Elimina un chat y limpia el índice.
 */
async function deleteChat(id: string): Promise<void> {
  revokeObjectUrlsForChat(id);

  try {
    const dir = await getDir([CHATS_DIR]);
    await dir.removeEntry(`${id}.json`);
  } catch {
    // ignore
  }

  try {
    const attachmentsDir = await getDir([ATTACHMENTS_DIR]);
    await attachmentsDir.removeEntry(id, { recursive: true });
  } catch {
    // ignore if directory doesn't exist
  }

  // Limpiar del índice
  const index = await readIndex();
  await writeIndex(index.filter((e) => e.id !== id));
}

/**
 * Elimina todos los chats y sus adjuntos.
 */
async function deleteAllChats(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(CHATS_DIR, { recursive: true });
  } catch {
    // ignore
  }

  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(ATTACHMENTS_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

async function getAttachment(
  chatId: string,
  attachmentId: string,
): Promise<File | null> {
  try {
    const dir = await getDir([ATTACHMENTS_DIR, chatId]);
    const handle = await dir.getFileHandle(attachmentId);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function saveAttachmentOp(
  chatId: string,
  file: File,
  attachmentId?: string,
): Promise<AttachmentReference> {
  const id = attachmentId ?? crypto.randomUUID();
  const dir = await getDir([ATTACHMENTS_DIR, chatId]);
  const handle = await dir.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();

  return {
    id,
    filename: file.name,
    mediaType: file.type,
    size: file.size,
  };
}

async function getAttachmentAsDataUrl(
  chatId: string,
  attachmentId: string,
): Promise<string | null> {
  const file = await getAttachment(chatId, attachmentId);
  if (!file) {
    return null;
  }

  try {
    return await blobToDataUrl(file);
  } catch {
    return null;
  }
}

async function getAttachmentAsBase64(
  chatId: string,
  attachmentId: string,
): Promise<string | null> {
  const file = await getAttachment(chatId, attachmentId);
  if (!file) {
    return null;
  }

  try {
    return await blobToBase64(file);
  } catch {
    return null;
  }
}

// ─── Manejador de mensajes ─────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<OpfsRequest>) => {
  const req = event.data;

  try {
    let result: unknown;

    switch (req.type) {
      case "list-chats":
        result = await listChats();
        break;

      case "get-chat":
        result = await getChat(req.chatId);
        break;

      case "get-stored-chat":
        result = await getStoredChat(req.chatId);
        break;

      case "save-chat":
        await saveChat(req.chat);
        result = null;
        break;

      case "delete-chat":
        await deleteChat(req.chatId);
        result = null;
        break;

      case "delete-all-chats":
        await deleteAllChats();
        result = null;
        break;

      case "save-attachment":
        result = await saveAttachmentOp(req.chatId, req.file, req.attachmentId);
        break;

      case "get-attachment-base64":
        result = await getAttachmentAsBase64(req.chatId, req.attachmentId);
        break;

      case "get-attachment-data-url":
        result = await getAttachmentAsDataUrl(req.chatId, req.attachmentId);
        break;

      case "revoke-object-urls":
        revokeObjectUrlsForChat(req.chatId);
        result = null;
        break;
    }

    const response: OpfsResponse = { reqId: req.reqId, ok: true, result };
    self.postMessage(response);
  } catch (err: any) {
    const response: OpfsResponse = {
      reqId: req.reqId,
      ok: false,
      error: err?.message ?? "Unknown error",
    };
    self.postMessage(response);
  }
};
