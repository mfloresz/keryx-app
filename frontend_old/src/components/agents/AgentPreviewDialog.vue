<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bot, Code, Scale, PenLine, Sparkles, GraduationCap, Leaf, BookOpen, Brain, ArrowRight } from 'lucide-vue-next'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Agent } from '@/stores/agents'
import { getAgentHeaderColor } from '@/composables/useAgentColor'
import { useAgentStore } from '@/stores/agents'
import { useToast } from '@/composables/useToast'

const props = defineProps<{
  open: boolean
  agent: Agent | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const router = useRouter()
const { t } = useI18n()
const agentStore = useAgentStore()
const { toast } = useToast()

const isOpen = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v),
})

const headerColor = computed(() => props.agent ? getAgentHeaderColor(props.agent.id, props.agent.source) : '#ef4444')

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
  const raw = (props.agent?.icon || '').toLowerCase().trim()
  if (raw && iconMap[raw]) return iconMap[raw]
  return Bot
})

const isMine = computed(() => props.agent?.source === 'user_custom')

function close() { isOpen.value = false }

function handlePersonalize() {
  if (!props.agent) return
  if (!isMine.value) {
    // For global/builtin, duplicate first then go to editor
    handleDuplicate(true)
    return
  }
  close()
  router.push(`/agents/${props.agent.id}`)
}

async function handleDuplicate(navigateAfter = false) {
  if (!props.agent) return
  try {
    const dup = await agentStore.duplicateAgent(props.agent.id)
    toast(t('agents.editor.duplicatedSuccess'), 'success')
    if (navigateAfter) {
      close()
      router.push(`/agents/${dup.id}`)
    }
  } catch (e: any) {
    toast(e?.message || t('agents.editor.savedError'))
  }
}

function handleChat() {
  if (!props.agent) return
  close()
  // Navigate to new chat with agentId
  router.push({ path: '/', query: { agentId: props.agent.id } })
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="p-0 overflow-hidden gap-0 sm:max-w-[420px] border-0 shadow-xl" :show-close-button="false">
      <!-- Hero -->
      <div
        class="relative flex h-32 w-full items-center justify-center"
        :style="{ backgroundColor: headerColor }"
      >
        <button
          class="absolute right-3 top-3 rounded-full bg-black/10 p-1.5 text-black/60 hover:bg-black/15 hover:text-black/80 transition-colors"
          aria-label="Close"
          @click="close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <component :is="iconComponent" class="h-14 w-14 text-white drop-shadow" />
      </div>

      <!-- Body -->
      <div class="bg-background px-5 pb-5 pt-4">
        <h3 class="text-sm font-semibold">{{ agent?.name }}</h3>
        <p class="mt-1 line-clamp-3 text-sm text-muted-foreground">
          {{ agent?.description || 'Prueba este agente' }}
        </p>

        <div class="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" class="w-full" @click="handlePersonalize">
            {{ isMine ? t('agents.preview.personalize') : t('agents.preview.duplicate') }}
          </Button>
          <Button class="w-full gap-1.5" @click="handleChat">
            {{ t('agents.preview.chat') }}
            <ArrowRight class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
