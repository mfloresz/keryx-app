<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import type { ChangeType } from './context'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ArrowRightIcon, MinusIcon, PlusIcon } from 'lucide-vue-next'
import { usePackageInfoContext } from './context'

type BadgeProps = InstanceType<typeof Badge>['$props']

interface Props extends /* @vue-ignore */ BadgeProps {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const { changeType } = usePackageInfoContext()

const changeTypeStyles: Record<ChangeType, string> = {
  major: 'bg-destructive/10 text-destructive',
  minor:
    'bg-warning/10 text-warning',
  patch: 'bg-success/10 text-success',
  added: 'bg-primary/10 text-primary',
  removed: 'bg-muted text-muted-foreground',
}

const changeTypeIcons: Record<ChangeType, Component> = {
  major: ArrowRightIcon,
  minor: ArrowRightIcon,
  patch: ArrowRightIcon,
  added: PlusIcon,
  removed: MinusIcon,
}
</script>

<template>
  <Badge
    v-if="changeType"
    :class="cn(
      'gap-1 text-xs capitalize',
      changeTypeStyles[changeType],
      props.class,
    )"
    variant="secondary"
    v-bind="$attrs"
  >
    <component :is="changeTypeIcons[changeType]" class="size-3" />
    <slot>{{ changeType }}</slot>
  </Badge>
</template>
