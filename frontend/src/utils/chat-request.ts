/**
 * Builds the body sent with every chat stream request (submit, edit,
 * regenerate). Pure so the contract with the backend is testable.
 */

export interface ChatRequestBodyParams {
  preset: string;
  webSearch: boolean;
  language: string;
  /** Dynamic user context the backend injects into its system prompt. */
  username: string;
  agentId?: string | null;
  projectId?: string | null;
  /** Skills the user manually pinned for this message only. */
  pinnedSkills?: string[];
  /** Injectable for tests; defaults to now. */
  now?: () => Date;
  timezone?: string;
}

export function buildChatRequestBody(params: ChatRequestBodyParams): {
  preset: string;
  webSearch: boolean;
  language: string;
  username: string;
  datetime: string;
  timezone: string;
  agentId?: string;
  projectId?: string;
  pinnedSkills?: string[];
} {
  const body = {
    preset: params.preset,
    webSearch: params.webSearch,
    language: params.language,
    username: params.username,
    datetime: (params.now ?? (() => new Date()))().toISOString(),
    timezone:
      params.timezone ??
      (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    // Omitted when empty: only present messages carry pinned skills.
    ...(params.pinnedSkills?.length ? { pinnedSkills: params.pinnedSkills } : {}),
  };
  return body;
}
