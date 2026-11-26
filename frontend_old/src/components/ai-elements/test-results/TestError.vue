<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div
    :class="cn('mt-2 rounded-md bg-destructive/10 p-3', props.class)"
    v-bind="$attrs"
  >
    <slot />
  </div>
</template>
