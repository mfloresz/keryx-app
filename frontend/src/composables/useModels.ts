/**
 * Models Composable
 *
 * Manages the currently selected AI provider and model using localStorage persistence.
 * Provider and model selections are persisted independently so switching providers
 * remembers the last model chosen for each.
 */
import { computed, ref } from "vue";
import type { ModelProviderOption, ChatModel } from "@/domain/models/types";
import { getModelRepository } from "@/services/runtime";

const provider = ref("vercel");
const model = ref("openai/gpt-5.4-nano");
const providers = ref<ModelProviderOption[]>([]);
const models = ref<ChatModel[]>([]);
const allowsLocalKeys = ref(true);
let initPromise: Promise<void> | null = null;

async function refreshModels(): Promise<void> {
  const repository = await getModelRepository();
  models.value = await repository.listModels(provider.value);
  if (!models.value.some((item) => item.value === model.value)) {
    model.value = models.value[0]?.value ?? model.value;
    await repository.saveSelection({
      provider: provider.value,
      model: model.value,
    });
  }
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const repository = await getModelRepository();
      providers.value = await repository.listProviders();
      const selection = await repository.getSelection();
      provider.value = selection.provider;
      model.value = selection.model;
      allowsLocalKeys.value = repository.allowsLocalKeys();
      await refreshModels();
    })();
  }

  await initPromise;
}

export function useModels() {
  void ensureInitialized();

  const selectedProvider = computed({
    get: () => provider.value,
    set: (value: string) => {
      provider.value = value;
      void (async () => {
        const repository = await getModelRepository();
        await repository.saveSelection({
          provider: provider.value,
          model: model.value,
        });
        await refreshModels();
      })();
    },
  });

  const selectedModel = computed({
    get: () => model.value,
    set: (value: string) => {
      model.value = value;
      void (async () => {
        const repository = await getModelRepository();
        await repository.saveSelection({
          provider: provider.value,
          model: model.value,
        });
      })();
    },
  });

  return {
    provider: selectedProvider,
    models,
    model: selectedModel,
    providers,
    allowsLocalKeys,
    ready: computed(() => models.value.length > 0),
  };
}
