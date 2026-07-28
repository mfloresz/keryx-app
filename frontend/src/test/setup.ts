import { mockRoot } from './mock-opfs'

/* ---------- OPFS ---------- */
Object.defineProperty(globalThis, 'navigator', {
  value: { storage: { getDirectory: async () => mockRoot } },
  writable: true,
  configurable: true,
})

/* ---------- localStorage ---------- */
const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
  },
  writable: true,
  configurable: true,
})
