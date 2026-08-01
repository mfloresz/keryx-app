<script setup lang="ts">
import type { UIMessage } from 'ai'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Message,
  MessageAvatar,
  MessageContent,
} from '@/components/ai-elements/message'
import Spinner from '@/components/ui/spinner/Spinner.vue'
import Shimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { Bot } from 'lucide-vue-next'
import ChatMessageItem from './ChatMessageItem.vue'

const props = defineProps<{
  messages: UIMessage[]
  status: 'ready' | 'streaming' | 'submitted' | 'error'
  votes?: Record<string, boolean | null>
}>()

const emit = defineEmits<{
  (e: 'branch-change', payload: { rootMessageId: string, snapshotId: string }): void
  (e: 'edit', message: UIMessage): void
  (e: 'regenerate', message: UIMessage): void
  (e: 'vote', message: UIMessage, isUpvoted: boolean): void
}>()

const scrollAreaRef = ref<InstanceType<typeof ScrollArea>>()
const viewportBottomSentinelRef = ref<HTMLElement | null>(null)
const isBottomVisible = ref(true)
let bottomObserver: IntersectionObserver | null = null

function scrollToBottom() {
  nextTick(() => {
    const viewport = scrollAreaRef.value?.$el.querySelector('[data-slot="scroll-area-viewport"]')
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  })
}

watch(() => props.messages.length, scrollToBottom)
watch(() => props.status, (status) => {
  if (status === 'streaming' || status === 'submitted') {
    scrollToBottom()
  }
})

function isLastMessage(index: number): boolean {
  return index === props.messages.length - 1
}

function handleVote(message: UIMessage, isUpvoted: boolean) {
  emit('vote', message, isUpvoted)
}

const lastMessage = computed(() => props.messages[props.messages.length - 1])
const hasAssistantContent = computed(() => {
  const message = lastMessage.value
  return message?.role === 'assistant' && Boolean(message.parts?.length)
})

const showInlineThinking = computed(() => {
  if (!isBottomVisible.value) return false
  if (props.status !== 'streaming' && props.status !== 'submitted') return false
  return !hasAssistantContent.value
})

const showFloatingIndicator = computed(() => {
  if (props.status !== 'streaming' && props.status !== 'submitted') return false
  return !isBottomVisible.value
})

onMounted(() => {
  const viewport = scrollAreaRef.value?.$el.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null
  const sentinel = viewportBottomSentinelRef.value

  if (!viewport || !sentinel) return

  bottomObserver = new IntersectionObserver(
    ([entry]) => {
      isBottomVisible.value = entry?.isIntersecting ?? true
    },
    {
      root: viewport,
      threshold: 1,
    },
  )

  bottomObserver.observe(sentinel)
})

onBeforeUnmount(() => {
  bottomObserver?.disconnect()
  bottomObserver = null
})
</script>

<template>
  <div class="flex-1 min-h-0 overflow-hidden relative">
    <ScrollArea ref="scrollAreaRef" class="h-full">
      <div class="max-w-3xl mx-auto space-y-2 p-4 pb-12">
        <ChatMessageItem
          v-for="(message, index) in props.messages"
          :key="message.id"
          :message="message"
          :is-streaming="isLastMessage(index) && message.role === 'assistant' && props.status === 'streaming'"
          :vote="votes?.[message.id] ?? null"
          @branch-change="emit('branch-change', $event)"
          @edit="emit('edit', $event)"
          @regenerate="emit('regenerate', $event)"
          @vote="handleVote"
        />

        <!-- Thinking indicator: shown while waiting for the assistant to start responding -->
        <Message
          v-if="showInlineThinking"
          from="assistant"
          class="py-4"
        >
          <MessageAvatar
            :name="$t('message.ai')"
            :fallback-icon="Bot"
            class="hidden shrink-0 md:flex"
          />
          <div class="flex-1 min-w-0">
            <MessageContent>
              <div class="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                <Shimmer>
                  {{ $t('chat.thinking') }}
                </Shimmer>
              </div>
            </MessageContent>
          </div>
        </Message>

        <div ref="viewportBottomSentinelRef" aria-hidden="true" class="h-px w-full" />
      </div>
    </ScrollArea>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 translate-y-2"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="showFloatingIndicator"
        class="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center"
      >
        <div class="rounded-2xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
          <div class="flex items-center gap-1.5" role="status" :aria-label="$t('chat.thinking')">
            <span class="size-2 rounded-full bg-foreground/70 animate-bounce" style="animation-delay: 0ms;" />
            <span class="size-2 rounded-full bg-foreground/70 animate-bounce" style="animation-delay: 140ms;" />
            <span class="size-2 rounded-full bg-foreground/70 animate-bounce" style="animation-delay: 280ms;" />
          </div>
        </div>
      </div>
    </Transition>

    <div
      class="pointer-events-none absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-background to-transparent"
    />
  </div>
</template>
