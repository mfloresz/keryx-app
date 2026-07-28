<script setup lang="ts">
import type { HTMLAttributes, Component } from 'vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { computed } from 'vue'

interface Props {
  src?: string
  name?: string
  fallbackIcon?: Component
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const fallbackText = computed(() => props.name?.slice(0, 2) ?? 'ME')
</script>

<template>
  <Avatar class="size-8 ring-1 ring-border" :class="[props.class]" v-bind="$attrs">
    <AvatarImage v-if="props.src" alt="" class="mt-0 mb-0" :src="props.src" />
    <AvatarFallback>
      <component :is="props.fallbackIcon" v-if="props.fallbackIcon" class="size-4" />
      <template v-else>{{ fallbackText }}</template>
    </AvatarFallback>
  </Avatar>
</template>
