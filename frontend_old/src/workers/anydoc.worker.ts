import init, { toMarkdownBytes } from '@firecrawl/anydoc-wasm'

export interface ConvertRequest {
  id: string
  buffer: ArrayBuffer
}

export type ConvertErrorCode =
  | 'unsupported'
  | 'needsOcr'
  | 'malformed'
  | 'encrypted'
  | 'resourceLimit'
  | 'missingPart'
  | 'unknown'

export type ConvertResponse =
  | { id: string; markdown: string }
  | { id: string; error: ConvertErrorCode }

const ctx = self as unknown as {
  postMessage: (message: ConvertResponse) => void
  onmessage: ((e: MessageEvent<ConvertRequest>) => void) | null
}

let ready: Promise<unknown> | null = null

ctx.onmessage = async (e: MessageEvent<ConvertRequest>) => {
  const { id, buffer } = e.data
  try {
    // The wasm module is fetched and instantiated once per worker; the
    // browser cache keeps it across sessions.
    ready ??= init()
    await ready
    const markdown = toMarkdownBytes(new Uint8Array(buffer))
    ctx.postMessage({ id, markdown } satisfies ConvertResponse)
  } catch (err) {
    const code = (err as { code?: ConvertErrorCode }).code ?? 'unknown'
    ctx.postMessage({ id, error: code } satisfies ConvertResponse)
  }
}
