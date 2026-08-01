<script setup lang="ts">
import type { UIMessage, ToolUIPart, DynamicToolUIPart, FileUIPart } from 'ai'
import { computed, ref } from 'vue'
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments'
import type { AttachmentData } from '@/components/ai-elements/attachments'
import { ensureAttachmentResolved, resolvedAttachmentUrl } from '@/utils/attachmentUrl'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from '@/components/ai-elements/sources'
import {
  Pencil,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  Bot,
  User,
} from 'lucide-vue-next'

const props = defineProps<{
  message: UIMessage
  isStreaming?: boolean
  isEditing?: boolean
  vote?: boolean | null
}>()

const emit = defineEmits<{
  (e: 'branch-change', payload: { rootMessageId: string, snapshotId: string }): void
  (e: 'edit', message: UIMessage): void
  (e: 'regenerate', message: UIMessage): void
  (e: 'vote', message: UIMessage, isUpvoted: boolean): void
}>()

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

const reasoningParts = computed(() =>
  props.message.parts.filter(
    (p): p is { type: 'reasoning'; text: string; state?: 'streaming' | 'done' } => p.type === 'reasoning'
  )
)

const hasReasoning = computed(() => reasoningParts.value.length > 0)

const reasoningText = computed(() =>
  reasoningParts.value.map(p => p.text).join('\n')
)

const isReasoningStreaming = computed(() =>
  reasoningParts.value.some(p => p.state === 'streaming')
)

function isToolPart(part: any): part is ToolUIPart | DynamicToolUIPart {
  return typeof part?.type === 'string' && (
    part.type.startsWith('tool-') ||
    part.type === 'dynamic-tool'
  )
}

function isSourceUrlPart(part: any): part is { type: 'source-url'; sourceId: string; url: string; title?: string } {
  return part?.type === 'source-url'
}

function isSourceDocumentPart(part: any): part is { type: 'source-document'; sourceId: string; mediaType: string; title: string; filename?: string } {
  return part?.type === 'source-document'
}

const sourceUrlParts = computed(() =>
  props.message.parts.filter(isSourceUrlPart)
)

const sourceDocumentParts = computed(() =>
  props.message.parts.filter(isSourceDocumentPart)
)

const hasSources = computed(() =>
  sourceUrlParts.value.length > 0 || sourceDocumentParts.value.length > 0
)

const allSources = computed(() => [
  ...sourceUrlParts.value.map(p => ({ url: p.url, title: p.title || p.url })),
  ...sourceDocumentParts.value.map(p => ({ url: '#', title: p.title || p.filename || 'Document' })),
])

const fileParts = computed(() =>
  props.message.parts.filter((p): p is FileUIPart => p.type === 'file')
)

function getAttachmentStableId(part: FileUIPart, index: number): string {
  const storageKey = (part.providerMetadata as Record<string, any> | undefined)?.keryx?.storageKey
  if (typeof storageKey === 'string' && storageKey.length > 0) {
    return storageKey
  }

  if (typeof part.url === 'string' && part.url.startsWith('/api/attachments/')) {
    return part.url.slice('/api/attachments/'.length)
  }

  return `${part.filename || 'attachment'}-${index}`
}

const attachmentData = computed<AttachmentData[]>(() =>
  fileParts.value.map((p, i) => {
    ensureAttachmentResolved(p.url)
    return { ...p, id: getAttachmentStableId(p, i), url: resolvedAttachmentUrl(p.url) ?? p.url }
  })
)

function openAttachment(item: AttachmentData) {
  const url = item.type === 'file' ? item.url : undefined
  if (url) window.open(url, '_blank', 'noopener')
}

const hasAttachments = computed(() => fileParts.value.length > 0)

const branchMetadata = computed(() => {
  const metadata = props.message.metadata as Record<string, any> | undefined
  const branch = metadata?.keryxBranch
  if (!branch || !Array.isArray(branch.snapshots) || branch.snapshotCount <= 1) {
    return null
  }

  return branch as {
    rootMessageId: string
    currentSnapshotId: string
    currentIndex: number
    snapshotCount: number
    snapshots: Array<{ id: string, label: string }>
  }
})

const justCopied = ref(false)

function copyText() {
  const text = getTextContent(props.message)
  if (text) {
    navigator.clipboard.writeText(text)
    justCopied.value = true
    setTimeout(() => {
      justCopied.value = false
    }, 2000)
  }
}

function changeBranch(direction: -1 | 1) {
  const branch = branchMetadata.value
  if (!branch || branch.snapshotCount <= 1) {
    return
  }

  const nextIndex = (branch.currentIndex + direction + branch.snapshotCount) % branch.snapshotCount
  const nextSnapshot = branch.snapshots[nextIndex]
  if (!nextSnapshot) {
    return
  }

  emit('branch-change', {
    rootMessageId: branch.rootMessageId,
    snapshotId: nextSnapshot.id,
  })
}
</script>

