import { defineComarkComponent } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import alert from '@comark/vue/plugins/alert'
import emoji from '@comark/vue/plugins/emoji'
import security from '@comark/vue/plugins/security'

import mermaid, { Mermaid } from '@comark/vue/plugins/mermaid'
import breaks from '@comark/vue/plugins/breaks'

import headings from '@comark/vue/plugins/headings'
import jsonRender from '@comark/vue/plugins/json-render'
import math, { Math as MathComponent } from '@comark/vue/plugins/math'
import punctuation from '@comark/vue/plugins/punctuation'
import summary from '@comark/vue/plugins/summary'
import toc from '@comark/vue/plugins/toc'
import taskList from '@comark/vue/plugins/task-list'
import type { ThemeRegistration } from 'shiki'
import githubLight from 'shiki/dist/themes/github-light.mjs'
import githubDark from 'shiki/dist/themes/github-dark.mjs'
import Alert from '@/components/ai-elements/Alert.vue'

/**
 * Comark's math plugin uses dollar delimiters, while models commonly emit
 * LaTeX's \\(inline\\) and \\[display\\] delimiters. Normalize the latter
 * outside fenced code blocks so both conventions render through KaTeX.
 */
export function normalizeMathDelimiters(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let inFence = false
  let fenceCharacter = ''

  for (const line of lines) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    const marker = fence?.[1]
    if (marker) {
      const markerCharacter = marker.charAt(0)
      if (!inFence) {
        inFence = true
        fenceCharacter = markerCharacter
      }
      else if (markerCharacter === fenceCharacter) {
        inFence = false
        fenceCharacter = ''
      }
      output.push(line)
      continue
    }

    output.push(inFence ? line : line.replace(/\\\((.*?)\\\)/g, '$$$1$$'))
  }

  return output
    .join('\n')
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, content: string) => `$$\n${content.trim()}\n$$`)
}

const themes: { light: ThemeRegistration; dark: ThemeRegistration } = {
  light: githubLight as ThemeRegistration,
  dark: githubDark as ThemeRegistration,
}

/**
 * App-wide Comark component configured with the plugins used across the
 * application (AI chat responses, reasoning output).
 *
 * - highlight: Shiki syntax highlighting with the same themes as CodeBlock
 * - alert: GitHub-style alert blockquotes (> [!NOTE] etc.)
 * - emoji: emoji shortcodes (:smile: → 😄)
 * - security: sanitize dangerous HTML elements/attributes

 * - mermaid: Mermaid diagrams in ```mermaid code blocks
 * - math: LaTeX formulas with KaTeX (companion Math component)
 * - breaks: soft line breaks → <br>

 * - headings: extracts page title/description into meta
 * - jsonRender: JSON Render specs → UI components
 * - punctuation: smart typography (straight quotes → curly, etc.)
 * - summary: `<!-- more -->` summary extraction (requires `summary` prop)
 * - toc: table of contents metadata from headings
 * - taskList: interactive task lists
 *
 * Registered components (resolved from markdown tags):
 * - alert: `::alert{type="warning" title="..."}` → GitHub-style labeled alert

 * - Mermaid: ```mermaid blocks
 * - Math: `$...$` / `$$...$$` formulas
 *
 * `autoClose` (streaming) and `linkify` are enabled by default in Comark.
 */
export const AppComark = defineComarkComponent({
  name: 'AppComark',
  plugins: [
    highlight({
      themes,
    }),
    alert(),
    emoji(),
    security(),

    mermaid({
      theme: 'github-light',
      themeDark: 'github-dark',
    }),
    math(),
    breaks(),

    headings(),
    jsonRender(),
    punctuation(),
    summary(),
    toc(),
    taskList(),
  ],
  components: {
    Alert,

    Mermaid,
    Math: MathComponent,
  },
})
