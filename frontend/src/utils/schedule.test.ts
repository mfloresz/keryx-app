import { describe, expect, it } from "vitest";

import { formatScheduleLabel, parseSchedule } from "#/utils/schedule";

describe("parseSchedule", () => {
  it("parses every-interval specs", () => {
    expect(parseSchedule("every:15m")).toEqual({
      kind: "every",
      value: 15,
      unit: "m",
    });
    expect(parseSchedule("every:1h")).toEqual({
      kind: "every",
      value: 1,
      unit: "h",
    });
    expect(parseSchedule("every:24h")).toEqual({
      kind: "every",
      value: 24,
      unit: "h",
    });
  });

  it("parses daily specs", () => {
    expect(parseSchedule("daily:09:30")).toEqual({
      kind: "daily",
      time: "09:30",
    });
  });

  it("rejects malformed specs", () => {
    expect(parseSchedule("every:")).toBeNull();
    expect(parseSchedule("every:15x")).toBeNull();
    expect(parseSchedule("every:0m")).toBeNull();
    expect(parseSchedule("daily:9am")).toBeNull();
    expect(parseSchedule("weekly:1h")).toBeNull();
    expect(parseSchedule("")).toBeNull();
  });
});

describe("formatScheduleLabel", () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    const labels: Record<string, string> = {
      "automations.everyMinutes": "Every {value} min",
      "automations.everyHour": "Every hour",
      "automations.everyHours": "Every {value} h",
      "automations.dailyAt": "Daily at {time}",
    };
    const template = labels[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in params ? String(params[name]) : m,
    );
  };

  it("humanizes interval specs", () => {
    expect(formatScheduleLabel("every:15m", t)).toBe("Every 15 min");
    expect(formatScheduleLabel("every:1h", t)).toBe("Every hour");
    expect(formatScheduleLabel("every:6h", t)).toBe("Every 6 h");
  });

  it("humanizes daily specs", () => {
    expect(formatScheduleLabel("daily:08:00", t)).toBe("Daily at 08:00");
  });

  it("falls back to the raw spec when malformed", () => {
    expect(formatScheduleLabel("every:7w", t)).toBe("every:7w");
  });
});
