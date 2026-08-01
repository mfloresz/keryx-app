<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { computed, useSlots } from 'vue'
import { Markdown } from 'vue-stream-markdown'
// KaTeX CSS is required for math (LaTeX) formulas to render with correct fonts/styles
import 'katex/dist/katex.min.css'
import 'vue-stream-markdown/index.css'
import { useReasoningContext } from './context'

interface Props {
  class?: HTMLAttributes['class']
  content: string
  previewLines?: number
}

const props = withDefaults(defineProps<Props>(), {
  previewLines: 5,
})
const slots = useSlots()
const { isOpen, isStreaming } = useReasoningContext()

const slotContent = computed<string | undefined>(() => {
  const nodes = slots.default?.()
  if (!Array.isArray(nodes)) {
    return undefined
  }
  let text = ''
  for (const node of nodes) {
    if (typeof node.children === 'string')
      text += node.children
  }
  return text || undefined
})

const md = computed(() => (slotContent.value ?? props.content ?? '') as string)

const normalizedLines = computed(() =>
  md.value
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.length > 0),
)

const previewLinesToRender = computed(() => {
  const recentLines = normalizedLines.value.slice(-props.previewLines)
  const missingCount = Math.max(props.previewLines - recentLines.length, 0)
  return [
    ...Array.from({ length: missingCount }, () => ''),
    ...recentLines,
  ]
})

const shouldShowPreview = computed(() =>
  isStreaming.value && !isOpen.value && normalizedLines.value.length > 0,
)

</script>

<template>
  <div
    v-if="shouldShowPreview"
    :class="cn(
      'mt-3 border-l-2 border-reasoning-border pl-4 text-sm text-reasoning-foreground/80',
      props.class,
    )"
  >
    <div class="grid h-32 grid-rows-5 gap-1 overflow-hidden rounded-md bg-muted/25 px-3 py-2">
      <div
        v-for="(line, index) in previewLinesToRender"
        :key="index"
        class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-sans leading-5 text-reasoning-foreground/85"
      >
        {{ line || ' ' }}
      </div>
    </div>
  </div>

  <CollapsibleContent
    :class="cn(
      'mt-4 border-l-2 border-reasoning-border pl-4 text-sm',
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2',
      'data-[state=open]:slide-in-from-top-2 text-reasoning-foreground',
      'outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      props.class,
    )"
  >
    <Markdown v-if="isOpen" :content="md" />
  </CollapsibleContent>
</template>
