<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useAppFont } from '@/composables/useAppFont'
import AppLayout from './components/layout/AppLayout.vue'
import { ENABLE_AUTH } from '@/app/config'

const route = useRoute()
const chatStore = useChatStore()
const authStore = useAuthStore()
const { toasts, dismiss } = useToast()
const showLayout = computed(() => route.meta.layout !== false)
const isPublicRoute = computed(() => route.meta.public === true)
const canRenderProtectedLayout = computed(() => {
  if (!showLayout.value) {
    return false
  }

  if (!ENABLE_AUTH) {
    return true
  }

  if (isPublicRoute.value) {
    return false
  }

  return !authStore.isLoading && Boolean(authStore.session)
})
const hasLoadedChats = ref(false)

// Initialize global font settings (applies CSS custom properties on :root)
useAppFont()

async function loadChatsIfNeeded() {
  if (route.path === '/login' || hasLoadedChats.value) {
    return
  }

  if (!ENABLE_AUTH || authStore.session) {
    const loaded = await chatStore.fetchChats()
    if (loaded) {
      hasLoadedChats.value = true
    }
  }
}

onMounted(async () => {
  if (ENABLE_AUTH) {
    await authStore.loadSession()
  }

  await loadChatsIfNeeded()
})

watch(
  () => route.path,
  async () => {
    await loadChatsIfNeeded()
  },
  { immediate: true }
)

watch(
  () => authStore.session,
  async (session, previousSession) => {
    if (session && !previousSession) {
      await loadChatsIfNeeded()
      return
    }

    if (!session) {
      if (previousSession) {
        hasLoadedChats.value = false
      }
      return
    }
  }
)
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
      v-if="!ENABLE_AUTH || isPublicRoute || !showLayout"
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

  <!-- Toast notifications -->
  <div aria-live="polite" role="status" class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="pointer-events-auto flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg transition-all"
      :class="{
        'border-destructive text-destructive': t.type === 'error',
        'border-success text-success': t.type === 'success',
        'border-primary text-primary': t.type === 'info',
      }"
    >
      <span class="text-sm">{{ t.message }}</span>
      <button
        type="button"
        class="text-xs opacity-70 hover:opacity-100"
        @click="dismiss(t.id)"
      >
        {{ $t('app.dismiss') || 'Dismiss' }}
      </button>
    </div>
  </div>
</template>
