<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { SchemaParameter } from './context'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props extends /* @vue-ignore */ HTMLAttributes, SchemaParameter {
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()
</script>

<template>
  <div :class="cn('px-4 py-3 pl-10', props.class)" v-bind="$attrs">
    <div class="flex items-center gap-2">
      <span class="font-mono text-sm">{{ name }}</span>
      <Badge class="text-xs" variant="outline">
        {{ type }}
      </Badge>
      <Badge v-if="location" class="text-xs" variant="secondary">
        {{ location }}
      </Badge>
      <Badge
        v-if="required"
        class="bg-destructive/10 text-destructive text-xs"
        variant="secondary"
      >
        required
      </Badge>
    </div>
    <p v-if="description" class="mt-1 text-muted-foreground text-sm">
      {{ description }}
    </p>
  </div>
</template>
