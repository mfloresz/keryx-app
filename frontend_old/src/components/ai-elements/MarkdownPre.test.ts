import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createApp, defineComponent, h, Suspense } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import { AppComark } from '@/components/ai-elements/comark'
import { useArtifactStore } from '@/stores/artifact'

function mountMarkdown(md: string): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const Root = defineComponent({
    render: () =>
      h(Suspense, null, { default: () => h(AppComark, { value: md }) }),
  })
  const app = createApp(Root)
  app.use(createPinia())
  app.use(i18n)
  app.mount(host)
  return host
}

async function waitFor(
  check: () => Element | null,
  timeout = 5000,
): Promise<Element | null> {
  const start = Date.now()
  for (;;) {
    const found = check()
    if (found) return found
    if (Date.now() - start > timeout) return null
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:mock-url'
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => {}
  }
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MarkdownPre', () => {
  it('renders a copy button on hover for fenced code blocks', async () => {
    const host = mountMarkdown('```js\nconst a = 1\n```\n')
    const button = await waitFor(() =>
      host.querySelector('[data-slot="code-block-copy-button"]'),
    )
    expect(button).not.toBeNull()
    // The highlighted code content is preserved
    expect(host.querySelector('pre code')?.textContent).toContain('const a = 1')
  })

  it('adds a preview button only for html fences', async () => {
    const host = mountMarkdown(
      '```html\n<p>hello artifact</p>\n```\n\n```js\nconst a = 1\n```\n',
    )
    await waitFor(() =>
      host.querySelector('[data-slot="code-block-copy-button"]'),
    )
    expect(host.querySelectorAll('[data-slot="code-block-copy-button"]').length).toBe(2)
    expect(host.querySelectorAll('[aria-label="Preview"]').length).toBe(1)
  })

  it('opens the isolated artifacts panel (no srcdoc iframe) when preview is clicked', async () => {
    const host = mountMarkdown('```html\n<p>hello artifact</p>\n```\n')
    const previewButton = (await waitFor(() =>
      host.querySelector('[aria-label="Preview"]'),
    )) as HTMLButtonElement | null
    expect(previewButton).not.toBeNull()
    previewButton!.click()
    await new Promise(resolve => setTimeout(resolve, 50))
    const store = useArtifactStore()
    expect(store.isOpen).toBe(true)
    expect(store.active?.code).toContain('<p>hello artifact</p>')
    // The inline chat must not render a srcdoc iframe (it inherits the app
    // CSP and blocks inline scripts); preview lives in ArtifactPanel via blob:.
    expect(host.querySelector('iframe[srcdoc]')).toBeNull()
  })
})
