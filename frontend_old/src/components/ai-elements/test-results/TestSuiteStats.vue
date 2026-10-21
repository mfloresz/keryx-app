<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  passed?: number
  failed?: number
  skipped?: number
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  passed: 0,
  failed: 0,
  skipped: 0,
})
</script>

<template>
  <div
    :class="cn('ml-auto flex items-center gap-2 text-xs', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <span
        v-if="props.passed > 0"
        class="text-success"
      >
        {{ props.passed }} passed
      </span>
      <span
        v-if="props.failed > 0"
        class="text-destructive"
      >
        {{ props.failed }} failed
      </span>
      <span
        v-if="props.skipped > 0"
        class="text-warning"
      >
        {{ props.skipped }} skipped
      </span>
    </slot>
  </div>
</template>
