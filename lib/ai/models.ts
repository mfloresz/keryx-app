import type { AIProvider } from "@/lib/db/queries";

export const DEFAULT_CHAT_MODEL = "moonshotai/kimi-k2.5";

export const titleModel = {
  id: DEFAULT_CHAT_MODEL,
  name: "Kimi K2.5",
  provider: "moonshotai",
  description: "Fast model for title generation",
  gatewayOrder: ["fireworks", "bedrock"],
  runtimeProvider: "vercel_gateway" as const,
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  runtimeProvider: AIProvider;
};

export const vercelGatewayModels: ChatModel[] = [
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "deepseek",
    description: "Fast and capable model with tool use",
    gatewayOrder: ["bedrock", "deepinfra"],
    runtimeProvider: "vercel_gateway",
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshotai",
    description: "Moonshot AI flagship model",
    gatewayOrder: ["fireworks", "bedrock"],
    runtimeProvider: "vercel_gateway",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "openai",
    description: "Compact reasoning model",
    gatewayOrder: ["groq", "bedrock"],
    reasoningEffort: "low",
    runtimeProvider: "vercel_gateway",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    provider: "openai",
    description: "Open-source 120B parameter model",
    gatewayOrder: ["fireworks", "bedrock"],
    reasoningEffort: "low",
    runtimeProvider: "vercel_gateway",
  },
  {
    id: "xai/grok-4.1-fast-non-reasoning",
    name: "Grok 4.1 Fast",
    provider: "xai",
    description: "Fast non-reasoning model with tool use",
    gatewayOrder: ["xai"],
    runtimeProvider: "vercel_gateway",
  },
];

const opencodeFallbackModels: ChatModel[] = [
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshotai",
    description: "Moonshot AI flagship model via OpenCode GO",
    runtimeProvider: "opencode_go",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "openai",
    description: "Compact reasoning model via OpenCode GO",
    reasoningEffort: "low",
    runtimeProvider: "opencode_go",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    provider: "openai",
    description: "Open-source 120B parameter model via OpenCode GO",
    reasoningEffort: "low",
    runtimeProvider: "opencode_go",
  },
];

const opencodeFallbackCapabilities: Record<string, ModelCapabilities> = {
  "moonshotai/kimi-k2.5": { tools: true, vision: false, reasoning: false },
  "openai/gpt-oss-20b": { tools: true, vision: false, reasoning: true },
  "openai/gpt-oss-120b": { tools: true, vision: false, reasoning: true },
};

export const chatModels = vercelGatewayModels;

export async function getCapabilitiesForGatewayModels(
  models: ChatModel[],
): Promise<Record<string, ModelCapabilities>> {
  const results = await Promise.all(
    models.map(async (model) => {
      try {
        const res = await fetch(
          `https://ai-gateway.vercel.sh/v1/models/${model.id}/endpoints`,
          { next: { revalidate: 86_400 } },
        );
        if (!res.ok) {
          return [model.id, { tools: false, vision: false, reasoning: false }];
        }

        const json = await res.json();
        const endpoints = json.data?.endpoints ?? [];
        const params = new Set(
          endpoints.flatMap(
            (e: { supported_parameters?: string[] }) =>
              e.supported_parameters ?? [],
          ),
        );
        const inputModalities = new Set(
          json.data?.architecture?.input_modalities ?? [],
        );

        return [
          model.id,
          {
            tools: params.has("tools"),
            vision: inputModalities.has("image"),
            reasoning: params.has("reasoning"),
          },
        ];
      } catch {
        return [model.id, { tools: false, vision: false, reasoning: false }];
      }
    }),
  );

  return Object.fromEntries(results);
}

export async function getCapabilities(
  provider: AIProvider,
  models: ChatModel[],
): Promise<Record<string, ModelCapabilities>> {
  if (provider === "vercel_gateway") {
    return getCapabilitiesForGatewayModels(models);
  }

  return Object.fromEntries(
    models.map((model) => [
      model.id,
      opencodeFallbackCapabilities[model.id] ?? {
        tools: true,
        vision: false,
        reasoning: false,
      },
    ]),
  );
}

export const isDemo = process.env.IS_DEMO === "1";

type DynamicModel = {
  id: string;
  name?: string;
  type?: string;
  tags?: string[];
};

export type GatewayModelWithCapabilities = ChatModel & {
  capabilities: ModelCapabilities;
};

export async function getAllGatewayModels(): Promise<
  GatewayModelWithCapabilities[]
> {
  try {
    const res = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    return (json.data ?? [])
      .filter((m: DynamicModel) => m.type === "language")
      .map((m: DynamicModel) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: m.id.split("/")[0],
        description: "",
        runtimeProvider: "vercel_gateway" as const,
        capabilities: {
          tools: m.tags?.includes("tool-use") ?? false,
          vision: m.tags?.includes("vision") ?? false,
          reasoning: m.tags?.includes("reasoning") ?? false,
        },
      }));
  } catch {
    return [];
  }
}

export async function getOpenCodeModels(): Promise<ChatModel[]> {
  const apiKey = process.env.OPENCODE_GO_API_KEY;
  const baseURL =
    process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1";

  if (!apiKey) {
    return opencodeFallbackModels;
  }

  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      next: { revalidate: 3_600 },
    });

    if (!res.ok) {
      return opencodeFallbackModels;
    }

    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];

    const models = data
      .filter((model: DynamicModel) => model.type === "language")
      .map(
        (model: DynamicModel): ChatModel => ({
          id: model.id,
          name: model.name ?? model.id,
          provider: model.id.split("/")[0] ?? "opencode",
          description: "Served via OpenCode GO",
          runtimeProvider: "opencode_go",
        }),
      );

    return models.length > 0 ? models : opencodeFallbackModels;
  } catch {
    return opencodeFallbackModels;
  }
}

export async function getModelsForProvider(provider: AIProvider) {
  return provider === "vercel_gateway"
    ? vercelGatewayModels
    : getOpenCodeModels();
}

export async function getDefaultModelForProvider(provider: AIProvider) {
  const models = await getModelsForProvider(provider);
  return (
    models.find((model) => model.id === DEFAULT_CHAT_MODEL)?.id ??
    models[0]?.id ??
    DEFAULT_CHAT_MODEL
  );
}

export async function getModelById(modelId: string, provider: AIProvider) {
  const models = await getModelsForProvider(provider);
  return models.find((model) => model.id === modelId) ?? null;
}
