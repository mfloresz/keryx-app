<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatDistanceToNow } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { useProjectsStore, type ProjectSummary } from '@/stores/projects'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { Plus, Search, Folder, MoreVertical, Trash2, Pencil } from 'lucide-vue-next'

const router = useRouter()
const { t, locale } = useI18n()
const projectsStore = useProjectsStore()
const { toast } = useToast()

const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return projectsStore.projects
  return projectsStore.projects.filter(p =>
    p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)
  )
})

function dateLocale() {
  return locale.value.startsWith('es') ? es : enUS
}

function relativeDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true, locale: dateLocale() })
}

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Create dialog
const createOpen = ref(false)
const newName = ref('')
const newDescription = ref('')
const isCreating = ref(false)

function openCreate() {
  newName.value = ''
  newDescription.value = ''
  createOpen.value = true
}

async function confirmCreate() {
  const name = newName.value.trim()
  if (!name || isCreating.value) return
  isCreating.value = true
  try {
    const created = await projectsStore.createProject({ name, description: newDescription.value.trim() })
    createOpen.value = false
    router.push(`/projects/${created.id}`)
  } catch (err: any) {
    const limitReached = /limit/i.test(err?.message ?? '')
    toast(limitReached ? t('projects.limitReached') : t('projects.createFailed'))
  } finally {
    isCreating.value = false
  }
}

// Edit dialog
const editOpen = ref(false)
const editId = ref<string | null>(null)
const editName = ref('')
const editDescription = ref('')
const isSaving = ref(false)

function openEdit(project: ProjectSummary) {
  editId.value = project.id
  editName.value = project.name
  editDescription.value = project.description ?? ''
  editOpen.value = true
}

async function confirmEdit() {
  const id = editId.value
  const name = editName.value.trim()
  if (!id || !name || isSaving.value) return
  isSaving.value = true
  try {
    await projectsStore.updateProject(id, { name, description: editDescription.value.trim() })
    editOpen.value = false
  } catch {
    toast(t('projects.updateFailed'))
  } finally {
    isSaving.value = false
  }
}

// Delete dialog
const deleteOpen = ref(false)
const deleteTarget = ref<ProjectSummary | null>(null)
const isDeleting = ref(false)

function openDelete(project: ProjectSummary) {
  deleteTarget.value = project
  deleteOpen.value = true
}

async function confirmDelete() {
  const project = deleteTarget.value
  if (!project || isDeleting.value) return
  isDeleting.value = true
  try {
    await projectsStore.deleteProject(project.id)
    deleteOpen.value = false
  } catch {
    toast(t('projects.deleteFailed'))
  } finally {
    isDeleting.value = false
  }
}

onMounted(() => {
  void projectsStore.fetchProjects()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <div class="flex flex-1 flex-col overflow-y-auto">
      <div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <!-- Header -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{{ t('projects.title') }}</h1>
            <p class="mt-1 text-sm text-muted-foreground">{{ t('projects.subtitle') }}</p>
          </div>
          <Button class="shrink-0 rounded-full px-5" @click="openCreate">
            <Plus class="h-4 w-4" />
            {{ t('projects.create') }}
          </Button>
        </div>

        <!-- Search -->
        <div class="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            v-model="search"
            type="text"
            :placeholder="t('projects.search')"
            class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <!-- Loading skeleton -->
        <div v-if="projectsStore.isLoading && !projectsStore.projects.length" class="mt-6 space-y-3">
          <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-xl border bg-muted/50" />
        </div>

        <!-- Empty -->
        <div v-else-if="filtered.length === 0" class="mt-16 flex flex-col items-center justify-center text-center">
          <Folder class="h-10 w-10 text-muted-foreground/50" />
          <div class="mt-4 max-w-sm space-y-2">
            <h3 class="text-base font-medium">{{ projectsStore.projects.length === 0 ? t('projects.emptyTitle') : t('projects.noResults') }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ projectsStore.projects.length === 0 ? t('projects.emptyDescription') : '' }}
            </p>
            <Button v-if="!projectsStore.projects.length" class="mt-4" @click="openCreate">{{ t('projects.create') }}</Button>
          </div>
        </div>

        <!-- List -->
        <div v-else class="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <button
            v-for="(project, index) in filtered"
            :key="project.id"
            type="button"
            class="group flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-accent"
            :class="{ 'border-t border-border': index > 0 }"
            @click="router.push(`/projects/${project.id}`)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
              <Folder class="h-5 w-5 text-muted-foreground" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ project.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ t('projects.updated', { when: relativeDate(project.updatedAt || project.createdAt) }) }}
              </span>
            </span>
            <span class="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
              <span class="block">{{ project.fileCount === 0 ? t('projects.noFiles') : t('projects.fileCount', { count: project.fileCount }) }}</span>
              <span class="block">{{ formatSize(project.totalSize) }}</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 shrink-0"
                  @click.stop
                >
                  <MoreVertical class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem @click.stop="openEdit(project)">
                  <Pencil class="h-3.5 w-3.5 mr-2" />
                  {{ t('projects.edit') }}
                </DropdownMenuItem>
                <DropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click.stop="openDelete(project)"
                >
                  <Trash2 class="h-3.5 w-3.5 mr-2" />
                  {{ t('projects.delete') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </button>
        </div>
      </div>
    </div>

    <!-- Create dialog -->
    <Dialog :open="createOpen" @update:open="(v: boolean) => { if (!v) createOpen = false }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('projects.createTitle') }}</DialogTitle>
          <DialogDescription>{{ t('projects.createDescription') }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <Input v-model="newName" :placeholder="t('projects.namePlaceholder')" maxlength="80" />
          <Textarea v-model="newDescription" :placeholder="t('projects.descriptionPlaceholder')" class="min-h-[70px]" maxlength="300" />
        </div>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" @click="createOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="!newName.trim() || isCreating" @click="confirmCreate">
            {{ t('projects.create') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Edit dialog -->
    <Dialog :open="editOpen" @update:open="(v: boolean) => { if (!v) editOpen = false }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('projects.editTitle') }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-3">
          <Input v-model="editName" :placeholder="t('projects.namePlaceholder')" maxlength="80" />
          <Textarea v-model="editDescription" :placeholder="t('projects.descriptionPlaceholder')" class="min-h-[70px]" maxlength="300" />
        </div>
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" @click="editOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="!editName.trim() || isSaving" @click="confirmEdit">
            {{ t('app.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete confirm -->
    <AlertDialog :open="deleteOpen" @update:open="(v: boolean) => { if (!v) deleteOpen = false }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('projects.deleteTitle', { name: deleteTarget?.name ?? '' }) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('projects.deleteDescription') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="deleteTarget = null">{{ t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDelete">
            {{ t('app.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
