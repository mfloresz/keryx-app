export interface ModelPreset {
  preset: string;
  label: string;
  description?: string;
  supportsImages: boolean;
  supportsSearch: boolean;
}

/** A knowledge file attached to an agent on the backend. */
export interface AgentKnowledge {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
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
  /** Extra tools the agent may use, e.g. "web_search" | "update_artifact". */
  tools?: string[];
  /** Skills the agent has access to (configured by the admin). */
  skills?: string[];
  /** Suggested first messages shown on an empty conversation. */
  starterPrompts?: string[];
  /** Files the agent can consult (edit page only). */
  knowledge?: AgentKnowledge[];
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
  /** True while the document is being converted to Markdown. */
  converting?: boolean;
  /** Markdown produced by the client-side conversion, if any. */
  convertedMarkdown?: string;
}
