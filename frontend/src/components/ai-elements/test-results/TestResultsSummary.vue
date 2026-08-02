<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CheckCircle2, Circle, XCircle } from 'lucide-vue-next'
import { useTestResultsContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { summary } = useTestResultsContext()
</script>

<template>
  <div
    v-if="summary"
    :class="cn('flex items-center gap-3', props.class)"
    v-bind="$attrs"
  >
    <slot>
      <Badge
        class="gap-1 bg-success/10 text-success"
        variant="secondary"
      >
        <CheckCircle2 class="size-3" />
        {{ summary.passed }} passed
      </Badge>
      <Badge
        v-if="summary.failed > 0"
        class="gap-1 bg-destructive/10 text-destructive"
        variant="secondary"
      >
        <XCircle class="size-3" />
        {{ summary.failed }} failed
      </Badge>
      <Badge
        v-if="summary.skipped > 0"
        class="gap-1 bg-warning/10 text-warning"
        variant="secondary"
      >
        <Circle class="size-3" />
        {{ summary.skipped }} skipped
      </Badge>
    </slot>
  </div>
</template>
