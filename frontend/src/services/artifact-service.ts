/**
 * Publishes an HTML artifact to the backend so it can be previewed in an
 * isolated origin.
 *
 * The preview iframe runs the artifact's own scripts but cannot reach the
 * parent's DOM, cookies or storage: the document is served from a separate
 * origin without `allow-same-origin`.
 */
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
