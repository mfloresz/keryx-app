<script setup lang="ts">
/**
 * ChatInput
 *
 * Uses AI Elements PromptInput components for a rich chat input experience.
 * Handles text input, file attachments, web search toggle, and preset selection.
 */
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input'
import type { AttachmentFile } from '@/components/ai-elements/prompt-input/types'
import type { ChatStatus } from 'ai'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import PromptInputAttachmentsDisplay from '@/components/prompt-input-attachments-display.vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { GlobeIcon, XIcon, BotIcon, CheckIcon } from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

export interface ModelPreset {
  preset: string
  label: string
  description?: string
  supportsImages: boolean
  supportsSearch: boolean
}

export interface ChatAgent {
  id: string
  builtinId?: string
  ownerId?: string
  name: string
  description?: string
  icon?: string
  systemPrompt: string
  source: 'builtin' | 'override' | 'global_custom' | 'user_custom'
}

const PRESET_DESCRIPTION_KEYS: Record<string, { title: string; subtitle: string }> = {
  fast: { title: 'chat.presetFast', subtitle: 'chat.presetFastDesc' },
  reflect: { title: 'chat.presetReflect', subtitle: 'chat.presetReflectDesc' },
  extended_context: { title: 'chat.presetExtended', subtitle: 'chat.presetExtendedDesc' },
}

const DOCUMENT_ACCEPT = '.pdf,.txt,.md,.doc,.docx,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.go,.rs'

const props = defineProps<{
  status?: ChatStatus
  preset: string
  presets: ModelPreset[]
  webSearch?: boolean
  webSearchGloballyEnabled?: boolean
  agents?: ChatAgent[]
  agentId?: string | null
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { text: string; files: AttachmentFile[]; webSearch: boolean }): void
  (e: 'update:preset', value: string): void
  (e: 'stop'): void
  (e: 'update:agentId', value: string | null): void
}>()

const useWebSearch = ref(props.webSearch ?? false)
const unsupportedImageDialogOpen = ref(false)

watch(() => props.webSearch, (value) => {
  if (value !== undefined) {
    useWebSearch.value = value
  }
})

const selectedPresetData = computed(() =>
  props.presets.find(p => p.preset === props.preset)
)

const modelSupportsImages = computed(() =>
  selectedPresetData.value?.supportsImages ?? true
)

const activePresetTitle = computed(() => {
  const key = PRESET_DESCRIPTION_KEYS[props.preset]?.title
  return key ? t(key) : selectedPresetData.value?.label ?? props.preset
})

function presetSubtitle(presetId: string) {
  const key = PRESET_DESCRIPTION_KEYS[presetId]?.subtitle
  return key ? t(key) : ''
}

function handleAttachmentError(err: { code: string, message: string }) {
  if (err.code === 'accept' && !modelSupportsImages.value) {
    unsupportedImageDialogOpen.value = true
    return
  }
  // Other errors are silently ignored; the filepicker already filters correctly
}

function handleSubmit(message: PromptInputMessage) {
  const hasText = !!message.text
  const hasAttachments = message.files && message.files.length > 0

  if (!hasText && !hasAttachments) {
    return
  }

  emit('submit', {
    text: message.text,
    files: message.files || [],
    webSearch: useWebSearch.value,
  })
}

function handlePresetSelect(value: string) {
  emit('update:preset', value)
  // Reset web search when switching to a preset that doesn't support it
  const next = props.presets.find(p => p.preset === value)
  if (next && !next.supportsSearch) {
    useWebSearch.value = false
  }
}

function handleStop() {
  emit('stop')
}

const selectedAgent = computed(() =>
  (props.agents ?? []).find(a => a.id === props.agentId) ?? null
)

// The base prompt is the default when nothing is selected, so the catalog
// never lists a "general" agent; filter it defensively if a server sends one.
const selectableAgents = computed(() =>
  (props.agents ?? []).filter(a => a.id !== 'general' && a.builtinId !== 'general')
)

function handleAgentSelect(id: string) {
  emit('update:agentId', id === '' ? null : id)
}
</script>

