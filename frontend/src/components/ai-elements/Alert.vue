<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

type AlertType = 'note' | 'tip' | 'info' | 'important' | 'warning' | 'caution'

interface Props {
  type?: AlertType
  title?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'note',
})

const defaultTitles: Record<AlertType, string> = {
  note: 'Note',
  tip: 'Tip',
  info: 'Note',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

const titleText = computed(() => props.title?.trim() || defaultTitles[props.type])
</script>

<template>
  <blockquote :as="props.type" :class="cn('markdown-alert', props.class)">
    <p class="markdown-alert-title">{{ titleText }}</p>
    <slot />
  </blockquote>
</template>
