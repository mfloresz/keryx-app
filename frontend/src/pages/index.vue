<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
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
  <div class="flex flex-col h-full">
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <div class="text-center space-y-4 max-w-lg">
        <h1 class="text-3xl font-bold tracking-tight">{{ $t('chat.welcomeTitle') }}</h1>
        <p class="text-muted-foreground">{{ $t('chat.welcomeSubtitle') }}</p>
      </div>
    </div>

    <ChatInput
      :status="isSubmitting ? 'submitted' : 'ready'"
      :model="model"
      @submit="handleSubmit"
      @update:model="model = $event"
    />
  </div>
</template>
