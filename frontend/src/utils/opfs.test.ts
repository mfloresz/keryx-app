/**
 * OPFS Worker Client Tests
 *
 * Tests the opfsWorkerClient proxy by providing a mock Worker
 * que procesa las solicitudes usando la misma lógica OPFS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initOpfsWorker,
  saveChat,
  getChat,
  listChats,
  deleteChat,
  deleteAllChats,
  saveAttachment,
} from "./opfsWorkerClient";
import {
  resetMockOpfs,
  mockRoot,
  MockDirectoryHandle,
} from "../test/mock-opfs";
import type { ChatIndexEntry, ChatRecord, AttachmentReference } from "./opfs";

// ─── Mock Worker ────────────────────────────────────────────────────────
//
// El opfsWorkerClient crea un Worker y le envía mensajes.
// En tests, reemplazamos Worker con un mock que ejecuta la lógica
// OPFS inline usando el mockRoot.

function createMockWorker() {
  const CHATS_DIR = "chats";
  const ATTACHMENTS_DIR = "attachments";
  const INDEX_FILE = "index.json";

  async function getDir(path: string[]): Promise<any> {
    let dir = mockRoot;
    for (const name of path) {
      dir = await dir.getDirectoryHandle(name, { create: true });
    }
    return dir;
  }

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

  // Índice ligero (misma lógica que el Worker real)
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

  async function opListChats(): Promise<ChatIndexEntry[]> {
    const index = await readIndex();
    return index.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async function opSaveChat(chat: ChatRecord): Promise<void> {
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

  async function opDeleteChat(id: string): Promise<void> {
    try {
      const dir = await getDir([CHATS_DIR]);
      await dir.removeEntry(`${id}.json`);
    } catch {
      /* ignore */
    }
    try {
      const attachmentsDir = await getDir([ATTACHMENTS_DIR]);
      await attachmentsDir.removeEntry(id, { recursive: true });
    } catch {
      /* ignore */
    }

    // Limpiar del índice
    const index = await readIndex();
    await writeIndex(index.filter((e) => e.id !== id));
  }

  async function opDeleteAllChats(): Promise<void> {
    try {
      await mockRoot.removeEntry(CHATS_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    try {
      await mockRoot.removeEntry(ATTACHMENTS_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  async function opSaveAttachmentOp(
    chatId: string,
    file: File,
    attachmentId = crypto.randomUUID(),
  ): Promise<AttachmentReference> {
    const dir = await getDir([ATTACHMENTS_DIR, chatId]);
    const handle = await dir.getFileHandle(attachmentId, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    return {
      id: attachmentId,
      filename: file.name,
      mediaType: file.type,
      size: file.size,
    };
  }

  // Handler que el Worker cliente asigna a onmessage
  let onmessageHandler: ((event: MessageEvent) => void) | null = null;

  return {
    postMessage: async (req: any) => {
      try {
        let result: any;
        switch (req.type) {
          case "list-chats":
            result = await opListChats();
            break;
          case "get-chat":
          case "get-stored-chat":
            result = await readChat(req.chatId);
            break;
          case "save-chat":
            await opSaveChat(req.chat);
            result = null;
            break;
          case "delete-chat":
            await opDeleteChat(req.chatId);
            result = null;
            break;
          case "delete-all-chats":
            await opDeleteAllChats();
            result = null;
            break;
          case "save-attachment":
            result = await opSaveAttachmentOp(
              req.chatId,
              req.file,
              req.attachmentId,
            );
            break;
          default:
            result = null;
        }
        // Responder al handler del cliente
        if (onmessageHandler) {
          onmessageHandler({
            data: { reqId: req.reqId, ok: true, result },
          } as MessageEvent);
        }
      } catch (err: any) {
        if (onmessageHandler) {
          onmessageHandler({
            data: {
              reqId: req.reqId,
              ok: false,
              error: err?.message ?? "Error",
            },
          } as MessageEvent);
        }
      }
    },
    get onmessage() {
      return onmessageHandler;
    },
    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      onmessageHandler = handler;
    },
    terminate: () => {},
  };
}

let originalWorker: any;

beforeEach(() => {
  originalWorker = (globalThis as any).Worker;
  resetMockOpfs();

  // Reemplazar Worker global con un factory que siempre devuelve el mismo mock
  const mockWorker = createMockWorker();
  (globalThis as any).Worker = vi.fn(() => mockWorker);

  initOpfsWorker();
});

afterEach(() => {
  (globalThis as any).Worker = originalWorker;
});

// ─── Tests ─────────────────────────────────────────────────────────────

describe("opfsWorkerClient", () => {
  it("guarda y recupera un chat", async () => {
    const chat: ChatRecord = {
      id: "chat-1",
      title: "Mi chat",
      visibility: "private",
      createdAt: "2024-01-15T10:00:00Z",
      messages: [{ role: "user", content: "Hola" }],
      votes: [],
    };
    await saveChat(chat);
    const result = await getChat("chat-1");
    expect(result).toEqual(chat);
  });

  it("devuelve null si el chat no existe", async () => {
    const result = await getChat("inexistente");
    expect(result).toBeNull();
  });

  it("lista chats ordenados por fecha (mas nuevo primero)", async () => {
    await saveChat({
      id: "viejo",
      title: "Viejo",
      visibility: "private",
      createdAt: "2024-01-01T00:00:00Z",
      messages: [],
      votes: [],
    } as ChatRecord);
    await saveChat({
      id: "nuevo",
      title: "Nuevo",
      visibility: "private",
      createdAt: "2024-01-20T00:00:00Z",
      messages: [],
      votes: [],
    } as ChatRecord);
    const list = await listChats();
    expect(list.map((c) => c.id)).toEqual(["nuevo", "viejo"]);
  });

  it("ignora archivos corruptos al listar", async () => {
    await saveChat({
      id: "valido",
      title: "OK",
      visibility: "private",
      createdAt: "2024-01-01T00:00:00Z",
      messages: [],
      votes: [],
    } as ChatRecord);

    // Meter un archivo corrupto directamente
    const chatsDir = await (mockRoot as MockDirectoryHandle).getDirectoryHandle(
      "chats",
    );
    const badFile = await chatsDir.getFileHandle("corrupto.json", {
      create: true,
    });
    const writable = await badFile.createWritable();
    await writable.write("no es json");
    await writable.close();

    const list = await listChats();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("valido");
  });

  it("borra un chat especifico", async () => {
    await saveChat({
      id: "borrar",
      title: "Borrar",
      visibility: "private",
      createdAt: "2024-01-01T00:00:00Z",
      messages: [],
      votes: [],
    } as ChatRecord);
    await deleteChat("borrar");
    expect(await getChat("borrar")).toBeNull();
  });

  it("borra todos los chats", async () => {
    await saveChat({
      id: "a",
      title: "A",
      visibility: "private",
      createdAt: "2024-01-01T00:00:00Z",
      messages: [],
      votes: [],
    } as ChatRecord);
    await deleteAllChats();
    const list = await listChats();
    expect(list).toHaveLength(0);
  });

  it("guarda y recupera un adjunto", async () => {
    const file = new File(["contenido de prueba"], "nota.txt", {
      type: "text/plain",
    });
    const attachment = await saveAttachment("chat-1", file);

    // Leer el adjunto via el mock interno
    const dir = await (mockRoot as MockDirectoryHandle).getDirectoryHandle(
      "attachments",
    );
    const chatDir = await dir.getDirectoryHandle("chat-1");
    const handle = await chatDir.getFileHandle(attachment.id);
    const retrieved = await handle.getFile();
    expect(retrieved).not.toBeNull();
    expect(await retrieved.text()).toBe("contenido de prueba");
    expect(attachment.filename).toBe("nota.txt");
  });
});
