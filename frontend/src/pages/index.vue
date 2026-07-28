<script setup lang="ts">
/**
 * New Chat Page (index.vue)
 *
 * This is the initial view when the app opens. No chat ID exists yet.
 * When the user sends their first message:
 * 1. A chat is created via POST /api/chats
 * 2. The app navigates to /chat/:id
 * 3. The new chat page loads and starts streaming the AI response
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useModels } from '@/composables/useModels'

import { useToast } from '@/composables/useToast'
import { persistAttachmentFiles } from '@/utils/chatAttachments'
import { getUserFacingChatError, validateCloudAttachmentUrls } from '@/utils/chatErrors'
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
    const id = crypto.randomUUID()
    const cleanFiles = await persistAttachmentFiles(id, files)
    validateCloudAttachmentUrls(cleanFiles)

    const parts: any[] = [{ type: 'text', text }]
    if (cleanFiles.length) {
      parts.push(...cleanFiles)
    }

    const chat = {
      id,
      title: '' as string | null,
      visibility: 'private' as const,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          parts,
          createdAt: new Date().toISOString()
        }
      ],
      votes: [],
      webSearch: Boolean(webSearch)
    }

    await chatRepository.createChat(chat)

    // Optimistically add to sidebar so it appears instantly
    chatStore.addChat({
      id: chat.id,
      label: chat.title || 'Untitled',
      to: `/chat/${chat.id}`,
      createdAt: chat.createdAt
    })

    // Navigate immediately — the chat page will load the saved record
    // and auto-start the AI stream on mount.
    router.push(`/chat/${chat.id}`)
  }
  catch (error: any) {
    if (import.meta.env.DEV) {
      console.error('Failed to create chat:', error)
    }
    toast(getUserFacingChatError(error?.message, t))
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Empty state / Welcome area -->
    <div class="flex-1 flex flex-col items-center justify-center px-4">
      <div class="text-center space-y-4 max-w-lg">
        <h1 class="text-3xl font-bold tracking-tight">
          {{ $t('chat.welcomeTitle') }}
        </h1>
        <p class="text-muted-foreground">
          {{ $t('chat.welcomeSubtitle') }}
        </p>
      </div>
    </div>

    <!-- Input area -->
    <ChatInput
      :status="isSubmitting ? 'submitted' : 'ready'"
      :model="model"
      @submit="handleSubmit"
      @update:model="model = $event"
    />
  </div>
</template>
