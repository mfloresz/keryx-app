<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import { useSchemaDisplayContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { path } = useSchemaDisplayContext('SchemaDisplayPath')

// Highlight path parameters safely (no v-html)
const pathParts = computed(() => {
  const parts: { text: string; isParam: boolean }[] = []
  const regex = /\{([^}]+)\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(path)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: path.slice(lastIndex, match.index), isParam: false })
    }
    parts.push({ text: `{${match[1]}}`, isParam: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < path.length) {
    parts.push({ text: path.slice(lastIndex), isParam: false })
  }
  return parts
})
</script>

<template>
  <span
    :class="cn('font-mono text-sm', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <template v-for="(part, i) in pathParts" :key="i">
        <span v-if="part.isParam" class="text-primary">{{ part.text }}</span>
        <span v-else>{{ part.text }}</span>
      </template>
    </slot>
  </span>
</template>
