import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { hashCode, type HtmlArtifact } from '@/utils/htmlArtifacts'

export type ArtifactTab = 'preview' | 'code'

/**
 * Single source of UI truth for the HTML artifacts panel.
 * Items are synced (derived) from chat messages in `[id].vue`; inline
 * previews from `MarkdownPre` resolve to the matching synced item by code
 * or fall back to an ephemeral entry so the eye-button always works.
 */
export const useArtifactStore = defineStore('artifact', () => {
  const synced = ref<HtmlArtifact[]>([])
  const inlineItem = ref<HtmlArtifact | null>(null)
  const activeKey = ref<string | null>(null)
  const isOpen = ref(false)
  const tab = ref<ArtifactTab>('preview')

  const all = computed<HtmlArtifact[]>(() => {
    if (inlineItem.value && !synced.value.some(a => a.key === inlineItem.value!.key)) {
      return [...synced.value, inlineItem.value]
    }
    return synced.value
  })

  const activeIndex = computed(() => all.value.findIndex(a => a.key === activeKey.value))
  const active = computed<HtmlArtifact | null>(() => all.value[activeIndex.value] ?? null)

  function syncItems(next: HtmlArtifact[]) {
    synced.value = next
    // Drop the ephemeral entry once the same code lands in synced items.
    if (inlineItem.value && next.some(a => a.code === inlineItem.value!.code)) {
      const match = next.find(a => a.code === inlineItem.value!.code)
      if (match && activeKey.value === inlineItem.value.key) activeKey.value = match.key
      inlineItem.value = null
    }
    if (!activeKey.value || !all.value.some(a => a.key === activeKey.value)) {
      activeKey.value = all.value.length ? all.value[all.value.length - 1]!.key : null
    }
  }

  function open(key?: string) {
    if (key && all.value.some(a => a.key === key)) activeKey.value = key
    else if (!activeKey.value && all.value.length) activeKey.value = all.value[all.value.length - 1]!.key
    tab.value = 'preview'
    isOpen.value = true
  }

  function openFromCodeBlock(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    const existing = synced.value.find(a => a.code === trimmed)
    if (existing) {
      activeKey.value = existing.key
    }
    else {
      inlineItem.value = { key: `inline-${hashCode(trimmed)}`, messageId: 'inline', index: 0, code: trimmed }
      activeKey.value = inlineItem.value.key
    }
    tab.value = 'preview'
    isOpen.value = true
  }

  function select(key: string) {
    if (all.value.some(a => a.key === key)) activeKey.value = key
  }

  function step(delta: -1 | 1) {
    if (!all.value.length) return
    const next = (activeIndex.value < 0 ? all.value.length - 1 : activeIndex.value + delta + all.value.length) % all.value.length
    activeKey.value = all.value[next]!.key
  }

  function setTab(next: ArtifactTab) {
    tab.value = next
  }

  function close() {
    isOpen.value = false
  }

  function reset() {
    synced.value = []
    inlineItem.value = null
    activeKey.value = null
    isOpen.value = false
    tab.value = 'preview'
  }

  return { synced, all, active, activeKey, activeIndex, isOpen, tab, syncItems, open, openFromCodeBlock, select, step, setTab, close, reset }
})
