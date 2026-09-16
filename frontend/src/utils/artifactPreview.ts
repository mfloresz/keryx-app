import { getAuthAdapter } from '@/services/runtime'

export function artifactPreviewUrl(token: string): string {
  return `/api/artifacts/${token}`
}

/**
 * Publishes artifact HTML to the backend and returns the preview document
 * URL. The backend serves it as a real network document with
 * framing-friendly headers, so unlike blob:/srcdoc it does NOT inherit the
 * app's strict CSP and the artifact's own inline scripts can run.
 */
export async function publishArtifactPreview(html: string): Promise<string> {
  const headers = await (await getAuthAdapter()).getAuthorizationHeaders()
  const res = await fetch('/api/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ html }),
  })
  if (!res.ok) throw new Error(`publish failed with status ${res.status}`)
  const data = (await res.json()) as { token?: string }
  if (!data?.token) throw new Error('publish failed: empty token')
  return artifactPreviewUrl(data.token)
}
