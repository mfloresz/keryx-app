import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFirstUnsupportedCloudAttachmentUrl,
  prepareMessagesForModel,
} from "./chatCore.js";

describe("getFirstUnsupportedCloudAttachmentUrl", () => {
  it("permite adjuntos inline con data URLs", () => {
    const messages = [
      {
        role: "user",
        parts: [
          {
            type: "file",
            filename: "nota.txt",
            mediaType: "text/plain",
            url: "data:text/plain;base64,SG9sYQ==",
          },
        ],
      },
    ];

    expect(getFirstUnsupportedCloudAttachmentUrl(messages)).toBeNull();
  });

  it("rechaza URLs remotas en adjuntos cloud", () => {
    const messages = [
      {
        role: "user",
        parts: [
          {
            type: "file",
            filename: "nota.txt",
            mediaType: "text/plain",
            url: "https://attacker.example/internal.txt",
          },
        ],
      },
    ];

    expect(getFirstUnsupportedCloudAttachmentUrl(messages)).toBe(
      "https://attacker.example/internal.txt",
    );
  });
});

describe("prepareMessagesForModel (cloud/shared)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("inyecta contenido de archivos de texto desde data URLs", async () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "Resume este archivo" },
          {
            type: "file",
            filename: "nota.txt",
            mediaType: "text/plain",
            url: "data:text/plain;base64,SG9sYSBkZXNkZSBjbG91ZA==",
          },
        ],
      },
    ];

    const result = await prepareMessagesForModel(messages, "openai/gpt-5");
    expect(result[0].parts[0].text).toContain("Hola desde cloud");
    expect(result[0].parts.some((part: any) => part.type === "file")).toBe(false);
  });

  it("no hace fetch remoto para URLs externas", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;

    const messages = [
      {
        role: "user",
        parts: [
          {
            type: "file",
            filename: "nota.txt",
            mediaType: "text/plain",
            url: "https://attacker.example/payload.txt",
          },
        ],
      },
    ];

    const result = await prepareMessagesForModel(messages, "openai/gpt-5");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result[0].parts[0]).toMatchObject({
      type: "file",
      url: "https://attacker.example/payload.txt",
    });
  });
});
