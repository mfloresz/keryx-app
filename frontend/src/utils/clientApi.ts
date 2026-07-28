/**
 * Client-side API Logic
 *
 * Intercepts all fetch calls to `/api/*` and handles them locally
 * using OPFS for storage and AI SDK for streaming.
 * Supports Vercel AI Gateway and OpenCode GO providers.
 */
import {
  streamText,
  convertToModelMessages,
  generateText,
  stepCountIs,
} from "ai";
import { createGatewayProvider } from "@ai-sdk/gateway";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { UIMessage } from "ai";
import {
  deleteAllChats,
  deleteChat,
  getAttachmentAsBase64,
  getAttachmentAsDataUrl,
  getChat,
  getStoredChat,
  listChats,
  saveChat,
} from "./opfsWorkerClient";
import { getFavoriteMessagesFromChat } from "../shared/favorites";
import { ensureMessageIdentifiers } from "../shared/chatCore";
import {
  getAttachmentStorageKey,
  type ChatBranchState,
  type ChatRecord,
} from "./opfs";
import { getModels } from "../shared/utils/models";
import {
  BASE_SYSTEM_PROMPT,
  TITLE_GENERATION_SYSTEM_PROMPT,
} from "../shared/prompts";

import { tavilySearchTool, tavilyExtractTool } from "./tavilyTools";
import { secureGetItem } from "./secureStorage";

// Per-chat async mutex to serialize read-modify-write persistence.
// This avoids stale reads overwriting newer mutations when multiple
// chat operations overlap for the same chat ID.
const chatWriteLocks = new Map<string, Promise<void>>();

async function withChatLock<T>(
  chatId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = chatWriteLocks.get(chatId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  chatWriteLocks.set(chatId, current);

  try {
    await previous;
    return await task();
  } finally {
    release();
    if (chatWriteLocks.get(chatId) === current) {
      chatWriteLocks.delete(chatId);
    }
  }
}

async function getProvider(): Promise<"vercel" | "opencode"> {
  const stored = localStorage.getItem("ai-provider");
  if (stored === "opencode") return "opencode";
  return "vercel";
}

async function getApiKey(provider?: string): Promise<string> {
  const prov = provider || (await getProvider());
  const keyName =
    prov === "opencode" ? "opencode-api-key" : "ai-gateway-api-key";
  return (await secureGetItem(keyName)) || "";
}

async function getProviderLabel(provider?: string): Promise<string> {
  const prov = provider || (await getProvider());
  return prov === "opencode" ? "OpenCode GO" : "Vercel AI Gateway";
}

function getSameOriginApiUrl(path: string): string {
  const origin =
    globalThis.location?.origin ??
    globalThis.location?.href ??
    "http://localhost";
  return new URL(path, origin).toString();
}

async function getGatewayProvider() {
  const provider = await getProvider();
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    const label = await getProviderLabel(provider);
    throw new Error(
      `${label} API key not configured. Please set it in Settings.`,
    );
  }

  if (provider === "opencode") {
    // OpenCode uses an OpenAI-compatible endpoint proxied through Vite in dev
    // and through Vercel rewrites in production.
    // Only supports Chat Completions API, not the newer Responses API.
    const baseURL = getSameOriginApiUrl("/api/opencode/go/v1");

    return createOpenAICompatible({
      name: "opencode",
      apiKey,
      baseURL,
    });
  }

  // Vercel AI Gateway
  const gatewayBaseURL = import.meta.env.DEV
    ? "/api/ai-gateway/v3/ai"
    : "https://ai-gateway.vercel.sh/v3/ai";
  return createGatewayProvider({
    apiKey,
    baseURL: gatewayBaseURL,
  });
}

/**
 * Always returns a Vercel AI Gateway provider, regardless of the user's selected provider.
 * Used for internal operations like title generation that must go through Vercel.
 */
