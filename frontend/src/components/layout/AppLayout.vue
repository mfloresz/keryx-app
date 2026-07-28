<script setup lang="ts">
/**
 * AppLayout
 *
 * Main layout wrapper providing the sidebar and content area.
 * All pages are rendered within the RouterView slot.
 */
import AppSidebar from './AppSidebar.vue'
</script>

<template>
  <div class="flex h-screen w-full bg-background text-foreground overflow-hidden">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:z-[999] focus:m-2 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg focus:outline-2 focus:outline-ring"
    >
      {{ $t('app.skipToContent') }}
    </a>
    <AppSidebar />
    <main
      id="main-content"
      class="flex-1 flex min-h-0 flex-col min-w-0 overflow-hidden"
    >
      <slot />
    </main>
  </div>
</template>
