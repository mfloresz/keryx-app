<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Code, Scale, PenLine, Sparkles, GraduationCap, Leaf, BookOpen, Brain } from 'lucide-vue-next'
import type { Agent } from '@/stores/agents'
import { getAgentHeaderColor, getAgentMutedColor } from '@/composables/useAgentColor'

const { t } = useI18n()

const props = defineProps<{
  agent: Agent
}>()

const emit = defineEmits<{
  (e: 'click', agent: Agent): void
}>()

const headerColor = computed(() => {
  // Use built-in muted for some? Keep vivid for all to match screenshots, but fallback muted if icon missing?
  // We'll use vivid palette for all except empty.
  return getAgentHeaderColor(props.agent.id, props.agent.source)
})

const mutedFallback = computed(() => getAgentMutedColor(props.agent.id))

// Map icon string -> lucide component
const iconMap: Record<string, any> = {
  code: Code,
  scale: Scale,
  'pen-line': PenLine,
  sparkles: Sparkles,
  graduationcap: GraduationCap,
  leaf: Leaf,
  book: BookOpen,
  brain: Brain,
}

const iconComponent = computed(() => {
  const raw = (props.agent.icon || '').toLowerCase().trim()
  if (raw && iconMap[raw]) return iconMap[raw]
  // also try with hyphens removed?
  return Bot
})

const badgeLabel = computed(() => {
  if (props.agent.source === 'user_custom') return t('agents.byMe')
  if (props.agent.source === 'global_custom' || props.agent.source === 'override') return t('agents.byGlobal')
  return t('agents.byCatalog')
})

function onClick() {
  emit('click', props.agent)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('click', props.agent)
  }
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    :aria-label="agent.name"
    class="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    @click="onClick"
    @keydown="onKeydown"
  >
    <!-- Header color block -->
    <div
      class="relative flex h-36 w-full items-center justify-center overflow-hidden"
      :style="{ backgroundColor: headerColor }"
    >
      <!-- Fallback muted overlay pixel pattern subtle -->
      <div
        class="absolute inset-0 opacity-10"
        :style="{ backgroundColor: mutedFallback }"
        aria-hidden="true"
      />
      <!-- Pixel icon centered -->
      <div class="relative flex h-16 w-16 items-center justify-center">
        <!-- Pixel-art emulation with grid + icon -->
        <component :is="iconComponent" class="h-12 w-12 text-background drop-shadow-sm" :style="{ filter: 'contrast(1.2)' }" />
        <!-- Decorative pixel border emulation -->
        <div class="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-10 transition-opacity bg-[radial-gradient(circle_at_center,white_1px,transparent_1px)] bg-[length:8px_8px]" />
      </div>
    </div>

    <!-- Body -->
    <div class="flex flex-1 flex-col gap-1 p-4">
      <h3 class="line-clamp-1 text-sm font-semibold tracking-tight">{{ agent.name }}</h3>
      <p class="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
        {{ agent.description || 'Prueba este agente' }}
      </p>
      <div class="mt-auto pt-3">
        <span class="text-[11px] font-normal text-muted-foreground/70">
          {{ badgeLabel }}
        </span>
      </div>
    </div>
  </div>
</template>
