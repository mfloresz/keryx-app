<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Chat } from '@ai-sdk/vue'
import type { UIMessage, ChatStatus } from 'ai'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import type { ChatRecord } from '@/domain/chat/types'
import { useToast } from '@/composables/useToast'
import { persistAttachmentFiles } from '@/utils/chatAttachments'
import { getUserFacingChatError } from '@/utils/chatErrors'
import { getChatRepository } from '@/services/runtime'
import { KeryxChatTransport } from '@/services/keryxChatTransport'
import { getChatStreamApi, getChatTransportHeaders } from '@/services/chatTransport'
import ChatMessages from '@/components/chat/ChatMessages.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import type { ModelPreset } from '@/components/chat/ChatInput.vue'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AttachmentFile } from '@/components/ai-elements/prompt-input/types'

const route = useRoute()
const { t, locale } = useI18n()
const chatStore = useChatStore()
const authStore = useAuthStore()
const { toast } = useToast()
const chatRepository = await getChatRepository()

// Edit dialog state
const isEditDialogOpen = ref(false)
const editMessageId = ref<string | null>(null)
const editText = ref('')
const editTextareaRef = ref<any>(null)
const isEditing = ref(false)

const chatId = computed(() => route.params.id as string)

const chatData = ref<ChatRecord | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)

const chatTitle = computed(() => {
  const storeChat = chatStore.chats.find(c => c.id === chatId.value)
  return storeChat?.label || chatData.value?.title || 'Untitled'
})

// Presets state
const selectedPreset = ref(
  typeof route.query.preset === 'string' && route.query.preset
    ? route.query.preset
    : 'fast',
)
const presets = ref<ModelPreset[]>([])
const webSearchGloballyEnabled = ref(false)

function buildFallbackPresets(): ModelPreset[] {
  return [
    {
      preset: 'fast',
      label: t('chat.presetFast'),
      description: t('chat.presetFastDesc'),
      supportsImages: true,
      supportsSearch: false,
    },
    {
      preset: 'reflect',
      label: t('chat.presetReflect'),
      description: t('chat.presetReflectDesc'),
      supportsImages: false,
      supportsSearch: false,
    },
    {
      preset: 'extended_context',
      label: t('chat.presetExtended'),
      description: t('chat.presetExtendedDesc'),
      supportsImages: false,
      supportsSearch: false,
    },
  ]
}

function buildSearchRequestBody(webSearch: boolean) {
  return {
    preset: selectedPreset.value,
    webSearch,
    language: locale.value,
    // Dynamic user context the backend injects into its system prompt.
    username: authStore.userName || authStore.userEmail || '',
    datetime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  }
}

