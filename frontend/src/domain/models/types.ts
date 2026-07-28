export interface ChatModel {
  label: string;
  value: string;
  supportsImages: boolean;
  supportsSearch: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

export interface ModelProviderOption {
  label: string;
  value: string;
}

export interface ModelSelection {
  provider: string;
  model: string;
}
