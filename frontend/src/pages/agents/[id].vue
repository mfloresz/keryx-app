<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Bot, ArrowUpRight, Plus, Paperclip, Zap, Mic, MoreHorizontal } from 'lucide-vue-next'
import { useAgentStore } from '@/stores/agents'
import type { Agent } from '@/stores/agents'
import { getAgentHeaderColor } from '@/composables/useAgentColor'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const agentStore = useAgentStore()
const { toast } = useToast()

const agentId = computed(() => String(route.params.id || ''))
const isNew = computed(() => agentId.value === 'new')

const isLoading = ref(true)
const isSaving = ref(false)
const isDeleting = ref(false)
const deleteOpen = ref(false)

const agent = ref<Agent | null>(null)
const form = ref({
  name: '',
  description: '',
  icon: '',
  systemPrompt: '',
})

const originalPrompt = ref('')

const isMine = computed(() => {
  if (isNew.value) return true
  return agent.value?.source === 'user_custom'
})
const canEdit = computed(() => isNew.value || isMine.value)

const headerColor = computed(() => {
  if (agent.value) return getAgentHeaderColor(agent.value.id, agent.value.source)
  if (form.value.name) return getAgentHeaderColor(form.value.name, 'user_custom')
  return '#ef4444'
})

const nameError = computed(() => {
  if (!form.value.name.trim()) return t('agents.editor.nameRequired')
  if (form.value.name.length > 80) return 'Max 80'
  return ''
})
const promptError = computed(() => {
  if (!form.value.systemPrompt.trim()) return t('agents.editor.promptRequired')
  if (form.value.systemPrompt.length > 10000) return t('agents.editor.promptTooLong')
  return ''
})
const canSave = computed(() => !nameError.value && !promptError.value && !isSaving.value && canEdit.value)

const charCount = computed(() => `${form.value.systemPrompt.length}/10000`)

function insertTag(tag: string) {
  const el = document.querySelector<HTMLTextAreaElement>('textarea[data-agent-prompt]')
  if (!el) {
    form.value.systemPrompt += tag
    return
  }
  const start = el.selectionStart ?? form.value.systemPrompt.length
  const end = el.selectionEnd ?? start
  const next = form.value.systemPrompt.slice(0, start) + tag + form.value.systemPrompt.slice(end)
  form.value.systemPrompt = next
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(start + tag.length, start + tag.length)
  })
}

async function loadAgent() {
  isLoading.value = true
  try {
    if (isNew.value) {
      agent.value = null
      form.value = { name: '', description: '', icon: '', systemPrompt: '' }
      originalPrompt.value = ''
      return
    }
    // Ensure store loaded
    if (agentStore.agents.length === 0) await agentStore.fetchAgents()
    const found = await agentStore.getAgent(agentId.value)
    if (!found) {
      toast(t('chat.notFoundTitle'))
      router.push('/agents')
      return
    }
    agent.value = found
    form.value = {
      name: found.name,
      description: found.description || '',
      icon: found.icon || '',
      systemPrompt: found.systemPrompt,
    }
    originalPrompt.value = found.systemPrompt
  } finally {
    isLoading.value = false
  }
}

async function handleSave() {
  if (!canSave.value) return
  isSaving.value = true
  try {
    if (isNew.value) {
      const created = await agentStore.createAgent({
        name: form.value.name.trim(),
        description: form.value.description.trim(),
        icon: form.value.icon.trim(),
        systemPrompt: form.value.systemPrompt,
      })
      toast(t('agents.editor.createdSuccess'), 'success')
      router.replace(`/agents/${created.id}`)
    } else if (agent.value) {
      const updated = await agentStore.updateAgent(agent.value.id, {
        name: form.value.name.trim(),
        description: form.value.description.trim(),
        icon: form.value.icon.trim(),
        systemPrompt: form.value.systemPrompt,
      })
      agent.value = updated
      originalPrompt.value = updated.systemPrompt
      toast(t('agents.editor.savedSuccess'), 'success')
    }
  } catch (e: any) {
    const msg = e?.message || t('agents.editor.savedError')
    if (msg.includes('Agent limit')) toast(t('agents.editor.limitReached'))
    else toast(msg)
  } finally {
    isSaving.value = false
  }
}

async function handleDuplicate() {
  if (!agent.value) return
  try {
    const dup = await agentStore.duplicateAgent(agent.value.id)
    toast(t('agents.editor.duplicatedSuccess'), 'success')
    router.push(`/agents/${dup.id}`)
  } catch (e: any) {
    toast(e?.message || t('agents.editor.savedError'))
  }
}

