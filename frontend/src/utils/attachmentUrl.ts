/**
 * Resolves backend attachment URLs (/api/attachments/{id}) into browser
 * object URLs. The backend requires a Bearer token, which <img>/<video> tags
 * cannot send, so bytes are fetched once per URL and cached for the session.
 * The cache is display-only; the source of truth is always the backend.
 */
import { reactive } from 'vue'
import { getAuthAdapter } from '@/services/runtime'

const ATTACHMENT_API_PREFIX = '/api/attachments/'

const resolved = reactive(new Map<string, string>())
const pending = new Map<string, Promise<string>>()
const failed = new Set<string>()

export function isBackendAttachmentUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith(ATTACHMENT_API_PREFIX)
}

/**
 * Returns the cached object URL for a backend attachment URL, or the
 * original URL for anything else (data URLs, blob URLs, external links).
 */
export function resolvedAttachmentUrl(url: string | undefined): string | undefined {
  if (!isBackendAttachmentUrl(url)) return url
  return resolved.get(url as string)
}

/**
 * Fetches an attachment with auth headers and caches its object URL.
 * Idempotent; safe to call on every render.
 */
export function ensureAttachmentResolved(url: string | undefined): void {
  if (!isBackendAttachmentUrl(url) || !url) return
  if (resolved.has(url) || pending.has(url) || failed.has(url)) return

  pending.set(url, (async () => {
    try {
      const auth = await getAuthAdapter()
      const headers = await auth.getAuthorizationHeaders()
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`Attachment fetch failed (${res.status})`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      resolved.set(url, objectUrl)
      return objectUrl
    } catch (err) {
      failed.add(url)
      if (import.meta.env.DEV) {
        console.error('Failed to resolve attachment:', url, err)
      }
      return ''
    } finally {
      pending.delete(url)
    }
  })())
}
