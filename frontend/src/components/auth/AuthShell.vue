<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  imageAlt: string;
  imageSrc: string;
}>()

const imageError = ref(false)
</script>

<template>
  <div
    class="box-border h-[100dvh] overflow-hidden bg-[#f4f0e8] p-6 sm:p-8 lg:p-10"
  >
    <div class="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
      <div
        class="grid w-full overflow-hidden rounded-[28px] border border-border/70 bg-background md:aspect-[4/3] md:h-[calc(100dvh-6rem)] md:w-auto md:grid-cols-2"
      >
        <div class="flex min-h-0 items-center justify-center px-5 py-6 sm:px-10 sm:py-8 md:aspect-[2/3] md:px-12 md:py-10">
          <div class="w-full max-w-[28rem]">
            <slot />
          </div>
        </div>

        <div
          class="relative hidden min-h-0 overflow-hidden border-l border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(250,246,239,0.95))] md:aspect-[2/3] md:flex"
        >
          <div class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,250,235,0.96),rgba(240,241,235,0.72)_40%,rgba(225,236,228,0.38)_100%)]" />
          <div class="absolute left-6 top-8 h-24 w-24 rounded-full bg-amber-200/30 blur-3xl" />
          <div class="absolute right-8 top-14 h-32 w-32 rounded-full bg-emerald-200/25 blur-3xl" />
          <div class="absolute bottom-8 left-10 h-40 w-40 rounded-full bg-stone-200/35 blur-3xl" />

          <div class="relative z-10 flex h-full w-full items-stretch overflow-hidden">
            <img
              v-if="!imageError"
              :alt="imageAlt"
              :src="imageSrc"
              class="h-full w-full object-cover object-center drop-shadow-[0_26px_40px_rgba(87,97,91,0.18)]"
              @error="imageError = true"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center bg-muted/20"
              role="img"
              :aria-label="imageAlt"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground/40">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