async function loadChat() {
  isLoading.value = true
  loadError.value = null
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const loadedChat = await Promise.race([
      chatRepository.getChat(chatId.value),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        }, { once: true })
      }),
    ])
    if (!loadedChat) throw new Error('Chat not found')
    chatData.value = loadedChat
  } catch (err: any) {
    loadError.value = err instanceof Error ? getUserFacingChatError(err.message, t) : t('chat.errors.unexpected')
  } finally {
    clearTimeout(timeoutId)
    isLoading.value = false
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function getMessageCreatedAt(message: UIMessage): string | null {
  return typeof (message as any).createdAt === 'string' ? (message as any).createdAt : null
}

function getMessageTextContent(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return ''
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('')
}

function findPersistedMessageMatch(message: UIMessage, persistedMessages: UIMessage[], usedIds = new Set<string>()): UIMessage | null {
  const currentId = typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : null
  if (currentId) {
    const exactMatch = persistedMessages.find(item => item.id === currentId && !usedIds.has(item.id))
    if (exactMatch) return exactMatch
  }
  const messageText = getMessageTextContent(message)
  const sourceCreatedAt = getMessageCreatedAt(message)
  const candidates = persistedMessages.filter(item => {
    if (!item.id || usedIds.has(item.id) || item.role !== message.role) return false
    return getMessageTextContent(item) === messageText
  })
  if (sourceCreatedAt) {
    const createdAtMatch = candidates.find(item => getMessageCreatedAt(item) === sourceCreatedAt)
    if (createdAtMatch) return createdAtMatch
  }
  return candidates.length === 1 ? candidates[0] ?? null : null
}



async function resolvePersistedMessageId(message: UIMessage): Promise<string | null> {
  const currentId = typeof message.id === 'string' && message.id.trim().length > 0 ? message.id : null
  const persistedChat = await chatRepository.getChat(chatId.value)
  if (!persistedChat) return currentId
  const persistedMessages = (persistedChat.messages || []) as UIMessage[]
  return findPersistedMessageMatch(message, persistedMessages)?.id ?? null
}



await loadChat()

// Votes
const votes = ref<Record<string, boolean | null>>({})
async function loadVotes() {
  try {
    const voteList = await chatRepository.getVotes(chatId.value)
    votes.value = voteList.reduce((acc: Record<string, boolean>, v: any) => {
      acc[v.messageId] = v.isUpvoted
      return acc
    }, {})
  } catch {
    // ignore vote load errors
  }
}
loadVotes()

// Initialize AI SDK Chat with custom transport
const chat = new Chat({
  id: chatId.value,
  messages: chatData.value?.messages || [],
  transport: new KeryxChatTransport({
    api: getChatStreamApi(chatId.value),
    headers: getChatTransportHeaders,
  }),
  onError(error) {
    let message = error.message
    if (typeof message === 'string' && message[0] === '{') {
      try { message = JSON.parse(message).message || message } catch { /* keep original */ }
    }
    toast(getUserFacingChatError(message, t))
  }
})

// Watch for streaming completion. Only lightweight metadata (title, usage)
// is refreshed — chat.messages is NOT re-hydrated here so the rendered
// conversation never flickers when a stream ends.
watch(() => chat.status, async (status, prevStatus) => {
  if ((prevStatus === 'streaming' || prevStatus === 'submitted') && status === 'ready') {
    await nextTick()
    setTimeout(async () => {
      try {
        const [updatedChat] = await Promise.all([chatRepository.getChat(chatId.value), loadVotes()])
        if (updatedChat) {
          chatData.value = { ...updatedChat, messages: chatData.value?.messages ?? updatedChat.messages }
          chatStore.updateChat(chatId.value, { label: updatedChat.title || 'Untitled' })
        }
      } catch {
        // ignore refresh errors after streaming
      }
    }, 0)
  }
})

// Handle new message submission
async function handleSubmit({ text, files, webSearch }: { text: string; files: AttachmentFile[]; webSearch: boolean }) {
  try {
    const cleanFiles = await persistAttachmentFiles(chatId.value, files)
    if (chatData.value) {
      chatData.value = { ...chatData.value, webSearch }
    }
    // The stream endpoint persists the user message (upsert by id) before
    // streaming and appends the assistant reply when done — no client-side
    // save of the full chat is needed, which avoids stale-state overwrites.
    // NOTE: no messageId here — passing one triggers the SDK's edit/resend
    // path and nothing is sent.
    chat.sendMessage(
      { text, files: cleanFiles },
      { body: buildSearchRequestBody(webSearch) }
    )
  } catch (error: any) {
    toast(getUserFacingChatError(error?.message, t))
  }
}

function handleStop() {
  chat.stop()
}

async function handleEdit(message: UIMessage) {
  const textParts = message.parts.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
  const currentText = textParts.map(p => p.text).join('')
  editMessageId.value = message.id
  editText.value = currentText
  isEditDialogOpen.value = true
  await nextTick()
  editTextareaRef.value?.$el?.focus()
}

async function confirmEdit() {
  if (!editMessageId.value || isEditing.value) return
  const text = editText.value.trim()
  if (!text || text.length > 10000) return
  isEditing.value = true
  isEditDialogOpen.value = false
  const messageId = editMessageId.value
  try {
    await chatRepository.deleteMessage(chatId.value, { messageId, type: 'edit' })
  } catch {
    toast(t('chat.failedEdit'))
    isEditing.value = false
    return
  }
  // deleteMessage keeps the target user message in place; the stream
  // endpoint upserts it by id with the edited text and appends the new
  // assistant reply atomically server-side.
  chat.sendMessage({ text, messageId }, { body: buildSearchRequestBody(chatData.value?.webSearch ?? false) })
  editMessageId.value = null
  editText.value = ''
  isEditing.value = false
}

function cancelEdit() {
  isEditDialogOpen.value = false
  editMessageId.value = null
  editText.value = ''
}

async function handleRegenerate(message: UIMessage) {
  try {
    await chatRepository.deleteMessage(chatId.value, { messageId: message.id, type: 'regenerate' })
  } catch {
    toast(t('chat.failedRegenerate'))
    return
  }
  chat.regenerate({ messageId: message.id, body: buildSearchRequestBody(chatData.value?.webSearch ?? false) })
}

async function handleBranchChange(payload: { rootMessageId: string; snapshotId: string }) {
  try {
    const updatedChat = await chatRepository.switchBranch(chatId.value, payload)
    chatData.value = updatedChat
    chat.messages = cloneJson(updatedChat.messages)
    await loadVotes()
  } catch {
    toast(t('chat.failedSwitchBranch'))
  }
}

async function handleVote(message: UIMessage, isUpvoted: boolean) {
  const resolvedMessageId = await resolvePersistedMessageId(message)
  if (!resolvedMessageId) {
    toast(t('chat.failedVote'))
    return
  }
  const currentVote = votes.value[resolvedMessageId]
  const toggling = currentVote === isUpvoted
  const next = toggling ? undefined : isUpvoted

  if (next === undefined) {
    delete votes.value[resolvedMessageId]
  } else {
    votes.value[resolvedMessageId] = next
  }

  try {
    await chatRepository.saveVote(
      chatId.value,
      next === undefined ? { messageId: resolvedMessageId } : { messageId: resolvedMessageId, isUpvoted: next }
    )
  } catch (error: any) {
    if (typeof error?.message === 'string' && error.message.includes('Message not found')) {
      try {
        const retriedMessageId = await resolvePersistedMessageId(message)
        if (retriedMessageId && retriedMessageId !== resolvedMessageId) {
          await chatRepository.saveVote(
            chatId.value,
            next === undefined ? { messageId: retriedMessageId } : { messageId: retriedMessageId, isUpvoted: next }
          )
          if (resolvedMessageId !== retriedMessageId) {
            delete votes.value[resolvedMessageId]
            if (next !== undefined) votes.value[retriedMessageId] = next
          }
          return
        }
      } catch {
        // fall through to revert
      }
    }
    if (currentVote !== undefined) {
      votes.value[resolvedMessageId] = currentVote
    } else {
      delete votes.value[resolvedMessageId]
    }
    toast(t('chat.failedVote'))
  }
}

onMounted(async () => {
  // Fetch web search global config
  try {
    const res = await fetch('/api/web-search/config')
    if (res.ok) {
      const data = await res.json()
      webSearchGloballyEnabled.value = data.enabled === true
    }
  } catch {
    // silently ignore — search toggle won't appear
  }
  // Fetch presets with capabilities
  try {
    const res = await fetch('/api/models/presets')
    if (res.ok) {
      presets.value = await res.json()
      if (!presets.value.length) {
        presets.value = buildFallbackPresets()
      }
    } else {
      presets.value = buildFallbackPresets()
    }
  } catch {
    presets.value = buildFallbackPresets()
  }
})

onMounted(async () => {
  if (chatData.value?.messages?.length === 1 && chatData.value.messages[0]?.role === 'user') {
    chat.regenerate({ body: buildSearchRequestBody(chatData.value?.webSearch ?? false) })
  }
})
</script>

<template>
  <div v-if="isLoading" class="flex-1 flex items-center justify-center overflow-hidden break-words">
    <div class="text-muted-foreground">{{ $t('chat.loadingChat') }}</div>
  </div>

  <div v-else-if="loadError" class="flex-1 flex items-center justify-center overflow-hidden break-words">
    <div class="text-center space-y-4">
      <h2 class="text-xl font-semibold">{{ $t('chat.notFoundTitle') }}</h2>
      <p class="text-muted-foreground">{{ loadError }}</p>
      <RouterLink to="/" class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2">
        {{ $t('chat.startNewChat') }}
      </RouterLink>
    </div>
  </div>

  <div v-else class="flex flex-col h-full">
    <!-- Edit message dialog -->
    <Dialog :open="isEditDialogOpen" @update:open="(v: boolean) => { if (!v) cancelEdit() }">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ $t('message.edit') }}</DialogTitle>
        </DialogHeader>
        <Textarea ref="editTextareaRef" v-model="editText" class="min-h-[120px]" maxlength="10000"
          @keydown.enter.meta="confirmEdit" @keydown.enter.ctrl="confirmEdit" />
        <div class="text-xs text-muted-foreground text-right mt-1">{{ editText.length }}/10000</div>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" @click="cancelEdit">{{ $t('app.cancel') }}</Button>
          <Button @click="confirmEdit">{{ $t('message.edit') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Chat header -->
    <div class="hidden lg:block px-4 py-3">
      <h2 class="font-semibold truncate">{{ chatTitle }}</h2>
    </div>

    <!-- Messages -->
    <ChatMessages :messages="chat.messages" :status="(chat.status as ChatStatus)" :votes="votes"
      @branch-change="handleBranchChange" @edit="handleEdit" @regenerate="handleRegenerate" @vote="handleVote" />

    <!-- Input -->
    <ChatInput :status="chat.status" :preset="selectedPreset" :presets="presets" :web-search="chatData?.webSearch"
      :webSearchGloballyEnabled="webSearchGloballyEnabled"
      @submit="handleSubmit" @update:preset="selectedPreset = $event" @stop="handleStop" />
  </div>
</template>
