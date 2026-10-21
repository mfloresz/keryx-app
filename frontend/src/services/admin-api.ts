/**
 * Admin API client.
 *
 * Every endpoint the admin console needs, in one place, with the response
 * shapes the Go backend returns.
 */
import { getAuthAdapter } from "#/services/runtime";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface AdminInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AdminModel {
  id: string;
  displayName: string;
  provider: string;
  enabled: boolean;
}

export interface CatalogModel {
  id: string;
  provider: string;
  displayName: string;
}

export interface ProviderKey {
  provider: string;
  label: string;
  configured: boolean;
  updatedAt?: string | null;
}

export interface WebSearchConfig {
  enabled: boolean;
  configured: boolean;
}

export interface TitleGenerationPolicy {
  mode: "chat_model" | "custom";
  modelId?: string;
}

export interface ModelPreset {
  presetId: string;
  modelId: string;
  label: string;
}

export interface PromptOverride {
  key: string;
  prompt: string;
  source: "embedded" | "override";
  updatedAt?: string;
}

export interface GlobalAgent {
  id: string;
  builtinId?: string;
  name: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  source: "builtin" | "override" | "global_custom" | "user_custom";
}

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
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

// ---- Users ----
export const listAdminUsers = () =>
  adminFetch("/api/admin/users").then((r) => readJson<AdminUser[]>(r));

export const updateAdminUserRole = (id: string, role: string) =>
  adminFetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  }).then((r) => readJson<Record<string, unknown>>(r));

// ---- Invitations ----
export const listAdminInvitations = () =>
  adminFetch("/api/admin/invitations").then((r) =>
    readJson<AdminInvitation[]>(r),
  );

export const createAdminInvitation = (email: string, role: string) =>
  adminFetch("/api/admin/invitations", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  }).then((r) => readJson<{ token?: string; url?: string }>(r));

export const deleteAdminInvitation = (id: string) =>
  adminFetch(`/api/admin/invitations/${id}`, { method: "DELETE" }).then((r) =>
    readJson<Record<string, unknown>>(r),
  );

export const sendAdminInvitation = (email: string, token: string) =>
  adminFetch("/api/admin/invitations/send", {
    method: "POST",
    body: JSON.stringify({ email, token }),
  }).then((r) => readJson<Record<string, unknown>>(r));

// ---- Provider keys ----
export const listProviderKeys = () =>
  adminFetch("/api/admin/provider-keys").then((r) =>
    readJson<ProviderKey[]>(r),
  );

export const upsertProviderKey = (provider: string, apiKey: string) =>
  adminFetch(`/api/admin/provider-keys/${provider}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  }).then((r) => readJson<Record<string, unknown>>(r));

export const deleteProviderKey = (provider: string) =>
  adminFetch(`/api/admin/provider-keys/${provider}`, { method: "DELETE" }).then(
    (r) => readJson<Record<string, unknown>>(r),
  );

// ---- Web search ----
export const getWebSearchConfig = () =>
  adminFetch("/api/admin/web-search-config").then((r) =>
    readJson<WebSearchConfig>(r),
  );

export const setWebSearchConfig = (apiKey: string, enabled: boolean) =>
  adminFetch("/api/admin/web-search-config", {
    method: "PUT",
    body: JSON.stringify({ apiKey, enabled }),
  }).then((r) => readJson<Record<string, unknown>>(r));

// ---- Models ----
export const listAdminModels = () =>
  adminFetch("/api/admin/models").then((r) => readJson<AdminModel[]>(r));

export const updateAdminModel = (id: string, enabled: boolean) =>
  adminFetch(`/api/admin/models/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  }).then((r) => readJson<Record<string, unknown>>(r));

export const getTitleGenerationPolicy = () =>
  adminFetch("/api/admin/title-generation-policy").then((r) =>
    readJson<{
      policy: TitleGenerationPolicy;
      catalog: CatalogModel[];
    }>(r),
  );

export const setTitleGenerationPolicy = (
  mode: TitleGenerationPolicy["mode"],
  modelId: string,
) =>
  adminFetch("/api/admin/title-generation-policy", {
    method: "PUT",
    body: JSON.stringify({ mode, modelId }),
  }).then((r) => readJson<Record<string, unknown>>(r));

export const getModelPresets = () =>
  adminFetch("/api/admin/model-presets").then((r) =>
    readJson<{ presets: ModelPreset[]; catalog: CatalogModel[] }>(r),
  );

export const setModelPreset = (presetId: string, modelId: string) =>
  adminFetch(`/api/admin/model-presets/${presetId}`, {
    method: "PUT",
    body: JSON.stringify({ modelId }),
  }).then((r) => readJson<Record<string, unknown>>(r));

// ---- Prompt overrides ----
export const getPromptOverrides = () =>
  adminFetch("/api/admin/prompt-overrides").then((r) =>
    readJson<{ base: PromptOverride; title: PromptOverride }>(r),
  );

export const setPromptOverride = (key: string, prompt: string) =>
  adminFetch(`/api/admin/prompt-overrides/${key}`, {
    method: "PUT",
    body: JSON.stringify({ prompt }),
  }).then((r) => readJson<Record<string, unknown>>(r));

export const deletePromptOverride = (key: string) =>
  adminFetch(`/api/admin/prompt-overrides/${key}`, { method: "DELETE" }).then(
    (r) => readJson<Record<string, unknown>>(r),
  );

// ---- Global agents ----
export const listAdminAgents = () =>
  adminFetch("/api/admin/agents").then((r) => readJson<GlobalAgent[]>(r));

export const createAdminAgent = (payload: {
  name: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  builtinId?: string;
}) =>
  adminFetch("/api/admin/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((r) => readJson<GlobalAgent>(r));

export const updateAdminAgent = (
  id: string,
  payload: {
    name: string;
    description?: string;
    icon?: string;
    systemPrompt: string;
  },
) =>
  adminFetch(`/api/admin/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }).then((r) => readJson<GlobalAgent>(r));

export const deleteAdminAgent = (id: string) =>
  adminFetch(`/api/admin/agents/${id}`, { method: "DELETE" }).then((r) =>
    readJson<Record<string, unknown>>(r),
  );
