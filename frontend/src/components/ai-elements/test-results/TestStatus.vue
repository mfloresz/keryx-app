<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import type { TestStatusType } from './context'
import { cn } from '@/lib/utils'
import {
  CheckCircle2,
  Circle,
  CircleDot,
  XCircle,
} from 'lucide-vue-next'
import { useTestContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { status } = useTestContext()

const statusStyles: Record<TestStatusType, string> = {
  passed: 'text-success',
  failed: 'text-destructive',
  skipped: 'text-warning',
  running: 'text-primary',
}

const statusIcons: Record<TestStatusType, Component> = {
  passed: CheckCircle2,
  failed: XCircle,
  skipped: Circle,
  running: CircleDot,
}
</script>

<template>
  <span
    v-if="status"
    :class="cn('shrink-0', status ? statusStyles[status] : '', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <component
        :is="statusIcons[status]"
        :class="cn('size-4', status === 'running' && 'animate-pulse')"
      />
    </slot>
  </span>
</template>
