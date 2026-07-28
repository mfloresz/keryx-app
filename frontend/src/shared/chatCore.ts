import type { ChatBranchState, ChatRecord } from "../domain/chat/types.js";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
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


