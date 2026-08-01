import { defineComarkComponent } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import alert from '@comark/vue/plugins/alert'
import emoji from '@comark/vue/plugins/emoji'
import security from '@comark/vue/plugins/security'
import binding, { Binding } from '@comark/vue/plugins/binding'
import mermaid, { Mermaid } from '@comark/vue/plugins/mermaid'
import breaks from '@comark/vue/plugins/breaks'
import footnotes from '@comark/vue/plugins/footnotes'
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
 * - binding: {{ path || default }} interpolation of frontmatter/data/props
 * - mermaid: Mermaid diagrams in ```mermaid code blocks
 * - math: LaTeX formulas with KaTeX (companion Math component)
 * - breaks: soft line breaks → <br>
 * - footnotes: [^label] references and definitions
 * - headings: extracts page title/description into meta
 * - jsonRender: JSON Render specs → UI components
 * - punctuation: smart typography (straight quotes → curly, etc.)
 * - summary: `<!-- more -->` summary extraction (requires `summary` prop)
 * - toc: table of contents metadata from headings
 * - taskList: interactive task lists
 *
 * Registered components (resolved from markdown tags):
 * - alert: `::alert{type="warning" title="..."}` → GitHub-style labeled alert
 * - Binding: `{{ path || default }}` interpolation
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
    binding(),
    mermaid({
      theme: 'github-light',
      themeDark: 'github-dark',
    }),
    math(),
    breaks(),
    footnotes(),
    headings(),
    jsonRender(),
    punctuation(),
    summary(),
    toc(),
    taskList(),
  ],
  components: {
    Alert,
    Binding,
    Mermaid,
    Math: MathComponent,
  },
})