<template>
  <div class="bg-background px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
    <PromptInput
      class="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/10 transition-shadow"
      multiple
      global-drop
      :max-files="3"
      :accept="modelSupportsImages ? undefined : DOCUMENT_ACCEPT"
      @submit="handleSubmit"
      @error="handleAttachmentError"
    >
      <!-- Attachments row (wrapper stays empty when no files) -->
      <div class="order-first w-full px-3 pt-3">
        <PromptInputAttachmentsDisplay />
      </div>

      <!-- Textarea: always a full-width row stacked above the toolbar.
           Stable layout — no toggling based on content height. -->
      <PromptInputTextarea
        :placeholder="$t('chat.inputPlaceholder')"
        class="resize-none"
        container-class="order-1 w-full flex-none"
      />

      <!-- Left tools -->
      <div class="order-2 my-1.5 flex items-center gap-2 ms-2">
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger />
          <PromptInputActionMenuContent>
            <PromptInputActionAddAttachments />
            <DropdownMenuSub v-if="selectableAgents.length">
              <DropdownMenuSubTrigger
                class="gap-2"
                :class="{ 'data-[highlighted]:bg-accent': !!props.agentId }"
              >
                <BotIcon :size="16" />
                <span>{{ $t('chat.agent.menuLabel') }}</span>
                <span
                  v-if="selectedAgent"
                  class="ms-auto max-w-[100px] truncate text-xs text-muted-foreground"
                >{{ selectedAgent.name }}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  side="right"
                  :side-offset="8"
                  class="max-h-64 w-64 overflow-y-auto"
                >
                  <DropdownMenuItem
                    v-for="agent in selectableAgents"
                    :key="agent.id + ':' + agent.source"
                    class="gap-2"
                    @select="handleAgentSelect(agent.id)"
                  >
                    <BotIcon :size="14" class="shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ agent.name }}</span>
                    <CheckIcon
                      v-if="props.agentId === agent.id"
                      class="ms-auto shrink-0"
                      :size="14"
                    />
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>

        <PromptInputButton
          v-if="props.webSearchGloballyEnabled"
          :variant="useWebSearch ? 'default' : 'ghost'"
          @click="useWebSearch = !useWebSearch"
        >
          <GlobeIcon :size="16" />
          <span>{{ $t('chat.search') }}</span>
        </PromptInputButton>
      </div>

      <!-- Right tools -->
      <div class="order-3 my-1.5 ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 me-2">
          <!-- Selected agent badge -->
          <div
            v-if="selectedAgent"
            class="group flex max-w-full items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs"
          >
            <BotIcon :size="12" class="shrink-0" />
            <span class="max-w-[120px] truncate">{{ selectedAgent.name }}</span>
            <button
              type="button"
              :aria-label="$t('chat.agent.clear')"
              class="opacity-0 transition-opacity group-hover:opacity-100"
              @click="emit('update:agentId', null)"
            >
              <XIcon :size="12" />
            </button>
          </div>
          <!-- Preset selector -->
          <Select
            :model-value="props.preset"
            @update:model-value="value => handlePresetSelect(String(value))"
          >
            <SelectTrigger class="h-8 min-w-0 max-w-full px-3 text-xs">
              <SelectValue :placeholder="activePresetTitle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="p in props.presets"
                :key="p.preset"
                :value="p.preset"
                class="py-2"
              >
                {{ p.label }}
                <template #description>
                  {{ presetSubtitle(p.preset) }}
                </template>
              </SelectItem>
            </SelectContent>
          </Select>

          <PromptInputSubmit
            v-if="props.status !== 'streaming'"
            :status="props.status"
          />
          <button
            v-else
            type="button"
            :aria-label="$t('chat.stop')"
            class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-8 w-8"
            @click="handleStop"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
          </button>
      </div>
    </PromptInput>

    <AlertDialog v-model:open="unsupportedImageDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ $t('chat.unsupportedImageTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ $t('chat.unsupportedImageDescription') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction @click="unsupportedImageDialogOpen = false">
            {{ $t('app.confirm') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
