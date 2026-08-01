<script setup lang="ts">
/**
 * AppLayout
 *
 * Main layout wrapper providing the sidebar and content area.
 * All pages are rendered within the RouterView slot.
 *
 * Layout behavior:
 * - Desktop (>=1024px): AppSidebar is a persistent, collapsible column.
 * - Mobile/tablet (<1024px): the same AppSidebar instance becomes an
 *   off-canvas drawer, opened from the mobile header and closed via the
 *   backdrop, Escape, or any navigation.
 *
 * The mobile drawer state is deliberately local to this layout.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import AppSidebar from './AppSidebar.vue'

const route = useRoute()

// Mobile drawer state — local to this layout, never globalized.
const mobileOpen = ref(false)

// Drawer open button ref, so focus can return to it when the drawer closes.
const menuButtonRef = ref<InstanceType<typeof Button> | null>(null)

// Matches the `lg:` breakpoint (>=1024px = desktop).
const isMobile = ref(false)
let mediaQuery: MediaQueryList | null = null
function onMediaChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
  if (!e.matches) mobileOpen.value = false
}

// The off-canvas sidebar is inert (unfocusable, hidden from AT) only while
// closed on mobile. On desktop it is the primary navigation — never inert.
const sidebarInert = computed(() => isMobile.value && !mobileOpen.value)

function onKeydown(e: KeyboardEvent) {
  // reka-ui overlays (dialogs, popovers, menus) prevent default on their own
  // Escape handling, so the drawer only closes when nothing above it is open.
  if (e.key === 'Escape' && mobileOpen.value && !e.defaultPrevented) {
    mobileOpen.value = false
  }
}

onMounted(() => {
  mediaQuery = window.matchMedia('(max-width: 1023px)')
  isMobile.value = mediaQuery.matches
  mediaQuery.addEventListener('change', onMediaChange)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', onMediaChange)
  window.removeEventListener('keydown', onKeydown)
})

// Any navigation closes the drawer. Safety net alongside the explicit
// close in AppSidebar (covers same-route navigations that emit directly).
watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false
  },
)

// Basic focus management: focus the drawer when it opens, return focus to
// the trigger when it closes.
watch(mobileOpen, async (open) => {
  if (open) {
    await nextTick()
    document.getElementById('app-sidebar')?.focus()
  } else {
    menuButtonRef.value?.$el?.focus()
  }
})
</script>

<template>
  <div class="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground lg:flex-row">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:z-[999] focus:m-2 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg focus:outline-2 focus:outline-ring"
    >
      {{ $t('app.skipToContent') }}
    </a>

    <!-- Sidebar: static column on desktop, off-canvas drawer below lg.
         Single instance — the same component and navigation in both modes.
         Out of the flow on mobile when closed (fixed + translated away). -->
    <div
      class="fixed inset-y-0 left-0 z-40 transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0"
      :class="mobileOpen ? 'translate-x-0' : '-translate-x-full'"
      :inert="sidebarInert"
    >
      <AppSidebar v-model:mobile-open="mobileOpen" />
    </div>

    <!-- Drawer backdrop: rendered only while the drawer is open -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-300"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="mobileOpen"
        class="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
        aria-hidden="true"
        @click="mobileOpen = false"
      />
    </Transition>

    <!-- Mobile header: minimal chrome to open the drawer -->
    <header class="flex shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3 pt-[env(safe-area-inset-top)] text-sidebar-foreground lg:hidden">
      <Button
        ref="menuButtonRef"
        variant="ghost"
        size="icon"
        class="size-11 shrink-0"
        :aria-label="$t('sidebar.openMenu')"
        :aria-expanded="mobileOpen"
        aria-controls="app-sidebar"
        @click="mobileOpen = true"
      >
        <Menu class="h-5 w-5" />
      </Button>
      <RouterLink to="/" class="flex min-w-0 items-center gap-2 py-2">
        <img src="/logo.webp" alt="Keryx" class="h-8 w-8 object-contain" />
        <span class="truncate font-bold">{{ $t('app.name') }}</span>
      </RouterLink>
    </header>

    <main
      id="main-content"
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <slot />
    </main>
  </div>
</template>
