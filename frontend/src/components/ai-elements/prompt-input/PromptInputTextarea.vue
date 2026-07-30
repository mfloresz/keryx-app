<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { InputGroupTextarea } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '@/lib/utils'
import { computed, ref, useAttrs } from 'vue'
import { usePromptInput } from './context'

type PromptInputTextareaProps = InstanceType<typeof InputGroupTextarea>['$props']

interface Props extends /* @vue-ignore */ PromptInputTextareaProps {
  class?: HTMLAttributes['class']
  containerClass?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const attrs = useAttrs()
const textareaProps = reactiveOmit(props, 'class', 'containerClass')

// Read placeholder from parent fallthrough attrs (e.g., i18n from ChatInput),
// fall back to a sensible default.
const placeholderText = computed(() =>
  (attrs.placeholder as string) || 'What would you like to know?',
)

const { textInput, setTextInput, addFiles, files, removeFile } = usePromptInput()
const isComposing = ref(false)

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (isComposing.value || e.isComposing || e.shiftKey)
      return

    e.preventDefault()

    const textarea = e.currentTarget as HTMLTextAreaElement | null
    const submitButton = textarea?.form?.querySelector('button[type="submit"]') as HTMLButtonElement | null

    if (submitButton?.disabled)
      return

    textarea?.form?.requestSubmit()
  }

  // Remove last attachment on backspace if input is empty
  if (e.key === 'Backspace' && textInput.value === '' && files.value.length > 0) {
    e.preventDefault()

    const lastFile = files.value[files.value.length - 1]
    if (lastFile) {
      removeFile(lastFile.id)
    }
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items)
    return

  const pastedFiles: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file)
        pastedFiles.push(file)
    }
  }

  if (pastedFiles.length > 0) {
    e.preventDefault()
    addFiles(pastedFiles)
  }
}

const modelValue = computed({
  get: () => textInput.value,
  set: val => setTextInput(val),
})
</script>

<template>
  <ScrollArea
    :class="cn(
      'min-w-0 flex-1 h-fit min-h-0 max-h-36 overflow-hidden relative',
      '[&>[data-slot=scroll-area-viewport]]:min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-36',
      props.containerClass,
    )"
  >
    <!-- Placeholder overlay: absolutely positioned so it never
         affects the textarea's field-sizing:content height.
         This prevents the flicker on mobile where the concatenated
         placeholder would otherwise change the textarea height. -->
    <div
      v-show="!textInput && !isComposing"
      class="absolute top-3 left-3 right-3 pointer-events-none text-muted-foreground text-base md:text-sm leading-normal select-none truncate"
    >
      {{ placeholderText }}
    </div>
    <!-- No native placeholder — the overlay above handles the visual.
         The textarea only grows via field-sizing:content from real user
         input, keeping the height stable when empty. -->
    <InputGroupTextarea
      v-model="modelValue"
      name="message"
      autocomplete="off"
      :class="cn('w-full field-sizing-content min-h-[3rem] overflow-hidden', props.class)"
      v-bind="textareaProps"
      @keydown="handleKeyDown"
      @paste="handlePaste"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false"
    />
  </ScrollArea>
</template>
