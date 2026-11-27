/**
 * Branch annotation contract.
 *
 * The server persists a branch snapshot for every regeneration, and the
 * navigator in the message item reads the metadata this function attaches.
 */
import { describe, expect, it } from "vitest";

import { annotateBranchMetadata, hasRenderableContent } from "#/shared/chat-core";

const branches = {
  root1: {
    rootMessageId: "root1",
    includeRoot: false,
    currentSnapshotId: "snap2",
    snapshots: [
      { id: "snap1", label: "Original", createdAt: "t1", messages: [] },
      { id: "snap2", label: "Version 2", createdAt: "t2", messages: [] },
    ],
  },
};

describe("annotateBranchMetadata", () => {
  it("attaches the branch metadata to the message after the root", () => {
    const annotated = annotateBranchMetadata({
      id: "chat1",
      title: null,
      visibility: "private",
      createdAt: "t",
      messages: [
        { id: "root1", role: "user", parts: [{ type: "text", text: "hi" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "yo" }] },
      ],
      votes: [],
      branches,
    } as never);

    const target = annotated.messages[1] as unknown as {
      metadata?: { keryxBranch?: Record<string, unknown> };
    };
    expect(target.metadata?.keryxBranch).toMatchObject({
      rootMessageId: "root1",
      currentSnapshotId: "snap2",
      currentIndex: 1,
      snapshotCount: 2,
    });
  });

  it("leaves the messages untouched when there is a single snapshot", () => {
    const annotated = annotateBranchMetadata({
      id: "chat1",
      title: null,
      visibility: "private",
      createdAt: "t",
      messages: [
        { id: "root1", role: "user", parts: [] },
        { id: "a1", role: "assistant", parts: [] },
      ],
      votes: [],
      branches: {
        root1: { ...branches.root1, snapshots: [branches.root1.snapshots[0]] },
      },
    } as never);

    const target = annotated.messages[1] as unknown as {
      metadata?: { keryxBranch?: unknown };
    };
    expect(target.metadata?.keryxBranch).toBeUndefined();
  });
});

describe("hasRenderableContent", () => {
  it("is false for an empty or structural-only message", () => {
    expect(hasRenderableContent(null)).toBe(false);
    expect(hasRenderableContent({ parts: [] })).toBe(false);
    expect(hasRenderableContent({ parts: [{ type: "step-start" }] })).toBe(
      false,
    );
    expect(
      hasRenderableContent({ parts: [{ type: "text", text: "   " }] }),
    ).toBe(false);
  });

  it("is true once the message has visible output", () => {
    expect(
      hasRenderableContent({ parts: [{ type: "text", text: "hello" }] }),
    ).toBe(true);
    expect(hasRenderableContent({ parts: [{ type: "reasoning" }] })).toBe(true);
    expect(
      hasRenderableContent({ parts: [{ type: "tool-read_file" }] }),
    ).toBe(true);
    expect(hasRenderableContent({ parts: [{ type: "file" }] })).toBe(true);
  });
});
