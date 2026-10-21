<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { MinusIcon } from 'lucide-vue-next'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  count: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    :class="cn('text-destructive', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <MinusIcon class="inline-block size-3" />
      {{ props.count }}
    </slot>
  </span>
</template>
