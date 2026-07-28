import type { ModelRepository } from "@/domain/models/ports";
import type {
  ChatModel,
  ModelProviderOption,
  ModelSelection,
} from "@/domain/models/types";
import {
  getModelContextWindow,
  getModelMaxOutputTokens,
  VERCEL_MODELS,
} from "@/shared/utils/models";
import { getAuthAdapter } from "@/services/runtime";

const DEFAULT_MODEL = VERCEL_MODELS[0]?.value ?? "openai/gpt-5.4-nano";
const ALLOWED_MODELS_CACHE_TTL_MS = 60_000;

let allowedModelsCache: {
  token: string | null;
  models: ChatModel[];
  cachedAt: number;
} | null = null;
let allowedModelsRequest: {
  token: string;
  promise: Promise<ChatModel[]>;
} | null = null;

async function fetchAllowedModels(): Promise<ChatModel[]> {
  const auth = await getAuthAdapter();
  const session = await auth.getSession();
  const token = session?.accessToken ?? null;
  if (!token) {
    return [...VERCEL_MODELS];
  }

  const now = Date.now();
  if (
    allowedModelsCache?.token === token &&
    now - allowedModelsCache.cachedAt < ALLOWED_MODELS_CACHE_TTL_MS
  ) {
    return [...allowedModelsCache.models];
  }

  if (allowedModelsRequest?.token === token) {
    return await allowedModelsRequest.promise;
  }

  const promise = (async () => {
    const response = await fetch("/api/models/allowed", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return [...VERCEL_MODELS];
    }

    const payload = (await response.json()) as Array<{
      displayName?: string;
      id: string;
      provider?: string;
      supportsImages?: boolean;
      supportsSearch?: boolean;
    }>;

    return payload.map((model) => ({
      label: model.displayName || model.id,
      value: model.id,
      supportsImages: Boolean(model.supportsImages),
      supportsSearch: Boolean(model.supportsSearch),
      maxContextTokens: getModelContextWindow(model.id) ?? 0,
      maxOutputTokens: getModelMaxOutputTokens(model.id) ?? 0,
    }));
  })();

  allowedModelsRequest = { token, promise };

  try {
    const models = await promise;
    allowedModelsCache = {
      token,
      models,
      cachedAt: Date.now(),
    };
    return [...models];
  } finally {
    if (allowedModelsRequest?.promise === promise) {
      allowedModelsRequest = null;
    }
  }
}

export const cloudModelRepository: ModelRepository = {
  async listProviders(): Promise<ModelProviderOption[]> {
    return [{ label: "Managed Models", value: "managed" }];
  },

  async listModels(): Promise<ChatModel[]> {
    return await fetchAllowedModels();
  },

  async getSelection(): Promise<ModelSelection> {
    const models = await fetchAllowedModels();
    const stored = localStorage.getItem("cloud-model");
    const model = models.some((item) => item.value === stored)
      ? stored!
      : (models[0]?.value ?? DEFAULT_MODEL);
    return {
      provider: "managed",
      model,
    };
  },

  async saveSelection(selection: ModelSelection): Promise<void> {
    localStorage.setItem("cloud-model", selection.model);
  },

  allowsLocalKeys() {
    return false;
  },
};
