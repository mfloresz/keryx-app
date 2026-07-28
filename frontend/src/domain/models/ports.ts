import type {
  ChatModel,
  ModelProviderOption,
  ModelSelection,
} from "./types";

export interface ModelRepository {
  listProviders(): Promise<ModelProviderOption[]>;
  listModels(provider: string): Promise<ChatModel[]>;
  getSelection(): Promise<ModelSelection>;
  saveSelection(selection: ModelSelection): Promise<void>;
  allowsLocalKeys(): boolean;
}
