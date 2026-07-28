/**
 * OPFS Worker Client
 *
 * Proxy basado en Promises para comunicarse con el Worker de OPFS.
 * Expone la misma API de funciones que opfs.ts, pero cada llamada
 * envía un mensaje al Worker y retorna una Promise con el resultado.
 *
 * Uso:
 *   import { saveChat, getChat } from './opfsWorkerClient'
 *   await saveChat(chat)
 *   const chat = await getChat(id)
 */

import type { AttachmentReference, ChatIndexEntry, ChatRecord } from "./opfs";
import type { OpfsResponse } from "@/workers/opfs-protocol";

// ─── Singleton Worker ──────────────────────────────────────────────────────

let worker: Worker | null = null;
let responseListenerSetup = false;

export function initOpfsWorker(): void {
  if (worker) return; // ya inicializado

  worker = new Worker(new URL("../workers/opfs.worker.ts", import.meta.url), {
    type: "module",
  });

  setupResponseListener();
}

function getWorker(): Worker {
  if (!worker) throw new Error("OPFS Worker no inicializado");
  return worker;
}

// ─── Mapa de Promises pendientes ───────────────────────────────────────────

const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();

function setupResponseListener(): void {
  if (responseListenerSetup) return;
  responseListenerSetup = true;

  getWorker().onmessage = (event: MessageEvent<OpfsResponse>) => {
    const res = event.data as OpfsResponse;
    const handlers = pending.get(res.reqId);
    if (!handlers) return;

    pending.delete(res.reqId);
    if (res.ok) {
      handlers.resolve(res.result);
    } else {
      handlers.reject(new Error(res.error));
    }
  };
}

function send<T>(request: Record<string, any> & { type: string }): Promise<T> {
  const reqId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    getWorker().postMessage({ ...request, reqId });
  });
}

// ─── API Pública (misma firma que opfs.ts) ─────────────────────────────────

export function listChats(): Promise<ChatIndexEntry[]> {
  return send<ChatIndexEntry[]>({ type: "list-chats" });
}

export function getChat(chatId: string): Promise<ChatRecord | null> {
  return send<ChatRecord | null>({ type: "get-chat", chatId });
}

export function getStoredChat(chatId: string): Promise<ChatRecord | null> {
  return send<ChatRecord | null>({ type: "get-stored-chat", chatId });
}

export function saveChat(chat: ChatRecord): Promise<null> {
  return send<null>({ type: "save-chat", chat });
}

export function deleteChat(chatId: string): Promise<null> {
  return send<null>({ type: "delete-chat", chatId });
}

export function deleteAllChats(): Promise<null> {
  return send<null>({ type: "delete-all-chats" });
}

export function saveAttachment(
  chatId: string,
  file: File,
  attachmentId?: string,
): Promise<AttachmentReference> {
  return send<AttachmentReference>({
    type: "save-attachment",
    chatId,
    file,
    attachmentId,
  });
}

export function getAttachmentAsBase64(
  chatId: string,
  attachmentId: string,
): Promise<string | null> {
  return send<string | null>({
    type: "get-attachment-base64",
    chatId,
    attachmentId,
  });
}

export function getAttachmentAsDataUrl(
  chatId: string,
  attachmentId: string,
): Promise<string | null> {
  return send<string | null>({
    type: "get-attachment-data-url",
    chatId,
    attachmentId,
  });
}

export function revokeObjectUrlsForChat(chatId: string): Promise<null> {
  return send<null>({ type: "revoke-object-urls", chatId });
}
