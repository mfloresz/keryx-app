export interface ModelPreset {
  preset: string;
  label: string;
  description?: string;
  supportsImages: boolean;
  supportsSearch: boolean;
}

export interface ChatAgent {
  id: string;
  builtinId?: string;
  ownerId?: string;
  name: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  source: "builtin" | "override" | "global_custom" | "user_custom";
}

export interface ChatProject {
  id: string;
  name: string;
  description?: string;
}

export interface PendingAttachment {
  id: string;
  file: File;
  filename: string;
  mediaType: string;
}
