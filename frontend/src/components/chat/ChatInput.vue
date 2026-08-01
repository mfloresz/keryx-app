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
import { GlobeIcon } from 'lucide-vue-next'
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
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { text: string; files: AttachmentFile[]; webSearch: boolean }): void
  (e: 'update:preset', value: string): void
  (e: 'stop'): void
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
</script>

<template>
  <div class="bg-background px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-0">
    <PromptInput
      class="max-w-3xl mx-auto"
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
