/**
 * Tests for the model-artifact extractor: `data-artifact` parts land in
 * rehydrated transcripts as well as live streams, and a regenerated answer
 * can re-announce the same artifact with a newer version.
 */
import { describe, expect, it } from "vitest";

import {
  extractHtmlArtifacts,
  extractModelArtifacts,
  modelArtifactFromPart,
} from "#/utils/html-artifacts";

describe("extractModelArtifacts", () => {
  it("collects data-artifact parts across messages", () => {
    const artifacts = extractModelArtifacts([
      {
        id: "m1",
        parts: [
          { type: "text", text: "hi" },
          {
            type: "data-artifact",
            id: "part-1",
            data: {
              artifactId: "art_1",
              title: "Demo",
              artifactType: "markdown",
              version: 1,
            },
          },
        ],
      },
      {
        id: "m2",
        parts: [
          {
            type: "data-artifact",
            id: "part-2",
            data: {
              artifactId: "art_2",
              title: "Page",
              artifactType: "html",
              version: 3,
            },
          },
        ],
      },
    ]);

    expect(artifacts).toEqual([
      {
        key: "art_1",
        artifactId: "art_1",
        title: "Demo",
        type: "markdown",
        version: 1,
      },
      {
        key: "art_2",
        artifactId: "art_2",
        title: "Page",
        type: "html",
        version: 3,
      },
    ]);
  });

  it("dedupes by artifactId keeping the max version", () => {
    const artifacts = extractModelArtifacts([
      {
        id: "m1",
        parts: [
          {
            type: "data-artifact",
            data: {
              artifactId: "art_1",
              title: "Old",
              artifactType: "html",
              version: 2,
            },
          },
        ],
      },
      {
        id: "m2",
        parts: [
          {
            type: "data-artifact",
            data: {
              artifactId: "art_1",
              title: "Old",
              artifactType: "html",
              version: 5,
            },
          },
        ],
      },
      {
        id: "m3",
        parts: [
          // An older re-announcement must not lower the version.
          {
            type: "data-artifact",
            data: {
              artifactId: "art_1",
              title: "Old",
              artifactType: "html",
              version: 1,
            },
          },
        ],
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ artifactId: "art_1", version: 5 });
  });

  it("ignores malformed parts and defaults the version to 1", () => {
    const artifacts = extractModelArtifacts([
      {
        id: "m1",
        parts: [
          { type: "data-artifact", data: { title: "no id" } },
          { type: "text", text: "unrelated" },
          {
            type: "data-artifact",
            data: { artifactId: "art_1", title: "", artifactType: "weird" },
          },
        ],
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      artifactId: "art_1",
      title: "art_1",
      type: "html",
      version: 1,
    });
  });

  it("accepts the live stream shape, where version is a string", () => {
    // The SSE `artifact` event is a map[string]string, so the version arrives
    // quoted; the persisted part uses a number.
    const artifact = modelArtifactFromPart({
      type: "data-artifact",
      id: "artpart-art_1-v3",
      data: {
        artifactId: "art_1",
        title: "Page",
        artifactType: "html",
        version: "3",
      },
    });

    expect(artifact).toMatchObject({ artifactId: "art_1", version: 3 });
  });
});

describe("extractHtmlArtifacts", () => {
  it("still extracts fenced HTML after the data-artifact additions", () => {
    const artifacts = extractHtmlArtifacts([
      {
        id: "m1",
        parts: [{ type: "text", text: "Here:\n```html\n<p>hi</p>\n```\ndone" }],
      },
    ]);

    expect(artifacts).toEqual([
      { key: "m1#0", messageId: "m1", index: 0, code: "<p>hi</p>" },
    ]);
  });
});
