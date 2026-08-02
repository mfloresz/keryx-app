<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const fileStatusStyles = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-destructive',
  renamed: 'text-primary',
}

const fileStatusLabels = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}
</script>

<template>
  <span
    :class="
      cn(
        'font-medium font-mono text-xs',
        fileStatusStyles[props.status],
        props.class,
      )
    "
    v-bind="$attrs"
  >
    <slot>{{ fileStatusLabels[props.status] }}</slot>
  </span>
</template>
