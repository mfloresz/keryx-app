export interface HtmlArtifact {
  /** Stable key: `${messageId}#${index}` or `inline-${hash}` for direct code-block previews. */
  key: string;
  messageId: string;
  index: number;
  code: string;
}

/**
 * A model-produced artifact announced by the backend (SSE `artifact` event,
 * persisted as a `data-artifact` message part). Unlike HtmlArtifact it does
 * NOT carry the content locally — it is fetched lazily from the backend.
 */
export interface ModelArtifact {
  /** Stable key: the artifactId itself. */
  key: string;
  artifactId: string;
  title: string;
  type: "html" | "markdown";
  version: number;
}

const HTML_FENCE_RE = /```html[^\n]*\n([\s\S]*?)```/g;

/** djb2 hash rendered as unsigned hex — enough to key inline previews. */
export function hashCode(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is { type: string; text: string } =>
        (p as { type?: string })?.type === "text",
    )
    .map((p) => p.text ?? "")
    .join("");
}

/**
 * Collect every ```html fence across messages in order.
 * Derived state only — no persistence, so branches/streaming stay consistent.
 */
export function extractHtmlArtifacts(
  messages: Array<{ id: string; parts: unknown }>,
): HtmlArtifact[] {
  const out: HtmlArtifact[] = [];
  for (const message of messages) {
    if (!message || typeof message.id !== "string") continue;
    const text = messageText(message.parts);
    if (!text.includes("```")) continue;
    HTML_FENCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = HTML_FENCE_RE.exec(text)) !== null) {
      const code = (match[1] ?? "").trim();
      if (!code) continue;
      out.push({
        key: `${message.id}#${index}`,
        messageId: message.id,
        index,
        code,
      });
      index++;
    }
  }
  return out;
}

interface DataArtifactPart {
  type: string;
  data?: {
    artifactId?: unknown;
    title?: unknown;
    artifactType?: unknown;
    version?: unknown;
  };
}

/**
 * Collect every `data-artifact` part across messages, deduped by artifactId
 * keeping the max version (a regenerated answer can announce the same
 * artifact again with a newer version). Order follows first appearance.
 */
export function extractModelArtifacts(
  messages: Array<{ id: string; parts: unknown }>,
): ModelArtifact[] {
  const byId = new Map<string, ModelArtifact>();
  for (const message of messages) {
    if (!Array.isArray(message?.parts)) continue;
    for (const part of message.parts as DataArtifactPart[]) {
      if (part?.type !== "data-artifact") continue;
      const data = part.data ?? {};
      const artifactId =
        typeof data.artifactId === "string" ? data.artifactId : null;
      if (!artifactId) continue;
      const version =
        typeof data.version === "number" ? Math.floor(data.version) : 1;
      const existing = byId.get(artifactId);
      if (existing) {
        if (version > existing.version) existing.version = version;
        continue;
      }
      byId.set(artifactId, {
        key: artifactId,
        artifactId,
        title:
          typeof data.title === "string" && data.title
            ? data.title
            : artifactId,
        type: data.artifactType === "markdown" ? "markdown" : "html",
        version: Math.max(1, version),
      });
    }
  }
  return [...byId.values()];
}
