<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { FavoriteMessageEntry } from '@/domain/chat/types'
import { getChatRepository } from '@/services/runtime'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { t } = useI18n()
const { toast } = useToast()
const chatRepository = await getChatRepository()

const isLoading = ref(true)
const favorites = ref<FavoriteMessageEntry[]>([])

async function loadFavorites() {
  isLoading.value = true
  try {
    favorites.value = await chatRepository.listFavorites()
  }
  catch {
    toast(t('favorites.failedLoad'))
    favorites.value = []
  }
  finally {
    isLoading.value = false
  }
}

function openChat(chatId: string) {
  router.push(`/chat/${chatId}`)
}

onMounted(loadFavorites)
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b px-4 py-3">
      <h2 class="font-semibold truncate">
        {{ $t('favorites.title') }}
      </h2>
      <p class="text-sm text-muted-foreground mt-1">
        {{ $t('favorites.description') }}
      </p>
    </div>

    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="text-muted-foreground">{{ $t('app.loading') }}</div>
    </div>

    <div v-else-if="favorites.length === 0" class="flex-1 flex items-center justify-center px-4">
      <div class="max-w-md text-center space-y-2">
        <h3 class="text-lg font-medium">{{ $t('favorites.emptyTitle') }}</h3>
        <p class="text-sm text-muted-foreground">{{ $t('favorites.emptyDescription') }}</p>
      </div>
    </div>

    <ScrollArea v-else class="flex-1 min-h-0">
      <div class="mx-auto max-w-5xl space-y-3 p-4">
        <div
          v-for="favorite in favorites"
          :key="`${favorite.chatId}:${favorite.messageId}`"
          class="rounded-xl border bg-card p-4 shadow-sm"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 space-y-2">
              <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ favorite.chatTitle || $t('favorites.untitledChat') }}
              </p>
              <p class="text-sm leading-6 text-foreground whitespace-pre-wrap break-words">
                {{ favorite.messagePreview }}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              class="shrink-0"
              @click="openChat(favorite.chatId)"
            >
              {{ $t('favorites.goToChat') }}
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
