import type { ModelRepository } from "@/domain/models/ports";
import type { ChatModel, ModelProviderOption, ModelSelection } from "@/domain/models/types";
import { getAuthAdapter } from "@/services/runtime";

const ALLOWED_MODELS_CACHE_TTL_MS = 60_000;

let allowedModelsCache: {
  userId: string | null;
  models: ChatModel[];
  cachedAt: number;
} | null = null;
let allowedModelsRequest: { userId: string; promise: Promise<ChatModel[]> } | null = null;

async function fetchAllowedModels(): Promise<ChatModel[]> {
  const auth = await getAuthAdapter();
  const session = await auth.getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) return [];

  const now = Date.now();
  if (allowedModelsCache?.userId === userId && now - allowedModelsCache.cachedAt < ALLOWED_MODELS_CACHE_TTL_MS) {
    return [...allowedModelsCache.models];
  }
  if (allowedModelsRequest?.userId === userId) {
    return allowedModelsRequest.promise;
  }

  const promise = (async () => {
    const response = await fetch("/api/models/allowed");
    if (!response.ok) return [];

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

  allowedModelsRequest = { userId, promise };
  try {
    const models = await promise;
    allowedModelsCache = { userId, models, cachedAt: Date.now() };
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
    const model = models.some((m) => m.value === stored) ? stored! : (models[0]?.value ?? "");
    return { provider: "managed", model };
  },

  async saveSelection(selection: ModelSelection): Promise<void> {
    localStorage.setItem("keryx-model", selection.model);
  },

  allowsLocalKeys() {
    return false;
  },
};
