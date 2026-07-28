/**
 * AI Providers and Supported Models
 *
 * Defines the available providers and their respective models.
 * Models are accessed through the Vercel AI Gateway by default,
 * or through the OpenCode GO API when selected.
 */

export const PROVIDERS = [
  { label: "Vercel AI Gateway", value: "vercel" },
  { label: "OpenCode GO", value: "opencode" },
] as const;

export type ProviderValue = (typeof PROVIDERS)[number]["value"];

export const VERCEL_MODELS = [
  {
    label: "GPT-5.4 Nano",
    value: "openai/gpt-5.4-nano",
    supportsImages: true,
    supportsSearch: true,
    maxContextTokens: 400000,
    maxOutputTokens: 128000,
  },
  {
    label: "Gemini 3.5 Flash",
    value: "google/gemini-3.5-flash",
    supportsImages: true,
    supportsSearch: false,
    maxContextTokens: 1000000,
    maxOutputTokens: 64000,
  },
  {
    label: "DeepSeek V4 Flash",
    value: "deepseek/deepseek-v4-flash",
    supportsImages: false,
    supportsSearch: false,
    maxContextTokens: 390000,
    maxOutputTokens: 128000,
  },
] as const;

export const OPENCODE_MODELS = [
  {
    label: "Mimo V2.5",
    value: "opencode/mimo-v2.5",
    supportsImages: true,
    supportsSearch: false,
    maxContextTokens: 1000000,
    maxOutputTokens: 128000,
  },
  {
    label: "Qwen 3.5 Plus",
    value: "opencode/qwen3.5-plus",
    supportsImages: true,
    supportsSearch: false,
    maxContextTokens: 262144,
    maxOutputTokens: 65536,
  },
  {
    label: "DeepSeek V4 Flash",
    value: "opencode/deepseek-v4-flash",
    supportsImages: false,
    supportsSearch: false,
    maxContextTokens: 1000000,
    maxOutputTokens: 384000,
  },
] as const;

/** Default model list (Vercel) for backward compatibility */
export const MODELS = VERCEL_MODELS;

export type ModelValue = (typeof MODELS)[number]["value"];

/**
 * Returns the model list for a given provider.
 */
export function getModels(
  provider: ProviderValue,
): readonly (
  | (typeof VERCEL_MODELS)[number]
  | (typeof OPENCODE_MODELS)[number]
)[] {
  if (provider === "opencode") return OPENCODE_MODELS;
  return VERCEL_MODELS;
}

/**
 * Checks if a model supports image attachments.
 * Searches both Vercel and OpenCode model lists.
 */
export function supportsImages(modelId: string): boolean {
  return (
    [...VERCEL_MODELS, ...OPENCODE_MODELS].find((m) => m.value === modelId)
      ?.supportsImages ?? false
  );
}

/**
 * Checks if a model supports web search.
 * Searches both Vercel and OpenCode model lists.
 */
export function supportsSearch(modelId: string): boolean {
  return (
    [...VERCEL_MODELS, ...OPENCODE_MODELS].find((m) => m.value === modelId)
      ?.supportsSearch ?? false
  );
}

export function getModelContextWindow(modelId: string): number | null {
  return (
    [...VERCEL_MODELS, ...OPENCODE_MODELS].find((m) => m.value === modelId)
      ?.maxContextTokens ?? null
  );
}

export function getModelMaxOutputTokens(modelId: string): number | null {
  return (
    [...VERCEL_MODELS, ...OPENCODE_MODELS].find((m) => m.value === modelId)
      ?.maxOutputTokens ?? null
  );
}
