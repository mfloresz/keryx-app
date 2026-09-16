<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useArtifactStore } from '@/stores/artifact'
import { publishArtifactPreview } from '@/utils/artifactPreview'
import { Check, CodeIcon, Copy, Download, EyeIcon, ExternalLink, RotateCw, X, ChevronLeft, ChevronRight } from 'lucide-vue-next'

/**
 * Claude-style side panel for ```html artifacts.
 * Preview loads from a backend-published document (/api/artifacts/{token})
 * in an opaque-origin iframe (sandbox WITHOUT allow-same-origin).
 * A network document gets its own response headers, so unlike blob:/srcdoc
 * it does not inherit the app CSP and inline <script> + event handlers run,
 * while the artifact still cannot touch the parent DOM, cookies, storage
 * or OPFS.
 */
const store = useArtifactStore()
const { t } = useI18n()

const previewUrl = ref('')
const publishing = ref(false)
const publishError = ref<string | null>(null)
const justCopied = ref(false)
const urlCache = new Map<string, string>()
let requestId = 0

const position = () => (store.activeIndex >= 0 ? store.activeIndex + 1 : 0)

async function ensurePreview(republish = false) {
  const active = store.active
  if (!active) {
    previewUrl.value = ''
    return
  }
  if (!republish && urlCache.has(active.key)) {
    previewUrl.value = urlCache.get(active.key)!
    publishError.value = null
    return
  }
  const id = ++requestId
  publishing.value = true
  publishError.value = null
  try {
    const url = await publishArtifactPreview(active.code)
    if (id !== requestId) return
    urlCache.set(active.key, url)
    previewUrl.value = url
  } catch {
    if (id !== requestId) return
    previewError()
  } finally {
    if (id === requestId) publishing.value = false
  }
}

function previewError() {
  previewUrl.value = ''
  publishError.value = t('artifact.publishError')
}

watch(() => store.activeKey, () => { void ensurePreview() }, { immediate: true })

function copy() {
  const code = store.active?.code ?? ''
  if (!code) return
  void navigator.clipboard.writeText(code)
  justCopied.value = true
  setTimeout(() => { justCopied.value = false }, 1500)
}

function download() {
  const code = store.active?.code ?? ''
  if (!code) return
  const url = URL.createObjectURL(new Blob([code], { type: 'text/html' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `artifact-v${position() || 1}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openNewTab() {
  if (previewUrl.value) window.open(previewUrl.value, '_blank', 'noopener')
}
</script>

<template>
  <aside class="flex h-full w-full flex-col border-l bg-card lg:w-[480px] lg:min-w-[380px] lg:max-w-[50%]" aria-label="Artifacts">
    <div class="flex items-center gap-2 border-b px-3 py-2">
      <div class="flex items-center gap-1">
        <Button size="icon" variant="ghost" class="size-7" :disabled="store.all.length <= 1" :aria-label="t('artifact.previous')" @click="store.step(-1)">
          <ChevronLeft class="size-4" />
        </Button>
        <span class="min-w-14 text-center text-xs text-muted-foreground">{{ position() }} {{ t('message.of') }} {{ store.all.length }}</span>
        <Button size="icon" variant="ghost" class="size-7" :disabled="store.all.length <= 1" :aria-label="t('artifact.next')" @click="store.step(1)">
          <ChevronRight class="size-3.5" />
        </Button>
      </div>
      <select
        :value="store.activeKey ?? ''"
        class="h-7 max-w-40 truncate rounded-md border bg-background px-1 text-xs"
        :aria-label="t('artifact.version')"
        @change="store.select(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="(a, i) in store.all" :key="a.key" :value="a.key">v{{ i + 1 }}</option>
      </select>
      <div class="ml-auto flex items-center gap-1">
        <Button size="icon" variant="ghost" class="size-7" :aria-label="t('message.copy')" :title="t('message.copy')" @click="copy">
          <Check v-if="justCopied" class="size-3.5" />
          <Copy v-else class="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" class="size-7" :aria-label="t('artifact.download')" :title="t('artifact.download')" @click="download">
          <Download class="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" class="size-7" :aria-label="t('artifact.openNewTab')" :title="t('artifact.openNewTab')" @click="openNewTab">
          <ExternalLink class="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" class="size-7" :aria-label="t('artifact.reload')" :title="t('artifact.reload')" @click="ensurePreview(true)">
          <RotateCw class="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" class="size-7" :aria-label="t('app.dismiss')" @click="store.close()">
          <X class="size-4" />
        </Button>
      </div>
    </div>

    <div class="flex items-center gap-1 border-b px-3 py-1.5">
      <Button size="sm" :variant="store.tab === 'preview' ? 'secondary' : 'ghost'" class="h-7 text-xs" @click="store.setTab('preview')">
        <EyeIcon class="mr-1 size-3.5" />{{ t('message.preview') }}
      </Button>
      <Button size="sm" :variant="store.tab === 'code' ? 'secondary' : 'ghost'" class="h-7 text-xs" @click="store.setTab('code')">
        <CodeIcon class="mr-1 size-3.5" />{{ t('artifact.code') }}
      </Button>
      <span class="ml-auto hidden text-[11px] text-muted-foreground xl:inline">{{ t('artifact.isolatedNote') }}</span>
    </div>

    <div class="min-h-0 flex-1 bg-white">
      <iframe
        v-if="store.tab === 'preview' && previewUrl"
        :key="previewUrl"
        :src="previewUrl"
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        referrerpolicy="no-referrer"
        title="Artifact preview"
        class="h-full w-full border-0 bg-white"
      />
      <div v-else-if="store.tab === 'preview' && publishing" class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {{ t('artifact.publishing') }}
      </div>
      <div v-else-if="store.tab === 'preview' && publishError" class="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <span>{{ publishError }}</span>
        <Button size="sm" variant="outline" @click="ensurePreview(true)">{{ t('artifact.retry') }}</Button>
      </div>
      <div v-else-if="store.tab === 'preview'" class="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {{ t('artifact.empty') }}
      </div>
      <pre v-else class="h-full overflow-auto p-4 text-xs"><code>{{ store.active?.code ?? '' }}</code></pre>
    </div>
  </aside>
</template>
