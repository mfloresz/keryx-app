<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { HttpMethod } from './context'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSchemaDisplayContext } from './context'

type BadgeProps = InstanceType<typeof Badge>['$props']

interface Props extends /* @vue-ignore */ BadgeProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { method } = useSchemaDisplayContext('SchemaDisplayMethod')

const methodStyles: Record<HttpMethod, string> = {
  GET: 'bg-success/10 text-success',
  POST: 'bg-primary/10 text-primary',
  PUT: 'bg-warning/10 text-warning',
  PATCH:
    'bg-warning/10 text-warning',
  DELETE: 'bg-destructive/10 text-destructive',
}
</script>

<template>
  <Badge
    :class="cn('font-mono text-xs', methodStyles[method], props.class)"
    variant="secondary"
    v-bind="$attrs"
  >
    <slot>{{ method }}</slot>
  </Badge>
</template>
