import { getAllowedModelsForUser, listModels } from "./appStore.js";

export interface AllowedModel {
  id: string;
  provider: string;
  displayName: string;
  supportsImages: boolean;
  supportsSearch: boolean;
}

export async function getAllowedModels(_userId?: string): Promise<AllowedModel[]> {
  if (!_userId) {
    return [];
  }

  const models = await getAllowedModelsForUser(_userId);
  return models.map((model) => ({
    id: model.id,
    provider: model.provider,
    displayName: model.displayName,
    supportsImages: model.supportsImages,
    supportsSearch: model.supportsSearch,
  }));
}

export async function assertModelAllowed(
  userId: string | undefined,
  modelId: string,
): Promise<void> {
  if (!userId) {
    throw new Error("Unauthorized");
  }
  const allowedModels = await getAllowedModels(userId);
  if (!allowedModels.some((model) => model.id === modelId)) {
    throw new Error("Model not allowed");
  }
}

export async function getAllManagedModels(): Promise<AllowedModel[]> {
  const models = await listModels();
  return models.map((model) => ({
    id: model.id,
    provider: model.provider,
    displayName: model.displayName,
    supportsImages: model.supportsImages,
    supportsSearch: model.supportsSearch,
  }));
}
