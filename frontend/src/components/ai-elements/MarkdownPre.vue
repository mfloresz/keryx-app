<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import { CodeBlockKey } from '@/components/ai-elements/code-block/context'
import { EyeIcon } from 'lucide-vue-next'
import { computed, onUpdated, provide, ref } from 'vue'

/**
 * Replacement renderer for <pre> elements in markdown (code fences).
 * Adds a hover toolbar with a copy button and, for HTML fences,
 * a sandboxed iframe preview.
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  language?: string
}>()

const preRef = ref<HTMLElement | null>(null)
const showPreview = ref(false)
// The slot content re-renders while streaming without swapping the <pre>
// element, so track updates to invalidate the cached text.
const renderVersion = ref(0)

onUpdated(() => {
  renderVersion.value++
})

const code = computed(() => {
  void renderVersion.value
  return preRef.value?.textContent ?? ''
})

provide(CodeBlockKey, { code })

const isHtml = computed(() => props.language === 'html')
</script>

<template>
  <div class="group/code relative">
    <pre ref="preRef" v-bind="$attrs"><slot /></pre>
    <div
      class="absolute top-2 right-2 z-10 flex gap-0.5 rounded-md bg-background/70 p-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-focus-within/code:opacity-100 group-hover/code:opacity-100"
    >
      <Button
        v-if="isHtml"
        size="icon"
        variant="ghost"
        class="size-7"
        :aria-label="$t('message.preview')"
        :title="$t('message.preview')"
        @click="showPreview = true"
      >
        <EyeIcon :size="14" />
      </Button>
      <CodeBlockCopyButton class="size-7" :aria-label="$t('message.copy')" :title="$t('message.copy')" />
    </div>
    <Dialog v-model:open="showPreview">
      <DialogContent class="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{{ $t('message.codePreview') }}</DialogTitle>
          <DialogDescription>{{ $t('message.codePreviewDescription') }}</DialogDescription>
        </DialogHeader>
        <iframe
          v-if="showPreview"
          sandbox="allow-scripts"
          :srcdoc="code"
          class="h-[70vh] w-full rounded-md border bg-white"
        />
      </DialogContent>
    </Dialog>
  </div>
</template>
