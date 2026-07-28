import type { ModelRepository } from "@/domain/models/ports";
import type {
  ChatModel,
  ModelProviderOption,
  ModelSelection,
} from "@/domain/models/types";
import {
  getModels,
  PROVIDERS,
  type ProviderValue,
} from "@/shared/utils/models";

const DEFAULT_PROVIDER: ProviderValue = "vercel";
const DEFAULT_MODELS: Record<ProviderValue, string> = {
  vercel: "openai/gpt-5.4-nano",
  opencode: "opencode/mimo-v2.5",
};

export const staticModelRepository: ModelRepository = {
  async listProviders(): Promise<ModelProviderOption[]> {
    return [...PROVIDERS];
  },

  async listModels(provider: string): Promise<ChatModel[]> {
    return [...getModels(provider as ProviderValue)];
  },

  async getSelection(): Promise<ModelSelection> {
    const provider = (localStorage.getItem("ai-provider") as ProviderValue | null) ?? DEFAULT_PROVIDER;
    const key = provider === "opencode" ? "opencode-model" : "vercel-model";
    const model = localStorage.getItem(key) ?? DEFAULT_MODELS[provider];
    return { provider, model };
  },

  async saveSelection(selection: ModelSelection): Promise<void> {
    const provider = (selection.provider as ProviderValue) || DEFAULT_PROVIDER;
    localStorage.setItem("ai-provider", provider);
    localStorage.setItem(
      provider === "opencode" ? "opencode-model" : "vercel-model",
      selection.model || DEFAULT_MODELS[provider],
    );
  },

  allowsLocalKeys() {
    return true;
  },
};
