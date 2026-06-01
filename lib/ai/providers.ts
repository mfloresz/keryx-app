import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, gateway } from "ai";
import type { AIProvider } from "@/lib/db/queries";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

let opencodeProvider: ReturnType<typeof createOpenAICompatible> | null = null;

function getOpenCodeProvider() {
  if (opencodeProvider) {
    return opencodeProvider;
  }

  const apiKey = process.env.OPENCODE_GO_API_KEY;
  const baseURL =
    process.env.OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1";

  if (!apiKey) {
    throw new Error(
      "OPENCODE_GO_API_KEY is required when OpenCode GO is active",
    );
  }

  opencodeProvider = createOpenAICompatible({
    name: "opencode-go",
    apiKey,
    baseURL,
  });

  return opencodeProvider;
}

export function getLanguageModel(modelId: string, provider: AIProvider) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  if (provider === "opencode_go") {
    return getOpenCodeProvider().languageModel(modelId);
  }

  return gateway.languageModel(modelId);
}

export function getTitleModel(provider: AIProvider) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  if (provider === "opencode_go") {
    return getOpenCodeProvider().languageModel(titleModel.id);
  }

  return gateway.languageModel(titleModel.id);
}
