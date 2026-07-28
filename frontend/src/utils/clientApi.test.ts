import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiFetch,
  prepareMessagesForModel,
  sanitizeMessagesForStorage,
} from "./clientApi";
import * as opfsWorker from "./opfsWorkerClient";
import { resetMockOpfs, mockRoot } from "../test/mock-opfs";

describe("prepareMessagesForModel", () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = (globalThis as any).fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).fetch = originalFetch;
  });

  it("devuelve mensajes sin cambios si no hay adjuntos", async () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "Hola" }] },
      { role: "assistant", parts: [{ type: "text", text: "Hola de vuelta" }] },
    ];
    const result = await prepareMessagesForModel(messages, "gpt-4o");
    expect(result).toEqual(messages);
  });

  it("filtra imagenes para modelos que no las soportan (DeepSeek)", async () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Analiza" },
          { type: "file", mediaType: "image/png", filename: "foto.png" },
        ],
      },
    ];
    const result = await prepareMessagesForModel(messages, "deepseek/chat");
    // La imagen se filtra por completo, solo queda el texto
    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0].type).toBe("text");
    expect(result[0].parts[0].text).toBe("Analiza");
  });

  it("conserva imagenes para modelos que no son DeepSeek", async () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Analiza" },
          { type: "file", mediaType: "image/png", filename: "foto.png" },
        ],
      },
    ];
    const result = await prepareMessagesForModel(messages, "gpt-4o");
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[1].type).toBe("file");
  });

  it("extrae texto de archivos y lo inyecta en el prompt", async () => {
    (globalThis as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ text: async () => 'console.log(\"hello\")' });

    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Revisa este codigo" },
          {
            type: "file",
            mediaType: "text/javascript",
            filename: "app.js",
            url: "blob://1",
          },
        ],
      },
    ];
    const result = await prepareMessagesForModel(messages, "gpt-4o");
    expect(result[0].parts[0].text).toContain("app.js");
    expect(result[0].parts[0].text).toContain("javascript");
    expect(result[0].parts[0].text).toContain("console.log");
  });

  it("mantiene el archivo original si no se puede extraer texto", async () => {
    (globalThis as any).fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"));

    const messages = [
      {
        role: "user",
        parts: [
          {
            type: "file",
            mediaType: "application/pdf",
            filename: "doc.pdf",
            url: "blob://1",
          },
        ],
      },
    ];
    const result = await prepareMessagesForModel(messages, "gpt-4o");
    expect(result[0].parts[0].type).toBe("file");
  });

  it("convierte imagenes persistidas a base64 puro para evitar data URLs", async () => {
    vi.spyOn(opfsWorker, "getAttachmentAsBase64").mockResolvedValueOnce(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    );

    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Analiza" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "foto.png",
            providerMetadata: { keryx: { storageKey: "att-1" } },
          },
        ],
      },
    ];

    const result = await prepareMessagesForModel(messages, "gpt-4o", "chat-1");

    expect(opfsWorker.getAttachmentAsBase64).toHaveBeenCalledWith(
      "chat-1",
      "att-1",
    );
    expect(result[0].parts[1]).toMatchObject({
      type: "file",
      url: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    });
    expect(result[0].parts[1].url).not.toContain("data:");
  });

  it("trata txt con mime octet-stream como texto si la extension lo indica", async () => {
    vi.spyOn(opfsWorker, "getAttachmentAsDataUrl").mockResolvedValueOnce(
      "data:application/octet-stream;base64,SG9sYSwgbXVuZG8h",
    );

    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Resume" },
          {
            type: "file",
            mediaType: "application/octet-stream",
            filename: "nota.txt",
            providerMetadata: { keryx: { storageKey: "att-2" } },
          },
        ],
      },
    ];

    const result = await prepareMessagesForModel(messages, "gpt-4o", "chat-1");

    expect(opfsWorker.getAttachmentAsDataUrl).toHaveBeenCalledWith(
      "chat-1",
      "att-2",
    );
    expect(result[0].parts[0].text).toContain("Resume");
    expect(result[0].parts[0].text).toContain("Hola, mundo!");
    expect(result[0].parts.some((part: any) => part.type === "file")).toBe(
      false,
    );
  });
});

