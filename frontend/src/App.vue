<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useAppFont } from '@/composables/useAppFont'
import { Toaster } from '@/components/ui/sonner'
import AppLayout from './components/layout/AppLayout.vue'
import 'vue-sonner/style.css'

const route = useRoute()
const chatStore = useChatStore()
const authStore = useAuthStore()
const showLayout = computed(() => route.meta.layout !== false)
const isPublicRoute = computed(() => route.meta.public === true)
const canRenderProtectedLayout = computed(() => {
  if (!showLayout.value) return false
  if (isPublicRoute.value) return false
  return !authStore.isLoading && Boolean(authStore.session)
})
const hasLoadedChats = ref(false)

useAppFont()

async function loadChatsIfNeeded() {
  if (route.path === '/login' || hasLoadedChats.value) return
  if (authStore.session) {
    const loaded = await chatStore.fetchChats()
    if (loaded) hasLoadedChats.value = true
  }
}

onMounted(async () => {
  await authStore.loadSession()
  await loadChatsIfNeeded()
})

watch(() => route.path, async () => {
  await loadChatsIfNeeded()
}, { immediate: true })

watch(() => authStore.session, async (session, previousSession) => {
  if (session && !previousSession) {
    await loadChatsIfNeeded()
    return
  }
  if (!session && previousSession) {
    hasLoadedChats.value = false
  }
})
</script>

<template>
  <AppLayout v-if="canRenderProtectedLayout">
    <Suspense>
      <RouterView :key="String(route.params.id || route.path)" />
      <template #fallback>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-muted-foreground">{{ $t('app.loading') }}</div>
        </div>
      </template>
    </Suspense>
  </AppLayout>

  <Suspense v-else>
    <RouterView
      v-if="isPublicRoute || !showLayout"
      :key="String(route.params.id || route.path)"
    />
    <div v-else class="flex min-h-screen items-center justify-center">
      <div class="text-muted-foreground">{{ $t('app.loading') }}</div>
    </div>
    <template #fallback>
      <div class="flex min-h-screen items-center justify-center">
        <div class="text-muted-foreground">{{ $t('app.loading') }}</div>
      </div>
    </template>
  </Suspense>

  <Toaster rich-colors position="top-right" :close-button="true" />
</template>