async function getVercelGatewayProvider() {
  const apiKey = await getApiKey("vercel");
  if (!apiKey) {
    throw new Error(
      "Vercel AI Gateway API key not configured. Please set it in Settings.",
    );
  }
  const gatewayBaseURL = import.meta.env.DEV
    ? "/api/ai-gateway/v3/ai"
    : "https://ai-gateway.vercel.sh/v3/ai";
  return createGatewayProvider({
    apiKey,
    baseURL: gatewayBaseURL,
  });
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Generate a chat title from the first user message (fire-and-forget).
 * Se ejecuta concurrentemente sin bloquear el inicio del stream.
 */
async function generateChatTitle(
  chatId: string,
  userMsg: UIMessage,
): Promise<void> {
  try {
    const provider = await getVercelGatewayProvider();
    const { text: title } = await generateText({
      model: provider("mistral/ministral-8b"),
      system: TITLE_GENERATION_SYSTEM_PROMPT,
      prompt: JSON.stringify(userMsg),
    });
    await withChatLock(chatId, async () => {
      const latestChat = await getStoredChat(chatId);
      if (!latestChat || latestChat.title) {
        return;
      }

      latestChat.title = title;
      await saveChat(latestChat);
    });
  } catch {
    // ignorar errores de generación de título
  }
}

function getFileLanguage(mediaType: string): string {
  const normalized = mediaType.toLowerCase();
  return normalized === "text/x-python"
    ? "python"
    : normalized === "text/plain"
      ? "text"
      : normalized === "text/javascript" ||
          normalized === "application/javascript"
        ? "javascript"
        : normalized === "text/typescript"
          ? "typescript"
          : normalized === "text/html"
            ? "html"
            : normalized === "text/css"
              ? "css"
              : normalized === "text/x-java-source" ||
                  normalized === "text/java"
                ? "java"
                : normalized === "text/x-c++src"
                  ? "cpp"
                  : normalized === "text/x-go"
                    ? "go"
                    : normalized === "text/x-rust"
                      ? "rust"
                      : "";
}

const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "java",
  "cpp",
  "cc",
  "cxx",
  "c",
  "h",
  "hpp",
  "go",
  "rs",
  "rb",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "sql",
  "sh",
  "bash",
  "zsh",
  "fish",
  "log",
]);

function getFileExtension(filename?: string): string {
  return filename?.split(".").pop()?.toLowerCase() ?? "";
}

function isTextLikeFile(mediaType: string, filename?: string): boolean {
  const normalized = mediaType.toLowerCase();
  if (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/javascript" ||
    normalized === "application/x-javascript"
  ) {
    return true;
  }

  return TEXT_FILE_EXTENSIONS.has(getFileExtension(filename));
}

export function syncCurrentBranchSnapshots(chat: ChatRecord) {
  const branchStates = Object.values(chat.branches ?? {});
  branchStates.forEach((state) => {
    const rootIndex = chat.messages.findIndex(
      (message: UIMessage) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) {
      return;
    }

    const startIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const currentSnapshot = state.snapshots.find(
      (snapshot) => snapshot.id === state.currentSnapshotId,
    );
    if (!currentSnapshot) {
      return;
    }

    currentSnapshot.messages = cloneJson(chat.messages.slice(startIndex));
  });
}

export function ensureBranchState(
  chat: ChatRecord,
  rootMessageId: string,
  includeRoot: boolean,
  startIndex: number,
): ChatBranchState {
  chat.branches ??= {};

  let branchState = chat.branches[rootMessageId];
  if (branchState) {
    return branchState;
  }

  const createdAt = new Date().toISOString();
  const snapshotId = crypto.randomUUID();
  branchState = {
    rootMessageId,
    includeRoot,
    currentSnapshotId: snapshotId,
    snapshots: [
      {
        id: snapshotId,
        label: "Original",
        createdAt,
        messages: cloneJson(chat.messages.slice(startIndex)),
      },
    ],
  };

  chat.branches[rootMessageId] = branchState;
  return branchState;
}