<template>
  <Message :from="props.message.role" class="py-4">
    <MessageAvatar
      :name="props.message.role === 'user' ? $t('message.user') : $t('message.ai')"
      :fallback-icon="props.message.role === 'user' ? User : Bot"
      class="hidden shrink-0 md:flex"
    />

    <div class="flex-1 min-w-0">
      <MessageContent>
        <!-- Reasoning -->
        <Reasoning
          v-if="hasReasoning"
          :is-streaming="isReasoningStreaming"
          :default-open="false"
          class="mb-2"
        >
          <ReasoningTrigger />
          <ReasoningContent
            :content="reasoningText"
            :preview-lines="5"
          />
        </Reasoning>

        <!-- Message text -->
        <MessageResponse
          :content="getTextContent(props.message)"
          :streaming="props.isStreaming"
        />

        <!-- File attachments -->
        <Attachments v-if="hasAttachments" variant="list" class="mt-3 w-full max-w-2xl">
          <Attachment
            v-for="item in attachmentData"
            :key="item.id"
            :data="item"
            class="cursor-pointer"
            @click="openAttachment(item)"
          >
            <AttachmentPreview />
            <AttachmentInfo show-media-type />
          </Attachment>
        </Attachments>

        <!-- Tool invocations -->
        <div v-if="props.message.parts.some(isToolPart)" class="space-y-2">
          <Tool
            v-for="part in props.message.parts.filter(isToolPart)"
            :key="part.toolCallId"
          >
            <ToolHeader
              v-if="part.type === 'dynamic-tool'"
              type="dynamic-tool"
              :state="part.state"
              :tool-name="part.toolName"
            />
            <ToolHeader
              v-else
              :type="part.type"
              :state="part.state"
            />
            <ToolContent>
              <ToolInput
                v-if="part.input !== undefined"
                :input="part.input"
              />
              <ToolOutput
                v-if="part.output !== undefined || part.errorText !== undefined"
                :output="part.output"
                :error-text="part.errorText"
              />
            </ToolContent>
          </Tool>
        </div>

        <!-- Sources -->
        <Sources v-if="hasSources">
          <SourcesTrigger :count="allSources.length" />
          <SourcesContent>
            <Source
              v-for="source in allSources"
              :key="source.url"
              :href="source.url"
              :title="source.title"
            />
          </SourcesContent>
        </Sources>
      </MessageContent>

      <div
        v-if="branchMetadata"
        class="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
      >
        <button
          type="button"
          :aria-label="$t('message.previousBranch')"
          class="inline-flex size-6 items-center justify-center rounded-full transition hover:bg-background disabled:opacity-50"
          :disabled="branchMetadata.snapshotCount <= 1"
          @click="changeBranch(-1)"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </button>
        <span>{{ branchMetadata.currentIndex + 1 }} {{ $t('message.of') }} {{ branchMetadata.snapshotCount }}</span>
        <button
          type="button"
          :aria-label="$t('message.nextBranch')"
          class="inline-flex size-6 items-center justify-center rounded-full transition hover:bg-background disabled:opacity-50"
          :disabled="branchMetadata.snapshotCount <= 1"
          @click="changeBranch(1)"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Actions -->
      <MessageActions
        v-if="!isStreaming"
        :class="[
          'mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity',
          props.message.role === 'user' ? 'justify-end' : 'justify-start',
        ]"
      >
        <MessageAction
          v-if="props.message.role === 'user'"
          :tooltip="$t('message.edit')"
          @click="emit('edit', props.message)"
        >
          <Pencil class="h-3.5 w-3.5" />
        </MessageAction>
        <MessageAction
          v-if="props.message.role === 'assistant'"
          :tooltip="justCopied ? $t('message.copied') : $t('message.copy')"
          @click="copyText"
        >
          <Check v-if="justCopied" class="h-3.5 w-3.5" />
          <Copy v-else class="h-3.5 w-3.5" />
        </MessageAction>
        <MessageAction
          v-if="props.message.role === 'assistant'"
          :tooltip="$t('message.regenerate')"
          @click="emit('regenerate', props.message)"
        >
          <RotateCcw class="h-3.5 w-3.5" />
        </MessageAction>
        <MessageAction
          v-if="props.message.role === 'assistant'"
          :tooltip="$t('message.goodResponse')"
          :class="vote === true ? 'text-primary' : ''"
          @click="emit('vote', props.message, true)"
        >
          <ThumbsUp class="h-3.5 w-3.5" />
        </MessageAction>
        <MessageAction
          v-if="props.message.role === 'assistant'"
          :tooltip="$t('message.badResponse')"
          :class="vote === false ? 'text-destructive' : ''"
          @click="emit('vote', props.message, false)"
        >
          <ThumbsDown class="h-3.5 w-3.5" />
        </MessageAction>
      </MessageActions>
    </div>
  </Message>
</template>
