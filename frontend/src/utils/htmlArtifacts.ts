export interface HtmlArtifact {
  /** Stable key: `${messageId}#${index}` or `inline-${hash}` for direct code-block previews. */
  key: string
  messageId: string
  index: number
  code: string
}

const HTML_FENCE_RE = /```html[^\n]*\n([\s\S]*?)```/g

/** djb2 hash rendered as unsigned hex — enough to key inline previews. */
export function hashCode(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}

function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((p): p is { type: string, text: string } => (p as { type?: string })?.type === 'text')
    .map(p => (p as { text: string }).text ?? '')
    .join('')
}

/**
 * Collect every ```html fence across messages in order.
 * Derived state only — no persistence, so branches/streaming stay consistent.
 */
export function extractHtmlArtifacts(messages: Array<{ id: string, parts: unknown }>): HtmlArtifact[] {
  const out: HtmlArtifact[] = []
  for (const message of messages) {
    if (!message || typeof message.id !== 'string') continue
    const text = messageText(message.parts)
    if (!text.includes('```')) continue
    HTML_FENCE_RE.lastIndex = 0
    let match: RegExpExecArray | null
    let index = 0
    while ((match = HTML_FENCE_RE.exec(text)) !== null) {
      const code = (match[1] ?? '').trim()
      if (!code) continue
      out.push({ key: `${message.id}#${index}`, messageId: message.id, index, code })
      index++
    }
  }
  return out
}
