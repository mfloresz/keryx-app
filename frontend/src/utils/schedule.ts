/**
 * Pure helpers to parse and humanize automation schedule specs
 * ("every:15m" | "every:30m" | "every:1h" | "every:6h" | "every:12h" |
 * "every:24h" | "daily:HH:MM").
 */

export type ParsedSchedule =
  | { kind: "every"; value: number; unit: "m" | "h" }
  | { kind: "daily"; time: string };

/** Parses a schedule spec; returns null when it is malformed. */
export function parseSchedule(spec: string): ParsedSchedule | null {
  // Split on the first colon only: the daily spec itself contains one.
  const firstColon = spec.indexOf(":");
  if (firstColon < 0) return null;
  const kind = spec.slice(0, firstColon);
  const arg = spec.slice(firstColon + 1);
  if (kind === "every") {
    const match = /^(\d+)([mh])$/.exec(arg);
    if (!match) return null;
    const value = Number(match[1]);
    if (!value) return null;
    return { kind: "every", value, unit: match[2] as "m" | "h" };
  }
  if (kind === "daily") {
    if (!/^\d{2}:\d{2}$/.test(arg)) return null;
    return { kind: "daily", time: arg };
  }
  return null;
}

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Humanizes a schedule spec via i18n; falls back to the raw spec when it is
 * not parseable so unknown backend values never render as a missing key.
 */
export function formatScheduleLabel(spec: string, t: Translate): string {
  const parsed = parseSchedule(spec);
  if (!parsed) return spec;
  if (parsed.kind === "daily") {
    return t("automations.dailyAt", { time: parsed.time });
  }
  if (parsed.unit === "m") {
    return t("automations.everyMinutes", { value: parsed.value });
  }
  return parsed.value === 1
    ? t("automations.everyHour")
    : t("automations.everyHours", { value: parsed.value });
}
