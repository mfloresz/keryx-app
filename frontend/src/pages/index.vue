<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useModels } from '@/composables/useModels'
import { useToast } from '@/composables/useToast'
import { persistAttachmentFiles } from '@/utils/chatAttachments'
import { getUserFacingChatError } from '@/utils/chatErrors'
import { getChatRepository } from '@/services/runtime'
import ChatInput from '@/components/chat/ChatInput.vue'
import type { AttachmentFile } from '@/components/ai-elements/prompt-input/types'

const router = useRouter()
const { t } = useI18n()
const chatStore = useChatStore()
const { model } = useModels()
const { toast } = useToast()
const chatRepository = await getChatRepository()

const isSubmitting = ref(false)

const authStore = useAuthStore()
const userDisplayName = computed(() => {
  const email = authStore.session?.user.email ?? ''
  const local = email.split('@')[0] ?? ''
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : ''
})

async function handleSubmit({ text, files, webSearch }: { text: string; files: AttachmentFile[]; webSearch: boolean }) {
  if (isSubmitting.value) return
  isSubmitting.value = true

  try {
    // Create the chat first: attachments are stored against a chat record.
    const baseChat = {
      id: crypto.randomUUID(),
      title: '' as string | null,
      visibility: 'private' as const,
      createdAt: new Date().toISOString(),
      messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }], createdAt: new Date().toISOString() }],
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

    router.push(`/chat/${chatId}`)
  } catch (error: any) {
    if (import.meta.env.DEV) console.error('Failed to create chat:', error)
    toast(getUserFacingChatError(error?.message, t))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <div class="w-full max-w-3xl min-w-0">
        <div class="mb-6 px-4">
          <img src="/logo.webp" alt="" class="h-12 w-12 object-contain" />
          <h1 class="mt-4 text-3xl font-semibold tracking-tight">
            {{ userDisplayName ? $t('chat.greeting', { name: userDisplayName }) : $t('chat.welcomeTitle') }}
          </h1>
        </div>

        <ChatInput
          :status="isSubmitting ? 'submitted' : 'ready'"
          :model="model"
          @submit="handleSubmit"
          @update:model="model = $event"
        />
      </div>
    </div>
  </div>
</template>