export function openNewBranch(
  chat: ChatRecord,
  rootMessageId: string,
  includeRoot: boolean,
  startIndex: number,
  labelPrefix: string,
) {
  syncCurrentBranchSnapshots(chat);
  const branchState = ensureBranchState(
    chat,
    rootMessageId,
    includeRoot,
    startIndex,
  );
  const createdAt = new Date().toISOString();
  const nextNumber = branchState.snapshots.length + 1;

  const nextSnapshot = {
    id: crypto.randomUUID(),
    label: `${labelPrefix} ${nextNumber}`,
    createdAt,
    messages: [] as any[],
  };

  branchState.snapshots.push(nextSnapshot);
  branchState.currentSnapshotId = nextSnapshot.id;
}

export function annotateBranchMetadata(chat: ChatRecord): ChatRecord {
  const annotated = cloneJson(chat);
  const branchStates = Object.values(annotated.branches ?? {});

  branchStates.forEach((state) => {
    if (state.snapshots.length <= 1) {
      return;
    }

    const rootIndex = annotated.messages.findIndex(
      (message: UIMessage) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) {
      return;
    }

    const targetIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const targetMessage = annotated.messages[targetIndex];
    if (!targetMessage) {
      return;
    }

    const currentIndex = state.snapshots.findIndex(
      (snapshot) => snapshot.id === state.currentSnapshotId,
    );

    targetMessage.metadata = {
      ...(targetMessage.metadata ?? {}),
      keryxBranch: {
        rootMessageId: state.rootMessageId,
        currentSnapshotId: state.currentSnapshotId,
        currentIndex,
        snapshotCount: state.snapshots.length,
        snapshots: state.snapshots.map((snapshot) => ({
          id: snapshot.id,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
        })),
      },
    };
  });

  return annotated;
}

export function upsertUserMessage(
  chat: ChatRecord,
  message: UIMessage,
): boolean {
  const existingIndex = chat.messages.findIndex(
    (item: UIMessage) => item.id === message.id,
  );
  const nextMessage = {
    ...message,
    chatId: chat.id,
    createdAt:
      existingIndex === -1
        ? new Date().toISOString()
        : (chat.messages[existingIndex]?.createdAt ?? new Date().toISOString()),
  };

  if (existingIndex === -1) {
    chat.messages.push(nextMessage);
    return true;
  }

  const previousMessage = chat.messages[existingIndex];
  if (JSON.stringify(previousMessage) === JSON.stringify(nextMessage)) {
    return false;
  }

  chat.messages.splice(existingIndex, 1, nextMessage);
  return true;
}

async function resolveFilePartUrl(
  chatId: string | undefined,
  filePart: { url?: string; providerMetadata?: Record<string, unknown> },
): Promise<string | null> {
  if (typeof filePart?.url === "string") {
    return filePart.url;
  }

  const attachmentId = getAttachmentStorageKey(filePart);
  if (attachmentId && chatId) {
    return `attachment://${attachmentId}`;
  }

  return null;
}

/**
 * Extract text content from a file URL.
 * Explicitly rejects data: and blob: URLs for non-text content to avoid
 * NetworkError when fetch() is called against browser-restricted schemes.
 */
