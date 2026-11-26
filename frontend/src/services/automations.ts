/**
 * Automations API client.
 *
 * An automation runs an agent's task prompt on a schedule (or via webhook),
 * in its own chat. Follows the admin-api.ts fetch pattern.
 */
import { getAuthAdapter } from "#/services/runtime";

/**
 * Schedule spec: "every:15m" | "every:30m" | "every:1h" | "every:6h" |
 * "every:12h" | "every:24h" | "daily:HH:MM".
 */
export type ScheduleSpec = string;

export interface Automation {
  id: string;
  agentId: string;
  taskPrompt: string;
  schedule: ScheduleSpec;
  webhookOutUrl: string | null;
  allowWriteTools: boolean;
  enabled: boolean;
  /** Chat where automation runs land; null until the first run. */
  chatId: string | null;
  lastRun: string | null;
  nextRun: string | null;
  consecutiveFailures: number;
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  status: "success" | "error";
  summary: string;
  outputMessageId: string | null;
  createdAt: string;
}

async function automationsFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const auth = await getAuthAdapter();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(await auth.getAuthorizationHeaders()),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(path, { ...init, headers });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Request failed: ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export const listAutomations = () =>
  automationsFetch("/api/automations").then((r) => readJson<Automation[]>(r));

export const createAutomation = (payload: {
  agentId: string;
  taskPrompt: string;
  schedule: ScheduleSpec;
  webhookOutUrl?: string;
  allowWriteTools: boolean;
}) =>
  automationsFetch("/api/automations", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((r) => readJson<Automation>(r));

export const updateAutomation = (
  id: string,
  payload: Partial<{
    taskPrompt: string;
    schedule: ScheduleSpec;
    webhookOutUrl: string | null;
    allowWriteTools: boolean;
    enabled: boolean;
  }>,
) =>
  automationsFetch(`/api/automations/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }).then((r) => readJson<Automation>(r));

export const deleteAutomation = (id: string) =>
  automationsFetch(`/api/automations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then((r) => readJson<{ success: boolean }>(r));

/** Triggers a run; the run itself fires asynchronously. */
export const triggerAutomation = (id: string) =>
  automationsFetch(`/api/automations/${encodeURIComponent(id)}/trigger`, {
    method: "POST",
  }).then((r) => readJson<{ success: boolean }>(r));

export const listAutomationRuns = (id: string) =>
  automationsFetch(`/api/automations/${encodeURIComponent(id)}/runs`).then(
    (r) => readJson<AutomationRun[]>(r),
  );