describe("apiFetch rutas CRUD", () => {
  let originalNavigator: any;
  let originalLocalStorage: any;

  beforeEach(() => {
    originalNavigator = (globalThis as any).navigator;
    originalLocalStorage = (globalThis as any).localStorage;
    resetMockOpfs();
    vi.restoreAllMocks();
    (globalThis as any).navigator = {
      storage: { getDirectory: async () => mockRoot },
    };
    (globalThis as any).localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
  });

  afterEach(() => {
    (globalThis as any).navigator = originalNavigator;
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it("GET /api/chats devuelve la lista de chats", async () => {
    vi.spyOn(opfsWorker, "listChats").mockResolvedValueOnce([
      { id: "1", title: "Hola" },
    ] as any);
    const res = await apiFetch("/api/chats");
    expect(res).not.toBeNull();
    expect(await res!.json()).toEqual([{ id: "1", title: "Hola" }]);
  });

  it("DELETE /api/chats borra todos los chats", async () => {
    vi.spyOn(opfsWorker, "deleteAllChats").mockResolvedValueOnce(null);
    const res = await apiFetch("/api/chats", { method: "DELETE" });
    expect(opfsWorker.deleteAllChats).toHaveBeenCalled();
    expect(await res!.json()).toEqual({ success: true });
  });

  it("POST /api/chats crea un chat", async () => {
    const saveChatSpy = vi
      .spyOn(opfsWorker, "saveChat")
      .mockResolvedValueOnce(null);
    const res = await apiFetch("/api/chats", {
      method: "POST",
      body: JSON.stringify({ id: "abc", title: "Hola mundo" }),
    });
    expect(saveChatSpy).toHaveBeenCalledWith({
      id: "abc",
      title: "Hola mundo",
    });
    expect(await res!.json()).toEqual({ success: true });
  });

  it("GET /api/chats/:id devuelve el chat o 404", async () => {
    vi.spyOn(opfsWorker, "getChat").mockResolvedValueOnce(null);
    const res = await apiFetch("/api/chats/abc", { method: "GET" });
    expect(res!.status).toBe(404);

    vi.spyOn(opfsWorker, "getChat").mockResolvedValueOnce({
      id: "abc",
      title: "Test",
    } as any);
    const res2 = await apiFetch("/api/chats/abc", { method: "GET" });
    expect(res2!.status).toBe(200);
    expect(await res2!.json()).toMatchObject({ id: "abc", isOwner: true });
  });

  it("DELETE /api/chats/:id borra el chat", async () => {
    vi.spyOn(opfsWorker, "deleteChat").mockResolvedValueOnce(null);
    const res = await apiFetch("/api/chats/abc", { method: "DELETE" });
    expect(opfsWorker.deleteChat).toHaveBeenCalledWith("abc");
    expect(await res!.json()).toEqual({ success: true });
  });

  it("PATCH /api/chats/title/:id actualiza el titulo", async () => {
    const chat = {
      id: "abc",
      title: "Viejo",
      visibility: "private" as const,
      messages: [],
      votes: [],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    const res = await apiFetch("/api/chats/title/abc", {
      method: "PATCH",
      body: JSON.stringify({ title: "Nuevo" }),
    });
    expect(chat.title).toBe("Nuevo");
    expect(await res!.json()).toEqual(chat);
  });

  it("PATCH /api/chats/visibility/:id actualiza la visibilidad", async () => {
    const chat = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [],
      votes: [],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    const res = await apiFetch("/api/chats/visibility/abc", {
      method: "PATCH",
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(chat.visibility).toBe("public");
    expect(await res!.json()).toEqual(chat);
  });

  it("DELETE /api/chats/messages/:id recorta mensajes para edit", async () => {
    const chat: any = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [
        { id: "m1", role: "user" },
        { id: "m2", role: "assistant" },
        { id: "m3", role: "user" },
      ],
      votes: [],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    const res = await apiFetch("/api/chats/messages/abc", {
      method: "DELETE",
      body: JSON.stringify({ messageId: "m1", type: "edit" }),
    });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]!.id).toBe("m1");
    expect(await res!.json()).toEqual({ success: true });
  });

  it("DELETE /api/chats/messages/:id recorta mensajes para regenerate", async () => {
    const chat: any = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [
        { id: "m1", role: "user" },
        { id: "m2", role: "assistant" },
        { id: "m3", role: "user" },
      ],
      votes: [],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    const res = await apiFetch("/api/chats/messages/abc", {
      method: "DELETE",
      body: JSON.stringify({ messageId: "m2", type: "regenerate" }),
    });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]!.id).toBe("m1");
    expect(await res!.json()).toEqual({ success: true });
  });

  it("DELETE /api/chats/messages/:id elimina el assistant objetivo al regenerar", async () => {
    const chat: any = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [
        { id: "m1", role: "user" },
        { id: "m2", role: "assistant" },
        { id: "m3", role: "user" },
        { id: "m4", role: "assistant" },
      ],
      votes: [],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    await apiFetch("/api/chats/messages/abc", {
      method: "DELETE",
      body: JSON.stringify({ messageId: "m4", type: "regenerate" }),
    });

    expect(chat.messages).toEqual([
      { id: "m1", role: "user" },
      { id: "m2", role: "assistant" },
      { id: "m3", role: "user" },
    ]);
    expect(chat.branches?.m3?.snapshots).toHaveLength(2);
    expect(chat.branches?.m3?.currentSnapshotId).toBe(
      chat.branches?.m3?.snapshots[1]?.id,
    );
  });

  it("POST /api/chats/branches/:id cambia la rama activa persistida", async () => {
    const chat: any = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hola" }] },
        {
          id: "m2b",
          role: "assistant",
          parts: [{ type: "text", text: "segunda" }],
        },
      ],
      votes: [],
      branches: {
        m1: {
          rootMessageId: "m1",
          includeRoot: false,
          currentSnapshotId: "s2",
          snapshots: [
            {
              id: "s1",
              label: "Original",
              createdAt: "2024-01-01T00:00:00Z",
              messages: [
                {
                  id: "m2a",
                  role: "assistant",
                  parts: [{ type: "text", text: "primera" }],
                },
              ],
            },
            {
              id: "s2",
              label: "Regeneration 2",
              createdAt: "2024-01-01T00:01:00Z",
              messages: [
                {
                  id: "m2b",
                  role: "assistant",
                  parts: [{ type: "text", text: "segunda" }],
                },
              ],
            },
          ],
        },
      },
    };

    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);
    vi.spyOn(opfsWorker, "getChat").mockResolvedValueOnce({
      ...chat,
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hola" }] },
        {
          id: "m2a",
          role: "assistant",
          parts: [{ type: "text", text: "primera" }],
        },
      ],
      branches: {
        ...chat.branches,
        m1: {
          ...chat.branches.m1,
          currentSnapshotId: "s1",
        },
      },
    } as any);

    const res = await apiFetch("/api/chats/branches/abc", {
      method: "POST",
      body: JSON.stringify({ rootMessageId: "m1", snapshotId: "s1" }),
    });

    expect(chat.branches.m1.currentSnapshotId).toBe("s1");
    expect(chat.messages[1]?.id).toBe("m2a");
    expect((await res!.json()).messages[1].id).toBe("m2a");
  });

  it("asigna ids faltantes antes de persistir en static mode", () => {
    const messages = sanitizeMessagesForStorage([
      {
        id: "",
        role: "assistant",
        parts: [{ type: "text", text: "missing id" }],
      },
    ] as any);

    expect(typeof messages[0].id).toBe("string");
    expect(messages[0].id.length).toBeGreaterThan(0);
  });

  it("GET /api/favorites devuelve favoritos agregados", async () => {
    vi.spyOn(opfsWorker, "listChats").mockResolvedValueOnce([
      {
        id: "chat-1",
        title: "Chat Uno",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "chat-2",
        title: "Chat Dos",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ] as any);
    vi.spyOn(opfsWorker, "getStoredChat")
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Chat Uno",
        visibility: "private" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        messages: [
          {
            id: "m1",
            role: "assistant",
            createdAt: "2026-01-01T00:01:00.000Z",
            parts: [{ type: "text", text: "Respuesta favorita" }],
          },
        ],
        votes: [{ messageId: "m1", isUpvoted: true }],
      } as any)
      .mockResolvedValueOnce({
        id: "chat-2",
        title: "Chat Dos",
        visibility: "private" as const,
        createdAt: "2026-01-02T00:00:00.000Z",
        messages: [],
        votes: [],
      } as any);

    const res = await apiFetch("/api/favorites", { method: "GET" });
    const payload = await res?.json();

    expect(payload).toEqual([
      {
        chatId: "chat-1",
        chatTitle: "Chat Uno",
        chatCreatedAt: "2026-01-01T00:00:00.000Z",
        messageId: "m1",
        messagePreview: "Respuesta favorita",
        messageCreatedAt: "2026-01-01T00:01:00.000Z",
      },
    ]);
  });

  it("GET /api/chats/votes/:id devuelve los votos", async () => {
    const chat = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [{ id: "m1", role: "assistant" }],
      votes: [{ messageId: "m1", isUpvoted: true }],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);

    const res = await apiFetch("/api/chats/votes/abc", { method: "GET" });
    expect(await res!.json()).toEqual([{ messageId: "m1", isUpvoted: true }]);
  });

  it("POST /api/chats/votes/:id guarda un voto", async () => {
    const chat = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [{ id: "m1", role: "assistant" }],
      votes: [] as any[],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    const res = await apiFetch("/api/chats/votes/abc", {
      method: "POST",
      body: JSON.stringify({ messageId: "m1", isUpvoted: true }),
    });
    expect(chat.votes).toHaveLength(1);
    expect(await res!.json()).toMatchObject({
      messageId: "m1",
      isUpvoted: true,
    });
  });

  it("POST /api/chats/votes/:id elimina el voto si isUpvoted es undefined", async () => {
    const chat = {
      id: "abc",
      title: "Test",
      visibility: "private" as const,
      messages: [{ id: "m1", role: "assistant" }],
      votes: [{ messageId: "m1", isUpvoted: true }],
    };
    vi.spyOn(opfsWorker, "getStoredChat").mockResolvedValueOnce(chat as any);
    vi.spyOn(opfsWorker, "saveChat").mockResolvedValueOnce(null);

    await apiFetch("/api/chats/votes/abc", {
      method: "POST",
      body: JSON.stringify({ messageId: "m1" }),
    });
    expect(chat.votes).toHaveLength(0);
  });

  it("devuelve null para rutas que no maneja", async () => {
    const res = await apiFetch("/api/ai-gateway/v3/ai");
    expect(res).toBeNull();
  });
});