async function extractTextFromUrl(url: string): Promise<string | null> {
  // data: URLs cannot be fetched via window.fetch in most browser contexts.
  // blob: URLs are safe to fetch, but only if they originate from this session.
  if (url.startsWith("data:")) {
    // Attempt a direct base64 decode for text-based data URLs only.
    try {
      const [header, base64] = url.split(",");
      if (!header || !base64) return null;
      const isBase64 = header.includes(";base64");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mime = mimeMatch?.[1] ?? "";
      // Only attempt decode for known text MIME types.
      const isText =
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "application/javascript";
      if (!isText) return null;
      return isBase64 ? atob(base64) : decodeURIComponent(base64);
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(url);
    return await response.text();
  } catch {
    return null;
  }
}

async function extractTextFromFilePart(
  filePart: { url?: string; filename?: string; mediaType?: string },
  resolvedUrl: string | null,
): Promise<string | null> {
  if (!resolvedUrl) {
    return null;
  }

  const filename = filePart.filename;
  const mediaType = filePart.mediaType || "";
  const treatAsText = isTextLikeFile(mediaType, filename);

  if (resolvedUrl.startsWith("data:")) {
    try {
      const [header, payload] = resolvedUrl.split(",");
      if (!header || !payload) return null;

      const isBase64 = header.includes(";base64");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mime = mimeMatch?.[1] ?? "";
      const canDecode =
        treatAsText ||
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "application/javascript";

      if (!canDecode) return null;
      return isBase64 ? atob(payload) : decodeURIComponent(payload);
    } catch {
      return null;
    }
  }

  if (treatAsText) {
    try {
      const response = await fetch(resolvedUrl);
      return await response.text();
    } catch {
      return null;
    }
  }

  return await extractTextFromUrl(resolvedUrl);
}

/**
 * Prepare messages for a specific model by converting unsupported file parts
 * into text content. Images are kept as file parts for vision-capable models.
 * Text/code files are extracted and injected into the prompt.
 */
export async function prepareMessagesForModel(
  messages: any[],
  model: string,
  chatId?: string,
): Promise<any[]> {
  const isDeepSeek = model.startsWith("deepseek/");

  return Promise.all(
    messages.map(async (msg) => {
      if (msg.role !== "user" || !msg.parts || msg.parts.length === 0) {
        return msg;
      }

      const textParts = msg.parts.filter((p: any) => p.type === "text");
      const fileParts = msg.parts.filter((p: any) => p.type === "file");

      if (fileParts.length === 0) return msg;

      let combinedText = textParts.map((p: any) => p.text).join("\n");
      const remainingParts: any[] = [];

      for (const filePart of fileParts) {
        const mediaType = (filePart.mediaType || "").toLowerCase();
        const isImage = mediaType.startsWith("image/");
        const attachmentId = getAttachmentStorageKey(filePart);
        const resolvedUrl = await resolveFilePartUrl(chatId, filePart);

        if (isImage) {
          if (isDeepSeek) {
            // Skip images for models that don't support them
            continue;
          }
          const imageData =
            attachmentId && chatId
              ? await getAttachmentAsBase64(chatId, attachmentId)
              : null;
          remainingParts.push({
            ...filePart,
            ...(imageData
              ? { url: imageData }
              : resolvedUrl
                ? { url: resolvedUrl }
                : {}),
          });
        } else {
          const textResolvedUrl =
            attachmentId && chatId
              ? await getAttachmentAsDataUrl(chatId, attachmentId)
              : resolvedUrl;
          const content = await extractTextFromFilePart(
            filePart,
            textResolvedUrl,
          );
          if (content !== null) {
            const filename = filePart.filename || "file";
            const language = getFileLanguage(mediaType);

            combinedText += `\n\n<USER_FILE filename="${filename}" language="${language || "unknown"}">\n${content}\n</USER_FILE>\n`;
          } else {
            remainingParts.push({
              ...filePart,
              ...(resolvedUrl ? { url: resolvedUrl } : {}),
            });
          }
        }
      }

      const newParts: any[] = [];
      if (combinedText.trim()) {
        newParts.push({ type: "text", text: combinedText.trim() });
      }
      newParts.push(...remainingParts);

      return { ...msg, parts: newParts };
    }),
  );
}

/**
 * Normalize file parts in messages before processing.
 *
 * The AI SDK hydrates blob: URLs into message parts for UI rendering, but
 * blob: URLs are ephemeral and cannot be fetched by the fetch interceptor.
 * This function replaces any blob: URL on a file part that has a valid
 * keryx.storageKey with the canonical attachment:// URL, ensuring
 * resolveFilePartUrl can always retrieve the file from OPFS.
 */
export function normalizeMessageAttachments(messages: any[]): any[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.parts)) {
      return msg;
    }

    const normalizedParts = msg.parts.map((part: any) => {
      if (part?.type !== "file") return part;

      const storageKey = part?.providerMetadata?.keryx?.storageKey;
      if (typeof storageKey === "string" && storageKey.length > 0) {
        // Always use the canonical attachment:// URL when a storageKey exists.
        // This makes the URL resolveable by getAttachmentIdFromPart regardless
        // of whether the SDK preserved providerMetadata or not.
        return {
          ...part,
          url: `attachment://${storageKey}`,
        };
      }

      return part;
    });

    return { ...msg, parts: normalizedParts };
  });
}

