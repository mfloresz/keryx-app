import { describe, expect, it } from "vitest";

import { buildChatRequestBody } from "#/utils/chat-request";

const base = {
  preset: "fast",
  webSearch: false,
  language: "es",
  username: "ana",
};

describe("buildChatRequestBody", () => {
  it("carries the shared context fields", () => {
    const body = buildChatRequestBody({
      ...base,
      now: () => new Date("2026-01-02T03:04:05Z"),
      timezone: "Europe/Madrid",
    });
    expect(body.preset).toBe("fast");
    expect(body.webSearch).toBe(false);
    expect(body.language).toBe("es");
    expect(body.username).toBe("ana");
    expect(body.datetime).toBe("2026-01-02T03:04:05.000Z");
    expect(body.timezone).toBe("Europe/Madrid");
  });

  it("omits agent/project when unset", () => {
    const body = buildChatRequestBody(base);
    expect("agentId" in body).toBe(false);
    expect("projectId" in body).toBe(false);
  });

  it("includes agentId and projectId when set", () => {
    const body = buildChatRequestBody({
      ...base,
      agentId: "agent-1",
      projectId: "project-1",
    });
    expect(body.agentId).toBe("agent-1");
    expect(body.projectId).toBe("project-1");
  });

  it("omits pinnedSkills when empty", () => {
    const body = buildChatRequestBody({ ...base, pinnedSkills: [] });
    expect("pinnedSkills" in body).toBe(false);
  });

  it("includes pinnedSkills when the user pinned skills", () => {
    const body = buildChatRequestBody({
      ...base,
      pinnedSkills: ["summarize", "translate"],
    });
    expect(body.pinnedSkills).toEqual(["summarize", "translate"]);
  });
});
