<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { persistAttachmentFiles } from '@/utils/chatAttachments'
import { getUserFacingChatError } from '@/utils/chatErrors'
import { getChatRepository, getAuthAdapter } from '@/services/runtime'
import { randomUUID } from '@/shared/uuid'
import ChatInput from '@/components/chat/ChatInput.vue'
import type { ModelPreset, ChatAgent } from '@/components/chat/ChatInput.vue'
import type { AttachmentFile } from '@/components/ai-elements/prompt-input/types'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const chatStore = useChatStore()
const { toast } = useToast()

const selectedPreset = ref('fast')
const presets = ref<ModelPreset[]>([])
const webSearchGloballyEnabled = ref(false)
const agents = ref<ChatAgent[]>([])
const selectedAgentId = ref<string | null>(null)

onMounted(async () => {
  try {
    const res = await fetch('/api/web-search/config')
    if (res.ok) {
      const data = await res.json()
      webSearchGloballyEnabled.value = data.enabled === true
    }
  } catch {
    // silently ignore — search toggle won't appear
  }
  try {
    const res = await fetch('/api/agents', {
      headers: await (await getAuthAdapter()).getAuthorizationHeaders(),
    })
    if (res.ok) agents.value = await res.json()
  } catch {
    agents.value = []
  }
  // Preselect agent from query string (e.g. coming from Agents preview → Chat)
  const qAgent = route.query.agentId
  if (typeof qAgent === 'string' && qAgent && agents.value.some(a => a.id === qAgent)) {
    selectedAgentId.value = qAgent
  }
})

watch(() => route.query.agentId, (val) => {
  if (typeof val === 'string' && val && agents.value.some(a => a.id === val)) {
    selectedAgentId.value = val
  }
})

function buildFallbackPresets() {
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
  ] satisfies ModelPreset[]
}

onMounted(async () => {
  try {
    const res = await fetch('/api/models/presets')
    if (res.ok) {
      presets.value = await res.json()
      if (!presets.value.length) {
        presets.value = buildFallbackPresets()
      }
      return
    }
  } catch {
    // fall through to fallback
  }

  presets.value = buildFallbackPresets()
})
const chatRepository = await getChatRepository()

const isSubmitting = ref(false)

const authStore = useAuthStore()
const userName = computed(() => authStore.session?.user.name ?? '')
const userDisplayName = computed(() => {
  if (userName.value) return userName.value
  const email = authStore.session?.user.email ?? ''
  const local = email.split('@')[0] ?? ''
  if (!local) return ''
  return local.charAt(0).toUpperCase() + local.slice(1)
})

async function handleSubmit({ text, files, webSearch }: { text: string; files: AttachmentFile[]; webSearch: boolean }) {
  if (isSubmitting.value) return
  isSubmitting.value = true

  try {
    // Create the chat first: attachments are stored against a chat record.
    const baseChat = {
      id: randomUUID(),
      title: '' as string | null,
      visibility: 'private' as const,
      createdAt: new Date().toISOString(),
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }], createdAt: new Date().toISOString() }],
      votes: [],
      webSearch: Boolean(webSearch),
    }
    const saved = await chatRepository.createChat(baseChat)
    const chatId = saved.id

    // Upload attachments against the real chat ID, then update the message
    // with persisted file parts.
    const cleanFiles = await persistAttachmentFiles(chatId, files)
    if (cleanFiles.length) {
      const parts: any[] = [{ type: 'text', text }, ...cleanFiles]
      await chatRepository.createChat({
        ...baseChat,
        id: chatId,
        messages: [{ ...baseChat.messages[0], parts }],
      } as any)
    }

    chatStore.addChat({
      id: chatId,
      label: baseChat.title || 'Untitled',
      to: `/chat/${chatId}`,
      createdAt: baseChat.createdAt,
    })

    router.push({
      path: `/chat/${chatId}`,
      query: { preset: selectedPreset.value, ...(selectedAgentId.value ? { agentId: selectedAgentId.value } : {}) },
    })
  } catch (error: any) {
    if (import.meta.env.DEV) console.error('Failed to create chat:', error)
    toast(getUserFacingChatError(error?.message, t))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-background">
    <div class="flex-1 flex flex-col items-center justify-center px-4 py-8">
      <div class="w-full max-w-3xl min-w-0">
        <div class="mb-8 px-1">
          <img src="/logo.webp" alt="" class="h-11 w-11 object-contain" />
          <h1 class="mt-4 text-[30px] font-semibold tracking-tight text-foreground">
            {{ userDisplayName ? $t('chat.greeting', { name: userDisplayName }) : $t('chat.welcomeTitle') }}
          </h1>
          <p class="mt-1.5 text-sm text-muted-foreground">
            {{ $t('chat.inputPlaceholder') }}
          </p>
        </div>

        <ChatInput
          :status="isSubmitting ? 'submitted' : 'ready'"
          :preset="selectedPreset"
          :presets="presets"
          :webSearchGloballyEnabled="webSearchGloballyEnabled"
          :agents="agents"
          :agent-id="selectedAgentId"
          @update:agentId="selectedAgentId = $event"
          @submit="handleSubmit"
          @update:preset="selectedPreset = $event"
        />
      </div>
    </div>
  </div>
</template>