/**
 * Sanitize messages before persisting to OPFS.
 *
 * The AI SDK may transform file part URLs during processing (e.g., resolving
 * attachment:// → data: for model consumption). This function ensures that
 * any file part with a keryx.storageKey always uses the canonical
 * attachment://<storageKey> URL before writing to OPFS, preventing data: URLs
 * from being persisted and causing NetworkError on subsequent requests.
 */
export function sanitizeMessagesForStorage(messages: any[]): any[] {
  return ensureMessageIdentifiers(messages).map((msg) => {
    if (!Array.isArray(msg.parts)) return msg;

    const sanitizedParts = msg.parts.map((part: any) => {
      if (part?.type !== "file") return part;

      const storageKey = part?.providerMetadata?.keryx?.storageKey;
      if (typeof storageKey === "string" && storageKey.length > 0) {
        return {
          ...part,
          url: `attachment://${storageKey}`,
        };
      }

      return part;
    });

    return { ...msg, parts: sanitizedParts };
  });
}

/**
 * Main API fetch handler. Intercepts `/api/*` requests and processes
 * them using local OPFS storage and AI SDK streaming.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  _originalFetch?: typeof fetch,
): Promise<Response | null> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method || "GET";

  function safeJsonParse(text: string): unknown {
    const value = JSON.parse(text);
    if (typeof value === "object" && value !== null) {
      if (
        Object.prototype.hasOwnProperty.call(value, "__proto__") ||
        Object.prototype.hasOwnProperty.call(value, "constructor")
      ) {
        throw new Error("Invalid input: prototype pollution detected");
      }
    }
    return value;
  }

  const body: any = init?.body ? safeJsonParse(init.body as string) : undefined;

  try {
    if (url === "/api/favorites" && method === "GET") {
      const chats = await listChats();
      const favorites = await Promise.all(
        chats.map(async (chat) => {
          const storedChat = await getStoredChat(chat.id);
          if (!storedChat) {
            return [];
          }
          return getFavoriteMessagesFromChat({
            ...storedChat,
            title: chat.title,
            createdAt: chat.createdAt,
          });
        }),
      );
      return jsonResponse(
        favorites
          .flat()
          .sort(
            (a, b) =>
              new Date(b.messageCreatedAt).getTime() -
              new Date(a.messageCreatedAt).getTime(),
          ),
      );
    }

    // GET /api/chats - List all chats
    if (url === "/api/chats" && method === "GET") {
      const chats = await listChats();
      return jsonResponse(chats);
    }

    // POST /api/chats - Create a new chat
    if (url === "/api/chats" && method === "POST") {
      if (!body?.id) {
        return errorResponse("Missing chat id", 400);
      }
      await saveChat(body as ChatRecord);
      return jsonResponse({ success: true });
    }

    // DELETE /api/chats - Delete all chats
    if (url === "/api/chats" && method === "DELETE") {
      await deleteAllChats();
      return jsonResponse({ success: true });
    }

    const chatIdMatch = url.match(/^\/api\/chats\/([^/]+)$/);
    const chatId = chatIdMatch ? chatIdMatch[1] : undefined;

    // GET /api/chats/:id - Retrieve a specific chat
    if (chatId && method === "GET") {
      const chat = await getChat(chatId);
      if (!chat) return errorResponse("Chat not found", 404);
      return jsonResponse({ ...annotateBranchMetadata(chat), isOwner: true });
    }

    // POST /api/chats/:id - Stream AI response
    if (chatId && method === "POST") {
      const chat = await getStoredChat(chatId);
      if (!chat) return errorResponse("Chat not found", 404);

      const { model, messages: rawMessages, webSearch } = body;
      const messages = normalizeMessageAttachments(rawMessages);

      // Validate model against the active provider's model list
      const activeProvider = await getProvider();
      const providerModels = getModels(activeProvider);
      if (!providerModels.some((m: { value: string }) => m.value === model)) {
        return errorResponse("Invalid model", 400);
      }

      // Generate title if empty (fire-and-forget — no bloquea el inicio del stream)
      if (!chat.title && messages.length > 0) {
        const userMsg = messages.find((m: UIMessage) => m.role === "user");
        if (userMsg) {
          generateChatTitle(chatId, userMsg).catch(() => {});
        }
      }

      // Save last user message if it's new
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "user") {
        await withChatLock(chatId, async () => {
          const latestChat = await getStoredChat(chatId);
          if (!latestChat) {
            return;
          }

          const [sanitizedMessage] = sanitizeMessagesForStorage([lastMessage]);
          const didChange = upsertUserMessage(latestChat, sanitizedMessage);
          const didSearchChange = latestChat.webSearch !== Boolean(webSearch);
          latestChat.webSearch = Boolean(webSearch);
          if (!didChange && !didSearchChange) {
            return;
          }

          syncCurrentBranchSnapshots(latestChat);
          await saveChat(latestChat);
        });
      }

      const provider = await getGatewayProvider();

      const isAnthropic = model.startsWith("anthropic/");

      const searchEngine = localStorage.getItem("search-engine") || "native";
      const tavilyApiKey = (await secureGetItem("tavily-api-key")) || "";
      const useTavily = Boolean(
        webSearch && searchEngine === "tavily" && tavilyApiKey,
      );

      let systemPrompt = BASE_SYSTEM_PROMPT;
      if (webSearch) {
        systemPrompt += `

---

VII. Web Research

Web research is enabled for this conversation. Do not claim that you lack internet access or browsing/search capability when research tools are available. Use the available web research tool whenever the user asks for current, time-sensitive, or externally verifiable information, and cite the sources you use by referencing their URLs.`;
      }
      if (useTavily) {
        systemPrompt += `

You have access to two web research tools: tavily_search and tavily_extract.
- Use tavily_search to find current and relevant information on the web. Provide a clear, specific query to get the best results.
- Use tavily_extract when you need to retrieve detailed raw content from specific URLs found via search or provided by the user.
- When a user asks about current events, recent data, or anything that may have changed after your training cutoff, you MUST use tavily_search.`;
      }

      const tools: Record<string, any> = {};
      if (webSearch) {
        if (useTavily) {
          tools.tavily_search = tavilySearchTool;
          tools.tavily_extract = tavilyExtractTool;
        } else {
          if (isAnthropic) {
            tools.web_search = anthropic.tools.webSearch_20250305();
          } else if (model.startsWith("openai/")) {
            tools.web_search = openai.tools.webSearch();
          }
        }
      }

      // For OpenCode, strip the provider prefix to get the actual model name,
      // and use .chat() to hit the Chat Completions endpoint instead of Responses API.
      const actualModel =
        activeProvider === "opencode" ? (model.split("/")[1] ?? model) : model;
      const result = streamText({
        model: provider(actualModel),
        system: systemPrompt,
        messages: await convertToModelMessages(
          await prepareMessagesForModel(messages, model, chat.id),
        ),
        tools,
        ...(!isAnthropic ? { stopWhen: stepCountIs(5) } : {}),
        ...(isAnthropic && {
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled", budgetTokens: 8000 },
            },
          },
        }),
      });

      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        onFinish: async ({ messages: finishedMessages }) => {
          const totalUsage = await result.totalUsage;

          await withChatLock(chatId, async () => {
            const latestChat = await getStoredChat(chatId);
            if (!latestChat) {
              return;
            }

            latestChat.messages = sanitizeMessagesForStorage(finishedMessages);
            latestChat.lastUsage = totalUsage;
            syncCurrentBranchSnapshots(latestChat);
            await saveChat(latestChat);
          });
        },
      });
    }

    // DELETE /api/chats/:id - Delete a chat
    if (chatId && method === "DELETE") {
      await deleteChat(chatId);
      return jsonResponse({ success: true });
    }

    // PATCH /api/chats/title/:id - Update chat title
    const titleMatch = url.match(/^\/api\/chats\/title\/([^/]+)$/);
    const titleChatId = titleMatch ? titleMatch[1] : undefined;
    if (titleChatId && method === "PATCH") {
      const updatedChat = await withChatLock(titleChatId, async () => {
        const chat = await getStoredChat(titleChatId);
        if (!chat) return null;
        chat.title = body.title;
        await saveChat(chat);
        return chat;
      });
      if (!updatedChat) return errorResponse("Chat not found", 404);
      return jsonResponse(updatedChat);
    }

    // PATCH /api/chats/visibility/:id - Update chat visibility
    const visibilityMatch = url.match(/^\/api\/chats\/visibility\/([^/]+)$/);
    const visibilityChatId = visibilityMatch ? visibilityMatch[1] : undefined;
    if (visibilityChatId && method === "PATCH") {
      const updatedChat = await withChatLock(visibilityChatId, async () => {
        const chat = await getStoredChat(visibilityChatId);
        if (!chat) return null;
        chat.visibility = body.visibility;
        await saveChat(chat);
        return chat;
      });
      if (!updatedChat) return errorResponse("Chat not found", 404);
      return jsonResponse(updatedChat);
    }

    // DELETE /api/chats/messages/:id - Delete/edit/regenerate messages
    const messagesMatch = url.match(/^\/api\/chats\/messages\/([^/]+)$/);
    const messagesChatId = messagesMatch ? messagesMatch[1] : undefined;
    if (messagesChatId && method === "DELETE") {
      const { messageId, type } = body;
      const updated = await withChatLock(messagesChatId, async () => {
        const chat = await getStoredChat(messagesChatId);
        if (!chat) return null;

        const targetIndex = chat.messages.findIndex(
          (m: UIMessage) => m.id === messageId,
        );
        if (targetIndex === -1) return "not-found" as const;

        const targetRole = chat.messages[targetIndex]!.role;
        if (type === "edit" && targetRole !== "user") {
          return "invalid-edit" as const;
        }
        if (type === "regenerate" && targetRole !== "assistant") {
          return "invalid-regenerate" as const;
        }

        if (type === "regenerate") {
          const parentMessage = chat.messages[targetIndex - 1];
          const hasUserParent = parentMessage?.role === "user";
          const rootMessageId = hasUserParent ? parentMessage.id : messageId;
          const includeRoot = !hasUserParent;
          const branchStartIndex = targetIndex;
          openNewBranch(
            chat,
            rootMessageId,
            includeRoot,
            branchStartIndex,
            "Regeneration",
          );
          chat.messages = chat.messages.slice(0, targetIndex);
        } else {
          openNewBranch(chat, messageId, true, targetIndex, "Edit");
          chat.messages = chat.messages.slice(0, targetIndex + 1);
        }

        syncCurrentBranchSnapshots(chat);
        await saveChat(chat);
        return chat;
      });

      if (updated === null) return errorResponse("Chat not found", 404);
      if (updated === "not-found")
        return errorResponse("Message not found", 404);
      if (updated === "invalid-edit") {
        return errorResponse("Can only edit user messages", 400);
      }
      if (updated === "invalid-regenerate") {
        return errorResponse("Can only regenerate assistant messages", 400);
      }
      return jsonResponse({ success: true });
    }

    const branchesMatch = url.match(/^\/api\/chats\/branches\/([^/]+)$/);
    const branchesChatId = branchesMatch ? branchesMatch[1] : undefined;
    if (branchesChatId && method === "POST") {
      const { rootMessageId, snapshotId } = body as {
        rootMessageId?: string;
        snapshotId?: string;
      };
      if (!rootMessageId || !snapshotId) {
        return errorResponse("Missing branch selection payload", 400);
      }

      const hydrated = await withChatLock(branchesChatId, async () => {
        const chat = await getStoredChat(branchesChatId);
        if (!chat) return null;

        const branchState = chat.branches?.[rootMessageId];
        if (!branchState) {
          return "branch-not-found" as const;
        }

        syncCurrentBranchSnapshots(chat);

        const snapshot = branchState.snapshots.find(
          (item) => item.id === snapshotId,
        );
        if (!snapshot) {
          return "snapshot-not-found" as const;
        }

        const rootIndex = chat.messages.findIndex(
          (message: UIMessage) => message.id === rootMessageId,
        );
        if (rootIndex === -1) {
          return "root-not-found" as const;
        }

        const startIndex = branchState.includeRoot ? rootIndex : rootIndex + 1;
        chat.messages = [
          ...chat.messages.slice(0, startIndex),
          ...cloneJson(snapshot.messages),
        ];
        branchState.currentSnapshotId = snapshot.id;
        syncCurrentBranchSnapshots(chat);
        await saveChat(chat);
        return await getChat(branchesChatId);
      });

      if (hydrated === null) {
        return errorResponse("Chat not found", 404);
      }
      if (hydrated === "branch-not-found") {
        return errorResponse("Branch not found", 404);
      }
      if (hydrated === "snapshot-not-found") {
        return errorResponse("Snapshot not found", 404);
      }
      if (hydrated === "root-not-found") {
        return errorResponse("Branch root not found", 404);
      }

      return jsonResponse({
        ...annotateBranchMetadata(hydrated),
        isOwner: true,
      });
    }

    // GET /api/chats/votes/:id - Get votes
    const votesGetMatch = url.match(/^\/api\/chats\/votes\/([^/]+)$/);
    const votesChatId = votesGetMatch ? votesGetMatch[1] : undefined;
    if (votesChatId && method === "GET") {
      const chat = await getStoredChat(votesChatId);
      if (!chat) return errorResponse("Chat not found", 404);
      return jsonResponse(chat.votes || []);
    }

    // POST /api/chats/votes/:id - Vote on a message
    if (votesChatId && method === "POST") {
      const { messageId, isUpvoted } = body;
      const updated = await withChatLock(votesChatId, async () => {
        const chat = await getStoredChat(votesChatId);
        if (!chat) return null;

        const targetMessage = chat.messages.find(
          (m: UIMessage) => m.id === messageId,
        );
        if (!targetMessage) return "message-not-found" as const;
        if (targetMessage.role !== "assistant") {
          return "invalid-target" as const;
        }

        let votes = chat.votes || [];
        if (isUpvoted === undefined) {
          votes = votes.filter(
            (v: { messageId: string }) => v.messageId !== messageId,
          );
        } else {
          const existing = votes.find(
            (v: { messageId: string }) => v.messageId === messageId,
          );
          if (existing) {
            existing.isUpvoted = isUpvoted;
          } else {
            votes.push({ chatId: chat.id, messageId, isUpvoted });
          }
        }
        chat.votes = votes;
        await saveChat(chat);
        return chat;
      });

      if (!updated) return errorResponse("Chat not found", 404);
      if (updated === "message-not-found")
        return errorResponse("Message not found", 404);
      if (updated === "invalid-target") {
        return errorResponse("Can only vote on assistant messages", 400);
      }
      return jsonResponse({ chatId: updated.id, messageId, isUpvoted });
    }

    // Not a chat route – let the original fetch handle it (e.g. /api/ai-gateway)
    return null;
  } catch (err: any) {
    if (import.meta.env.DEV) {
      console.error("[clientApi]", err);
    }
    return errorResponse(err?.message || "Internal error", 500);
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ message }, status);
}
