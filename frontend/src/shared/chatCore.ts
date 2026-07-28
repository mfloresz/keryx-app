import type { ChatBranchState, ChatRecord } from "../domain/chat/types.js";

export function cloneJson<T>(value: T): T {
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

function getAttachmentStorageKey(part: any): string | null {
  if (typeof part?.url === "string" && part.url.startsWith("attachment://")) {
    return part.url.slice("attachment://".length);
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

function isInlineDataAttachmentUrl(url: string): boolean {
  return url.startsWith("data:");
}

export function getFirstUnsupportedCloudAttachmentUrl(
  messages: any[],
): string | null {
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message.parts)) {
      continue;
    }

    for (const part of message.parts) {
      if (part?.type !== "file") {
        continue;
      }

      if (
        typeof part.url === "string" &&
        part.url.length > 0 &&
        !isInlineDataAttachmentUrl(part.url)
      ) {
        return part.url;
      }
    }
  }

  return null;
}

async function extractTextFromUrl(url: string): Promise<string | null> {
  if (url.startsWith("data:")) {
    try {
      const [header, base64] = url.split(",");
      if (!header || !base64) return null;
      const isBase64 = header.includes(";base64");
      const mimeMatch = header.match(/data:([^;]+)/);
      const mime = mimeMatch?.[1] ?? "";
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

  return null;
}

async function extractTextFromFilePart(
  filePart: { url?: string; filename?: string; mediaType?: string },
  resolvedUrl: string | null,
): Promise<string | null> {
  if (!resolvedUrl) return null;

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
    return null;
  }

  return await extractTextFromUrl(resolvedUrl);
}

export function syncCurrentBranchSnapshots(chat: ChatRecord) {
  const branchStates = Object.values(chat.branches ?? {}) as ChatBranchState[];
  branchStates.forEach((state) => {
    const rootIndex = chat.messages.findIndex(
      (message: any) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) return;

    const startIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const currentSnapshot = state.snapshots.find(
      (snapshot) => snapshot.id === state.currentSnapshotId,
    );
    if (!currentSnapshot) return;

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
  if (branchState) return branchState;

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
  const branchStates = Object.values(
    annotated.branches ?? {},
  ) as ChatBranchState[];

  branchStates.forEach((state) => {
    if (state.snapshots.length <= 1) return;

    const rootIndex = annotated.messages.findIndex(
      (message: any) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) return;

    const targetIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const targetMessage = annotated.messages[targetIndex];
    if (!targetMessage) return;

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

export function upsertUserMessage(chat: ChatRecord, message: any): boolean {
  const existingIndex = chat.messages.findIndex(
    (item: any) => item.id === message.id,
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

export function ensureMessageIdentifiers(messages: any[]): any[] {
  return messages.map((message) => {
    if (typeof message?.id === "string" && message.id.trim().length > 0) {
      return message;
    }

    return {
      ...message,
      id: crypto.randomUUID(),
    };
  });
}

export function sanitizeMessagesForStorage(messages: any[]): any[] {
  return ensureMessageIdentifiers(messages).map((msg) => {
    if (!Array.isArray(msg.parts)) return msg;
    const sanitizedParts = msg.parts.map((part: any) => {
      if (part?.type !== "file") return part;
      const storageKey = getAttachmentStorageKey(part);
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

export function normalizeMessageAttachments(messages: any[]): any[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || !Array.isArray(msg.parts)) {
      return msg;
    }

    const normalizedParts = msg.parts.map((part: any) => {
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

    return { ...msg, parts: normalizedParts };
  });
}

export async function prepareMessagesForModel(
  messages: any[],
  model: string,
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
        const resolvedUrl =
          typeof filePart.url === "string"
            ? filePart.url
            : getAttachmentStorageKey(filePart)
              ? `attachment://${getAttachmentStorageKey(filePart)}`
              : null;

        if (isImage) {
          if (isDeepSeek) continue;
          remainingParts.push({
            ...filePart,
            ...(resolvedUrl ? { url: resolvedUrl } : {}),
          });
          continue;
        }

        const content = await extractTextFromFilePart(filePart, resolvedUrl);
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

      const newParts: any[] = [];
      if (combinedText.trim()) {
        newParts.push({ type: "text", text: combinedText.trim() });
      }
      newParts.push(...remainingParts);
      return { ...msg, parts: newParts };
    }),
  );
}
