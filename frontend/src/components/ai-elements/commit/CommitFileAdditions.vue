<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { PlusIcon } from 'lucide-vue-next'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  count: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <span
    v-if="props.count > 0"
    :class="cn('text-success', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <PlusIcon class="inline-block size-3" />
      {{ props.count }}
    </slot>
  </span>
</template>
