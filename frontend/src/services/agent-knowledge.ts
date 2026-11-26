/**
 * Agent knowledge file upload/delete.
 *
 * Mirrors the chat attachment upload in
 * adapters/api/api-attachment-repository.ts (same multipart shape: the files
 * go in the "files" field), pointed at the agent instead of the chat.
 */
import type { AgentKnowledge } from "#/components/chat/types";
import { getAuthAdapter } from "#/services/runtime";

async function uploadFiles(
  agentId: string,
  files: File[],
): Promise<AgentKnowledge[]> {
  const auth = await getAuthAdapter();
  const headers = await auth.getAuthorizationHeaders();

  const form = new FormData();
  files.forEach((file) => {
    form.append("files", file, file.name);
  });

  const response = await fetch(
    `/api/agents/${encodeURIComponent(agentId)}/knowledge`,
    {
      method: "POST",
      headers, // no content-type: the browser sets the multipart boundary
      body: form,
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Failed to upload knowledge file (${response.status})`,
    );
  }

  const body = (await response.json()) as
    | { attachments?: AgentKnowledge[] }
    | AgentKnowledge[];
  return Array.isArray(body) ? body : (body.attachments ?? []);
}

export async function uploadAgentKnowledge(
  agentId: string,
  files: File[],
): Promise<AgentKnowledge[]> {
  if (!files.length) return [];
  return uploadFiles(agentId, files);
}

export async function deleteAgentKnowledge(
  agentId: string,
  attachmentId: string,
): Promise<void> {
  const auth = await getAuthAdapter();
  const response = await fetch(
    `/api/agents/${encodeURIComponent(agentId)}/knowledge/${encodeURIComponent(attachmentId)}`,
    {
      method: "DELETE",
      headers: await auth.getAuthorizationHeaders(),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Failed to delete knowledge file (${response.status})`,
    );
  }
}
