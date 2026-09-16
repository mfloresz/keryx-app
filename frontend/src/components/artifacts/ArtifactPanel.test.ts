import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ArtifactPanel from './ArtifactPanel.vue'
import { useArtifactStore } from '@/stores/artifact'
import i18n from '@/i18n'

function mountPanel(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const Root = defineComponent({ render: () => h(ArtifactPanel) })
  const app = createApp(Root)
  app.use(createPinia())
  app.use(i18n)
  app.mount(host)
  return host
}

async function waitFor(check: () => Element | null, timeout = 5000): Promise<Element | null> {
  const start = Date.now()
  for (;;) {
    const found = check()
    if (found) return found
    if (Date.now() - start > timeout) return null
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ token: '0123456789abcdef0123456789abcdef' }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ArtifactPanel', () => {
  it('loads the preview from the published server document, opaque origin', async () => {
    const host = mountPanel()
    const store = useArtifactStore()
    store.syncItems([{ key: 'm1#0', messageId: 'm1', index: 0, code: '<button onclick="hi()">x</button>' }])
    store.open('m1#0')
    const iframe = (await waitFor(() => host.querySelector('iframe'))) as HTMLIFrameElement | null
    expect(iframe).not.toBeNull()
    // Network document (own headers), never blob:/srcdoc (inherits app CSP).
    expect(iframe!.getAttribute('src')).toBe('/api/artifacts/0123456789abcdef0123456789abcdef')
    const sandbox = iframe!.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })
})
