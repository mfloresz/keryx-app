/**
 * Model capability helpers.
 *
 * Capabilities always come from the live model catalog served by the
 * backend (see useModels / apiModelRepository). There are no hardcoded
 * model lists here — the Go API is the source of truth.
 */
import type { ChatModel } from "@/domain/models/types";

export function findModel(
  models: ChatModel[],
  modelId: string,
): ChatModel | undefined {
  return models.find((m) => m.value === modelId);
}

export function supportsSearch(
  models: ChatModel[],
  modelId: string,
): boolean {
  return findModel(models, modelId)?.supportsSearch ?? false;
}

export function getModelContextWindow(
  models: ChatModel[],
  modelId: string,
): number | null {
  return findModel(models, modelId)?.maxContextTokens ?? null;
}
