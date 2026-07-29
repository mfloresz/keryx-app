<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { InputGroupTextarea } from '@/components/ui/input-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import { reactiveOmit } from '@vueuse/core'
import { cn } from '@/lib/utils'
import { computed, ref } from 'vue'
import { usePromptInput } from './context'

type PromptInputTextareaProps = InstanceType<typeof InputGroupTextarea>['$props']

interface Props extends /* @vue-ignore */ PromptInputTextareaProps {
  class?: HTMLAttributes['class']
  containerClass?: HTMLAttributes['class']
}

const props = defineProps<Props>()
const textareaProps = reactiveOmit(props, 'class', 'containerClass')

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
          'min-w-0 flex-1 h-fit min-h-0 max-h-36 overflow-hidden',
          '[&>[data-slot=scroll-area-viewport]]:min-h-0 [&>[data-slot=scroll-area-viewport]]:max-h-36',
          props.containerClass,
        )"
  >
    <InputGroupTextarea
      v-model="modelValue"
      placeholder="What would you like to know?"
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
