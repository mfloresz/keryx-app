import type { ModelRepository } from "@/domain/models/ports";
import type { ChatModel, ModelProviderOption, ModelSelection } from "@/domain/models/types";
import { getAuthAdapter } from "@/services/runtime";

const DEFAULT_MODEL = "openai/gpt-5.4-nano";
const ALLOWED_MODELS_CACHE_TTL_MS = 60_000;

let allowedModelsCache: {
  token: string | null;
  models: ChatModel[];
  cachedAt: number;
} | null = null;
let allowedModelsRequest: { token: string; promise: Promise<ChatModel[]> } | null = null;

async function fetchAllowedModels(): Promise<ChatModel[]> {
  const auth = await getAuthAdapter();
  const session = await auth.getSession();
  const token = session?.accessToken ?? null;
  if (!token) return [{ label: "GPT-5.4 Nano", value: DEFAULT_MODEL, supportsImages: true, supportsSearch: true, maxContextTokens: 128000, maxOutputTokens: 16384 }];

  const now = Date.now();
  if (allowedModelsCache?.token === token && now - allowedModelsCache.cachedAt < ALLOWED_MODELS_CACHE_TTL_MS) {
    return [...allowedModelsCache.models];
  }
  if (allowedModelsRequest?.token === token) {
    return allowedModelsRequest.promise;
  }

  const promise = (async () => {
    const response = await fetch("/api/models/allowed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [{ label: "GPT-5.4 Nano", value: DEFAULT_MODEL, supportsImages: true, supportsSearch: true, maxContextTokens: 128000, maxOutputTokens: 16384 }];

    const payload = (await response.json()) as Array<{
      displayName?: string; id: string; provider?: string;
      supportsImages?: boolean; supportsSearch?: boolean;
      maxContextTokens?: number; maxOutputTokens?: number;
    }>;
    return payload.map((m) => ({
      label: m.displayName || m.id,
      value: m.id,
      supportsImages: Boolean(m.supportsImages),
      supportsSearch: Boolean(m.supportsSearch),
      maxContextTokens: m.maxContextTokens ?? 128000,
      maxOutputTokens: m.maxOutputTokens ?? 16384,
    }));
  })();

  allowedModelsRequest = { token, promise };
  try {
    const models = await promise;
    allowedModelsCache = { token, models, cachedAt: Date.now() };
    return [...models];
  } finally {
    if (allowedModelsRequest?.promise === promise) allowedModelsRequest = null;
  }
}

export const apiModelRepository: ModelRepository = {
  async listProviders(): Promise<ModelProviderOption[]> {
    return [{ label: "Managed Models", value: "managed" }];
  },

  async listModels(): Promise<ChatModel[]> {
    return fetchAllowedModels();
  },

  async getSelection(): Promise<ModelSelection> {
    const models = await fetchAllowedModels();
    const stored = localStorage.getItem("keryx-model");
    const model = models.some((m) => m.value === stored) ? stored! : (models[0]?.value ?? DEFAULT_MODEL);
    return { provider: "managed", model };
  },

  async saveSelection(selection: ModelSelection): Promise<void> {
    localStorage.setItem("keryx-model", selection.model);
  },

  allowsLocalKeys() {
    return false;
  },
};
