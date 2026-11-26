/**
 * Publishes an HTML artifact to the backend so it can be previewed in an
 * isolated origin.
 *
 * The preview iframe runs the artifact's own scripts but cannot reach the
 * parent's DOM, cookies or storage: the document is served from a separate
 * origin without `allow-same-origin`.
 */
import { getChatTransportHeaders } from "#/services/chat-transport";

export interface PublishedArtifact {
  token: string;
  url: string;
}

export async function publishArtifact(html: string): Promise<PublishedArtifact> {
  const response = await fetch("/api/artifacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Failed to publish artifact (${response.status})`,
    );
  }

  const payload = (await response.json()) as { token: string };
  return {
    token: payload.token,
    url: `/api/artifacts/${payload.token}`,
  };
}

/** Payload of GET /api/chats/{chatId}/artifacts/{artifactId}. */
export interface ChatArtifact {
  artifactId: string;
  title: string;
  type: "html" | "markdown";
  version: number;
  content: string;
  createdAt: string;
}

/**
 * Fetches a model-produced artifact's content. Version is optional: when
 * omitted the backend returns the latest one.
 */
export async function fetchChatArtifact(
  chatId: string,
  artifactId: string,
  version?: number,
): Promise<ChatArtifact> {
  const params = typeof version === "number" ? `?version=${version}` : "";
  const response = await fetch(
    `/api/chats/${encodeURIComponent(chatId)}/artifacts/${encodeURIComponent(artifactId)}${params}`,
    { headers: await getChatTransportHeaders() },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch artifact (${response.status})`);
  }

  return (await response.json()) as ChatArtifact;
}
