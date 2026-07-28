<script setup lang="ts">
/**
 * ChatInput
 *
 * Uses AI Elements PromptInput components for a rich chat input experience.
 * Handles text input, file attachments, web search toggle, and model selection.
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
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorList,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorEmpty,
} from '@/components/ai-elements/model-selector'
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
import { useModels } from '@/composables/useModels'
import { useSearchSettings } from '@/composables/useSearchSettings'
import { GlobeIcon } from 'lucide-vue-next'
import { ref, computed, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

const DOCUMENT_ACCEPT = '.pdf,.txt,.md,.doc,.docx,.csv,.json,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.go,.rs'

const props = defineProps<{
  status?: ChatStatus
  model: string
  webSearch?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { text: string; files: AttachmentFile[]; webSearch: boolean }): void
  (e: 'update:model', value: string): void
  (e: 'stop'): void
}>()

const selectorOpen = ref(false)
const useWebSearch = ref(props.webSearch ?? false)
const unsupportedImageDialogOpen = ref(false)

watch(() => props.webSearch, (value) => {
  if (value !== undefined) {
    useWebSearch.value = value
  }
})

const { models } = useModels()

const selectedModelLabel = computed(() => {
  // Find the model in the provider's list to get the label, or fallback to the short name
  const found = models.value.find(m => m.value === props.model)
  return found?.label || props.model.split('/').pop() || props.model
})

const searchSettings = useSearchSettings()
const modelSupportsSearch = computed(() => {
  const found = models.value.find(m => m.value === props.model)
  if (found) {
    return searchSettings.engine.value === 'tavily'
      ? searchSettings.isSearchAvailable.value(props.model)
      : found.supportsSearch
  }
  return searchSettings.isSearchAvailable.value(props.model)
})
const modelSupportsImages = computed(() => {
  const found = models.value.find(m => m.value === props.model)
  return found?.supportsImages ?? true
})

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

function handleModelSelect(value: string) {
  emit('update:model', value)
  selectorOpen.value = false
  // Reset web search when switching models to avoid unsupported state
  if (!searchSettings.isSearchAvailable.value(value)) {
    useWebSearch.value = false
  }
}

function getProvider(value: string): string {
  return value.split('/')[0] ?? 'unknown'
}

function handleStop() {
  emit('stop')
}
</script>

<template>
  <div class="bg-background px-4 pb-4 pt-0">
    <PromptInput
      class="max-w-3xl mx-auto"
      multiple
      global-drop
      :max-files="3"
      :accept="modelSupportsImages ? undefined : DOCUMENT_ACCEPT"
      @submit="handleSubmit"
      @error="handleAttachmentError"
    >
      <PromptInputHeader class="pb-1">
        <PromptInputAttachmentsDisplay />
      </PromptInputHeader>

      <PromptInputBody>
        <PromptInputTextarea
          :placeholder="$t('chat.inputPlaceholder')"
          class="min-h-[80px] resize-none !pt-1"
        />
      </PromptInputBody>

      <PromptInputFooter class="flex items-center justify-between pt-2">
        <PromptInputTools class="flex items-center gap-2">
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>

          <PromptInputButton
            v-if="modelSupportsSearch"
            :variant="useWebSearch ? 'default' : 'ghost'"
            @click="useWebSearch = !useWebSearch"
          >
            <GlobeIcon :size="16" />
            <span>{{ $t('chat.search') }}</span>
          </PromptInputButton>

        </PromptInputTools>

        <div class="flex items-center gap-2">
          <ModelSelector v-model:open="selectorOpen">
            <ModelSelectorTrigger as-child>
              <button
                class="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {{ selectedModelLabel }}
                <ChevronDown class="size-3 opacity-50" />
              </button>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput :placeholder="$t('chat.searchModels')" />
              <ModelSelectorList>
                <ModelSelectorEmpty>{{ $t('chat.noModels') }}</ModelSelectorEmpty>
                <ModelSelectorGroup :heading="$t('chat.models')">
                  <ModelSelectorItem
                    v-for="m in models"
                    :key="m.value"
                    :value="m.value"
                    @select="handleModelSelect(m.value)"
                  >
                    <ModelSelectorLogo :provider="getProvider(m.value)" />
                    <ModelSelectorName>{{ m.label }}</ModelSelectorName>
                  </ModelSelectorItem>
                </ModelSelectorGroup>
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>

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
      </PromptInputFooter>
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