async function handleDelete() {
  if (!agent.value) return
  isDeleting.value = true
  try {
    await agentStore.deleteAgent(agent.value.id)
    toast(t('agents.editor.deletedSuccess'), 'success')
    router.push('/agents')
  } catch (e: any) {
    toast(e?.message || t('agents.editor.deletedError'))
  } finally {
    isDeleting.value = false
    deleteOpen.value = false
  }
}

function handleOpenChat() {
  const id = isNew.value ? null : agent.value?.id
  if (id) router.push({ path: '/', query: { agentId: id } })
  else router.push('/')
}

onMounted(loadAgent)
watch(() => route.params.id, loadAgent)

// Auto-save hint? No, manual.
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <!-- Loading -->
    <div v-if="isLoading" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('app.loading') }}
    </div>

    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <!-- Top breadcrumb + actions -->
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <div class="flex items-center gap-1.5 text-sm text-muted-foreground">
          <RouterLink to="/agents" class="hover:text-foreground hover:underline">{{ t('agents.editor.breadcrumb') }}</RouterLink>
          <span>/</span>
          <span class="font-medium text-foreground truncate max-w-[180px] sm:max-w-xs">{{ isNew ? t('agents.create') : agent?.name }}</span>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Badge v-if="!isNew" variant="secondary" class="gap-1.5 bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300">
            <span class="h-1.5 w-1.5 rounded-full bg-green-500" /> {{ t('agents.editor.saved') }}
          </Badge>
          <Badge variant="outline" class="gap-1.5">
            <Bot class="h-3 w-3" />
            {{ isMine ? t('agents.editor.private') : t('agents.editor.global') }}
          </Badge>
          <Button v-if="!isNew && !isMine" variant="outline" size="sm" @click="handleDuplicate">{{ t('agents.preview.duplicate') }}</Button>
          <Button v-if="!isNew && isMine" variant="ghost" size="icon" class="h-8 w-8" @click="deleteOpen = true">
            <MoreHorizontal class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <!-- Split: editor + preview -->
      <div class="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <!-- Left editor -->
        <div class="flex-1 overflow-y-auto">
          <div class="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
            <!-- Agent header -->
            <div class="flex items-start gap-3">
              <div
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                :style="{ backgroundColor: headerColor }"
              >
                <Bot class="h-7 w-7" />
              </div>
              <div class="min-w-0 flex-1">
                <Input
                  v-model="form.name"
                  :placeholder="t('agents.editor.namePlaceholder')"
                  :disabled="!canEdit"
                  maxlength="80"
                  class="h-9 text-base font-semibold"
                />
                <p v-if="nameError && form.name.length>0" class="mt-1 text-xs text-destructive">{{ nameError }}</p>
                <p class="mt-1 text-xs text-muted-foreground">{{ t('agents.editor.purpose') }}</p>
              </div>
            </div>

            <!-- Description -->
            <div class="mt-6 space-y-2">
              <Label>{{ t('agents.editor.descriptionLabel') }}</Label>
              <Input
                v-model="form.description"
                :placeholder="t('agents.editor.descriptionPlaceholder')"
                :disabled="!canEdit"
                maxlength="300"
              />
            </div>

            <!-- Icon selector -->
            <div class="mt-4 space-y-2">
              <Label>{{ t('agents.editor.iconLabel') }}</Label>
              <Select v-model="form.icon" :disabled="!canEdit">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Bot" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Bot (default)</SelectItem>
                  <SelectItem value="code">code</SelectItem>
                  <SelectItem value="scale">scale</SelectItem>
                  <SelectItem value="pen-line">pen-line</SelectItem>
                  <SelectItem value="sparkles">sparkles</SelectItem>
                  <SelectItem value="leaf">leaf</SelectItem>
                  <SelectItem value="brain">brain</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <!-- Instructions -->
            <div class="mt-6 space-y-2">
              <Label>{{ t('agents.editor.instructions') }}</Label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="tag in ['{username}','{datetime}','{language}']"
                  :key="tag"
                  type="button"
                  class="rounded-full border bg-muted px-2.5 py-1 text-xs font-mono hover:bg-muted/80"
                  @click="insertTag(tag)"
                  :disabled="!canEdit"
                >
                  {{ tag }}
                </button>
              </div>
              <Textarea
                v-model="form.systemPrompt"
                data-agent-prompt
                :placeholder="t('admin.agents.promptPlaceholder')"
                :disabled="!canEdit"
                class="min-h-[320px] font-mono text-sm leading-6"
                maxlength="10000"
              />
              <div class="flex items-center justify-between">
                <p class="text-xs text-muted-foreground">{{ t('agents.editor.instructionsHint') }}</p>
                <span class="text-xs text-muted-foreground">{{ charCount }}</span>
              </div>
              <p v-if="promptError && form.systemPrompt.length>0" class="text-xs text-destructive">{{ promptError }}</p>
              <p v-if="!canEdit" class="text-xs text-amber-600">{{ t('admin.agents.builtinHint') }}</p>
            </div>

            <!-- Dashed separators: Guardrails / Tone (coming soon) -->
            <div class="mt-8 space-y-4">
              <div class="border-t border-dashed pt-4">
                <button type="button" disabled class="flex w-full items-center justify-between text-left opacity-60">
                  <span class="text-sm text-muted-foreground">{{ t('agents.editor.guardrails') }}</span>
                  <span class="text-xs text-muted-foreground">{{ t('agents.editor.guardrailsHint') }}</span>
                </button>
              </div>
              <div class="border-t border-dashed pt-4">
                <button type="button" disabled class="flex w-full items-center justify-between text-left opacity-60">
                  <span class="text-sm text-muted-foreground">{{ t('agents.editor.tone') }}</span>
                  <span class="text-xs text-muted-foreground">{{ t('agents.editor.toneHint') }}</span>
                </button>
              </div>
              <div class="border-t border-dashed pt-4">
                <div class="space-y-1 opacity-60">
                  <p class="text-sm font-medium">{{ t('agents.editor.knowledge') }}</p>
                  <p class="text-xs text-muted-foreground">{{ t('agents.editor.knowledgeHint') }}</p>
                </div>
              </div>
            </div>

            <!-- Save bar -->
            <div class="mt-8 flex flex-wrap gap-2">
              <Button :disabled="!canSave" @click="handleSave">
                {{ isSaving ? t('agents.editor.saving') : t('agents.editor.save') }}
              </Button>
              <Button v-if="!isNew" variant="outline" @click="handleDuplicate">{{ t('agents.preview.duplicate') }}</Button>
              <Button v-if="!isNew && isMine" variant="destructive" @click="deleteOpen = true">{{ t('agents.preview.delete') }}</Button>
              <Button variant="ghost" @click="router.push('/agents')">{{ t('app.cancel') }}</Button>
            </div>
          </div>
        </div>

        <!-- Right preview (sticky) -->
        <div class="border-t bg-muted/20 lg:w-[380px] lg:shrink-0 lg:border-l lg:border-t-0">
          <div class="flex h-full flex-col">
            <div class="flex items-center justify-between px-4 py-3">
              <span class="text-sm text-muted-foreground">{{ t('agents.editor.previewTitle') }}</span>
              <Button variant="default" size="sm" class="gap-1 rounded-full" @click="handleOpenChat">
                {{ t('agents.editor.openChat') }}
                <ArrowUpRight class="h-3.5 w-3.5" />
              </Button>
            </div>

            <div class="flex flex-1 flex-col justify-end p-4">
              <!-- Preview card -->
              <div class="rounded-xl border bg-background shadow-sm overflow-hidden">
                <!-- Orange header as in screenshot -->
                <div class="flex items-center justify-between px-3 py-2" :style="{ backgroundColor: '#f97316' }">
                  <span class="flex items-center gap-2 text-sm font-medium text-white">
                    <Bot class="h-4 w-4" />
                    @{{ isNew ? (form.name || 'Nuevo Agente') : agent?.name }}
                  </span>
                  <span class="text-xs font-medium text-white/90">Actualizar a Skill</span>
                </div>
                <div class="p-3">
                  <div class="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
                    Escribe / para acceso rápido
                  </div>
                  <div class="mt-2 flex items-center gap-2">
                    <Button variant="ghost" size="icon" class="h-8 w-8 rounded-full border">
                      <Plus class="h-4 w-4" />
                    </Button>
                    <span class="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip class="h-3.5 w-3.5" /> 3/4
                    </span>
                    <span class="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Zap class="h-3.5 w-3.5" /> ▾
                    </span>
                    <Button size="icon" class="h-8 w-8 rounded-full bg-foreground text-background">
                      <Mic class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              <p class="mt-2 text-center text-xs text-muted-foreground">
                {{ isMine ? t('agents.editor.private') : t('agents.editor.global') }} · {{ form.name || '—' }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('agents.preview.delete') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('agents.preview.deleteConfirm') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="handleDelete">
            {{ isDeleting ? t('admin.shared.deleting') : t('app.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
