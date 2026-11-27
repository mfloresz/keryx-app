import type {
  ChatBranchState,
  ChatRecord,
} from "#/domain/chat/types";
import { randomUUID } from "#/shared/uuid";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function syncCurrentBranchSnapshots(chat: ChatRecord) {
  const branchStates = Object.values(chat.branches ?? {}) as ChatBranchState[];
  branchStates.forEach((state) => {
    const rootIndex = (chat.messages as any[]).findIndex(
      (message: any) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) return;

    const startIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const currentSnapshot = state.snapshots.find(
      (snapshot) => snapshot.id === state.currentSnapshotId,
    );
    if (!currentSnapshot) return;

    currentSnapshot.messages = cloneJson(
      (chat.messages as any[]).slice(startIndex),
    );
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
  const snapshotId = randomUUID();
  branchState = {
    rootMessageId,
    includeRoot,
    currentSnapshotId: snapshotId,
    snapshots: [
      {
        id: snapshotId,
        label: "Original",
        createdAt,
        messages: cloneJson((chat.messages as any[]).slice(startIndex)),
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
    id: randomUUID(),
    label: `${labelPrefix} ${nextNumber}`,
    createdAt,
    messages: [] as unknown[],
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

    const rootIndex = (annotated.messages as any[]).findIndex(
      (message: any) => message.id === state.rootMessageId,
    );
    if (rootIndex === -1) return;

    const targetIndex = state.includeRoot ? rootIndex : rootIndex + 1;
    const targetMessage = (annotated.messages as any[])[targetIndex];
    if (!targetMessage) return;

    const currentIndex = state.snapshots.findIndex(
      (snapshot) => snapshot.id === state.currentSnapshotId,
    );

    targetMessage.metadata = {
      ...targetMessage.metadata,
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
  const existingIndex = (chat.messages as any[]).findIndex(
    (item: any) => item.id === message.id,
  );
  const nextMessage = {
    ...message,
    chatId: chat.id,
    createdAt:
      existingIndex === -1
        ? new Date().toISOString()
        : ((chat.messages as any[])[existingIndex]?.createdAt ??
          new Date().toISOString()),
  };

  if (existingIndex === -1) {
    chat.messages.push(nextMessage);
    return true;
  }

  const previousMessage = (chat.messages as any[])[existingIndex];
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
      id: randomUUID(),
    };
  });
}

/**
 * True when a message has anything the transcript can render.
 *
 * Used to decide whether the "thinking" placeholder is still needed: an
 * assistant message that only carries an empty text part (the transport
 * opens one as soon as the run starts) is not renderable yet.
 */
export function hasRenderableContent(
  message: { parts?: unknown[] | null } | null | undefined,
): boolean {
  if (!message || !Array.isArray(message.parts)) return false;

  return message.parts.some((part) => {
    if (!part || typeof part !== "object") return false;
    const candidate = part as { type?: unknown; text?: unknown };
    const type = candidate.type;

    if (type === "text") {
      return (
        typeof candidate.text === "string" && candidate.text.trim().length > 0
      );
    }
    if (type === "reasoning" || type === "file") return true;
    if (typeof type !== "string") return false;

    // Tool, source and data parts render a row of their own. Structural
    // parts such as `step-start` are deliberately excluded: they carry no
    // visible output and would hide the placeholder too early.
    return (
      type === "dynamic-tool" ||
      type.startsWith("tool-") ||
      type.startsWith("source-") ||
      type.startsWith("data-")
    );
  });
}
