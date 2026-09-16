import type { ConvertErrorCode, ConvertRequest, ConvertResponse } from '@/workers/anydoc.worker'

// Extensions anydoc can convert (matches the wasm Format set plus its
// container variants). Text formats that are already inlined as text (txt,
// md, csv, json) don't need conversion.
const CONVERTIBLE_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'docm',
  'odt',
  'ods',
  'odp',
  'ppt',
  'pptx',
  'pptm',
  'ppsx',
  'ppsm',
  'rtf',
  'epub',
  'xlsx',
  'xlsm',
])

export type { ConvertErrorCode }

export function isConvertible(filename: string): boolean {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
  return CONVERTIBLE_EXTENSIONS.has(ext)
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<string, { resolve: (markdown: string) => void; reject: (error: ConvertErrorCode) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/anydoc.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<ConvertResponse>) => {
    const { id } = e.data
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if ('error' in e.data) p.reject(e.data.error)
    else p.resolve(e.data.markdown)
  }
  worker.onerror = () => {
    for (const [, p] of pending) p.reject('unknown')
    pending.clear()
  }
  return worker
}

// convertToMarkdown converts a document File to Markdown off the main thread.
// The File is read here so the worker stays simple; the ArrayBuffer is
// transferred, not copied.
export function convertToMarkdown(file: File): Promise<string> {
  const id = `convert-${++seq}`
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        getWorker().postMessage({ id, buffer } satisfies ConvertRequest, [buffer])
      }),
  )
}
