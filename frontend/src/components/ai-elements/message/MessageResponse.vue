<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed, useSlots } from 'vue'
import { AppComark, normalizeMathDelimiters } from '@/components/ai-elements/comark'

interface Props {
  content?: string
  streaming?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  streaming: false,
})

const slots = useSlots()
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

const md = computed(() => normalizeMathDelimiters((slotContent.value ?? props.content ?? '') as string))
</script>

<template>
  <Suspense>
    <template #default>
      <AppComark
        :markdown="md"
        :streaming="props.streaming"
        :class="
          cn(
            'markdown-content size-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
            props.class,
          )
        "
        v-bind="$attrs"
      />
    </template>
    <template #fallback>
      <div
        :class="
          cn(
            'markdown-content size-full whitespace-pre-wrap [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
            props.class,
          )
        "
      >
        {{ md }}
      </div>
    </template>
  </Suspense>
</template>
