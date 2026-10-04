<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { useProjectsStore, type ProjectFile } from '@/stores/projects'
import { useToast } from '@/composables/useToast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import {
  Plus, Search, Folder, MoreVertical, Trash2, Pencil, Eye, Download, ArrowLeft,
  MessageCircleQuestion, FileText,
} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const projectsStore = useProjectsStore()
const { toast } = useToast()

const projectId = computed(() => route.params.id as string)
const project = computed(() =>
  projectsStore.projects.find(p => p.id === projectId.value) ?? null
)
const notFound = ref(false)
const isLoading = computed(() => projectsStore.isLoading)

function dateLocale() {
  return locale.value.startsWith('es') ? es : enUS
}

function formatDate(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return format(d, 'd MMM yyyy', { locale: dateLocale() })
}

function formatSize(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileExt(path: string) {
  const dot = path.lastIndexOf('.')
  return dot > 0 ? path.slice(dot + 1).toUpperCase() : 'TXT'
}

function basename(path: string) {
  return path.split('/').pop() ?? path
}

// ---- Files ----
const files = ref<ProjectFile[]>([])
const filesLoading = ref(false)
const fileFilter = ref('')

const filteredFiles = computed(() => {
  const q = fileFilter.value.trim().toLowerCase()
  if (!q) return files.value
  return files.value.filter(f => f.path.toLowerCase().includes(q))
})

async function fetchFiles() {
  if (!projectId.value) return
  filesLoading.value = true
  try {
    files.value = await projectsStore.listFiles(projectId.value)
  } catch {
    files.value = []
  } finally {
    filesLoading.value = false
  }
}

// ---- View / edit file dialog ----
const fileDialogOpen = ref(false)
const viewingFile = ref<ProjectFile | null>(null)
const fileContent = ref('')
const fileLoading = ref(false)
const isSavingFile = ref(false)

async function openFile(file: ProjectFile) {
  viewingFile.value = file
  fileContent.value = ''
  fileDialogOpen.value = true
  fileLoading.value = true
  try {
    fileContent.value = await projectsStore.getFile(projectId.value, file.path)
  } catch {
    toast(t('projects.readFileFailed'))
  } finally {
    fileLoading.value = false
  }
}

async function saveFile() {
  const file = viewingFile.value
  if (!file || isSavingFile.value) return
  isSavingFile.value = true
  try {
    await projectsStore.putFile(projectId.value, file.path, fileContent.value)
    const updated = { ...file, size: fileContent.value.length }
    files.value = files.value.map(f => (f.path === file.path ? updated : f))
    fileDialogOpen.value = false
  } catch (err: any) {
    toast(/exceeds|limit/i.test(err?.message ?? '') ? t('projects.fileTooLarge') : t('projects.writeFileFailed'))
  } finally {
    isSavingFile.value = false
  }
}

// ---- Create file dialog ----
const createFileOpen = ref(false)
const newFilePath = ref('')
const newFileContent = ref('')
const isCreatingFile = ref(false)

function openCreateFile() {
  newFilePath.value = ''
  newFileContent.value = ''
  createFileOpen.value = true
}

async function confirmCreateFile() {
  const path = newFilePath.value.trim()
  if (!path || isCreatingFile.value) return
  isCreatingFile.value = true
  try {
    await projectsStore.putFile(projectId.value, path, newFileContent.value)
    files.value = [...files.value, { path, size: newFileContent.value.length, updatedAt: new Date().toISOString() }]
      .sort((a, b) => a.path.localeCompare(b.path))
    createFileOpen.value = false
  } catch (err: any) {
    toast(/exceeds|limit/i.test(err?.message ?? '') ? t('projects.fileTooLarge') : t('projects.writeFileFailed'))
  } finally {
    isCreatingFile.value = false
  }
}

// ---- Rename file (copy to new path, then drop the old one) ----
const renameFileOpen = ref(false)
const renameTarget = ref<ProjectFile | null>(null)
const renamePath = ref('')
const isRenamingFile = ref(false)

function openRenameFile(file: ProjectFile) {
  renameTarget.value = file
  renamePath.value = file.path
  renameFileOpen.value = true
}

async function confirmRenameFile() {
  const file = renameTarget.value
  const next = renamePath.value.trim()
  if (!file || !next || next === file.path || isRenamingFile.value) return
  isRenamingFile.value = true
  try {
    const content = await projectsStore.getFile(projectId.value, file.path)
    await projectsStore.putFile(projectId.value, next, content)
    await projectsStore.deleteFile(projectId.value, file.path)
    files.value = files.value
      .map(f => (f.path === file.path ? { ...f, path: next } : f))
      .sort((a, b) => a.path.localeCompare(b.path))
    renameFileOpen.value = false
  } catch {
    toast(t('projects.renameFileFailed'))
  } finally {
    isRenamingFile.value = false
  }
}

// ---- Delete file ----
const deleteFileOpen = ref(false)
const deleteFileTarget = ref<ProjectFile | null>(null)
const isDeletingFile = ref(false)

function openDeleteFile(file: ProjectFile) {
  deleteFileTarget.value = file
  deleteFileOpen.value = true
}

async function confirmDeleteFile() {
  const file = deleteFileTarget.value
  if (!file || isDeletingFile.value) return
  isDeletingFile.value = true
  try {
    await projectsStore.deleteFile(projectId.value, file.path)
    files.value = files.value.filter(f => f.path !== file.path)
    deleteFileOpen.value = false
  } catch {
    toast(t('projects.deleteFileFailed'))
  } finally {
    isDeletingFile.value = false
  }
}

// ---- Download ----
async function downloadFile(file: ProjectFile) {
  try {
    const content = await projectsStore.getFile(projectId.value, file.path)
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = basename(file.path)
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast(t('projects.readFileFailed'))
  }
}

// ---- Project edit / delete ----
const editOpen = ref(false)
const editName = ref('')
const editDescription = ref('')
const isSavingProject = ref(false)

function openEditProject() {
  if (!project.value) return
  editName.value = project.value.name
  editDescription.value = project.value.description ?? ''
  editOpen.value = true
}

async function confirmEditProject() {
  const name = editName.value.trim()
  if (!name || isSavingProject.value) return
  isSavingProject.value = true
  try {
    await projectsStore.updateProject(projectId.value, { name, description: editDescription.value.trim() })
    editOpen.value = false
  } catch {
    toast(t('projects.updateFailed'))
  } finally {
    isSavingProject.value = false
  }
}

const deleteProjectOpen = ref(false)
const isDeletingProject = ref(false)

async function confirmDeleteProject() {
  if (isDeletingProject.value) return
  isDeletingProject.value = true
  try {
    await projectsStore.deleteProject(projectId.value)
    router.push('/projects')
  } catch {
    toast(t('projects.deleteFailed'))
  } finally {
    isDeletingProject.value = false
  }
}

// "Hacer una pregunta": new chat with the project preselected.
function askAboutProject() {
  router.push({ path: '/', query: { projectId: projectId.value } })
}

onMounted(async () => {
  if (!projectsStore.projects.length) {
    await projectsStore.fetchProjects()
  }
  if (!project.value) {
    notFound.value = true
    return
  }
  void fetchFiles()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background">
    <div class="flex flex-1 flex-col overflow-y-auto">
      <div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <!-- Breadcrumb -->
        <button type="button" class="flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          @click="router.push('/projects')">
          <ArrowLeft class="h-3.5 w-3.5" />
          {{ t('projects.title') }}
        </button>

        <!-- Loading / not found -->
        <div v-if="isLoading" class="mt-10 h-24 animate-pulse rounded-xl border bg-muted/50" />
        <div v-else-if="notFound || !project" class="mt-16 text-center">
          <h2 class="text-base font-medium">{{ t('projects.notFound') }}</h2>
          <Button class="mt-4" variant="outline" @click="router.push('/projects')">{{ t('projects.title') }}</Button>
        </div>

        <template v-else>
          <!-- Header -->
          <div class="mt-4 flex items-start gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted">
              <Folder class="h-6 w-6 text-muted-foreground" />
            </span>
            <div class="min-w-0 flex-1">
              <h1 class="text-xl font-semibold tracking-tight">{{ project.name }}</h1>
              <p v-if="project.description" class="mt-1 text-sm text-muted-foreground">{{ project.description }}</p>
            </div>
          </div>

          <!-- Toolbar -->
          <div class="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" @click="openCreateFile">
              <Plus class="h-4 w-4" />
              {{ t('projects.newFile') }}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="w-8 px-0">
                  <MoreVertical class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem @click="openEditProject">
                  <Pencil class="h-3.5 w-3.5 mr-2" />
                  {{ t('projects.edit') }}
                </DropdownMenuItem>
                <DropdownMenuItem class="text-destructive focus:text-destructive" @click="deleteProjectOpen = true">
                  <Trash2 class="h-3.5 w-3.5 mr-2" />
                  {{ t('projects.delete') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button class="ms-auto rounded-full" size="sm" @click="askAboutProject">
              <MessageCircleQuestion class="h-4 w-4" />
              {{ t('projects.ask') }}
            </Button>
          </div>

          <!-- Files table -->
          <div class="mt-6 overflow-hidden rounded-xl border border-border bg-card">
            <div class="flex items-center gap-2 border-b border-border px-4 py-3">
              <Search class="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                v-model="fileFilter"
                type="text"
                :placeholder="t('projects.filterFiles')"
                class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div v-if="filesLoading" class="space-y-2 p-4">
              <div v-for="i in 3" :key="i" class="h-10 animate-pulse rounded-md bg-muted/50" />
            </div>
            <div v-else-if="filteredFiles.length === 0" class="px-4 py-10 text-center text-sm text-muted-foreground">
              {{ files.length === 0 ? t('projects.filesEmpty') : t('projects.noResults') }}
            </div>
            <div v-else>
              <div
                v-for="(file, index) in filteredFiles"
                :key="file.path"
                class="group flex items-center gap-3 px-4 py-3 transition hover:bg-accent"
                :class="{ 'border-t border-border': index > 0 }"
              >
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold text-muted-foreground">
                  <FileText class="h-4 w-4" />
                </span>
                <button type="button" class="min-w-0 flex-1 text-left" @click="openFile(file)">
                  <span class="block truncate text-sm">{{ file.path }}</span>
                  <span class="block text-xs text-muted-foreground">{{ fileExt(file.path) }} • {{ formatSize(file.size) }}</span>
                </button>
                <span class="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {{ formatDate(file.updatedAt) }}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0">
                      <MoreVertical class="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem @click="openFile(file)">
                      <Eye class="h-3.5 w-3.5 mr-2" />
                      {{ t('projects.openFile') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="openRenameFile(file)">
                      <Pencil class="h-3.5 w-3.5 mr-2" />
                      {{ t('projects.renameFile') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem @click="downloadFile(file)">
                      <Download class="h-3.5 w-3.5 mr-2" />
                      {{ t('projects.downloadFile') }}
                    </DropdownMenuItem>
                    <DropdownMenuItem class="text-destructive focus:text-destructive" @click="openDeleteFile(file)">
                      <Trash2 class="h-3.5 w-3.5 mr-2" />
                      {{ t('projects.delete') }}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- File view / edit dialog -->
    <Dialog :open="fileDialogOpen" @update:open="(v: boolean) => { if (!v) fileDialogOpen = false }">
      <DialogContent class="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader class="shrink-0">
          <DialogTitle class="truncate font-mono text-base">{{ viewingFile?.path }}</DialogTitle>
        </DialogHeader>
        <div class="flex-1 min-h-0 overflow-hidden">
          <div v-if="fileLoading" class="py-8 text-center text-sm text-muted-foreground">{{ t('app.loading') }}</div>
          <Textarea v-else v-model="fileContent" class="h-[50vh] font-mono text-xs" />
        </div>
        <DialogFooter class="gap-2 sm:gap-0 shrink-0">
          <Button variant="outline" @click="fileDialogOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="fileLoading || isSavingFile" @click="saveFile">
            {{ t('app.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Create file dialog -->
    <Dialog :open="createFileOpen" @update:open="(v: boolean) => { if (!v) createFileOpen = false }">
      <DialogContent class="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader class="shrink-0">
          <DialogTitle>{{ t('projects.newFile') }}</DialogTitle>
          <DialogDescription>{{ t('projects.newFileDescription') }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-3 shrink-0">
          <Input v-model="newFilePath" placeholder="personajes/ana.md" class="font-mono" maxlength="200" />
        </div>
        <Textarea v-model="newFileContent" class="min-h-[200px] font-mono text-xs" />
        <DialogFooter class="gap-2 sm:gap-0 shrink-0">
          <Button variant="outline" @click="createFileOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="!newFilePath.trim() || isCreatingFile" @click="confirmCreateFile">
            {{ t('projects.createFile') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Rename file dialog -->
    <Dialog :open="renameFileOpen" @update:open="(v: boolean) => { if (!v) renameFileOpen = false }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('projects.renameFile') }}</DialogTitle>
        </DialogHeader>
        <Input v-model="renamePath" class="font-mono" maxlength="200" @keydown.enter.prevent="confirmRenameFile" />
        <DialogFooter class="gap-2 sm:gap-0">
          <Button variant="outline" @click="renameFileOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="!renamePath.trim() || isRenamingFile" @click="confirmRenameFile">
            {{ t('app.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete file confirm -->
    <AlertDialog :open="deleteFileOpen" @update:open="(v: boolean) => { if (!v) deleteFileOpen = false }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('projects.deleteFileTitle', { path: deleteFileTarget?.path ?? '' }) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('projects.deleteFileDescription') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="deleteFileTarget = null">{{ t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDeleteFile">
            {{ t('app.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Edit project dialog -->
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
          <Button :disabled="!editName.trim() || isSavingProject" @click="confirmEditProject">
            {{ t('app.save') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete project confirm -->
    <AlertDialog :open="deleteProjectOpen" @update:open="(v: boolean) => { if (!v) deleteProjectOpen = false }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('projects.deleteTitle', { name: project?.name ?? '' }) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('projects.deleteDescription') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('app.cancel') }}</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDeleteProject">
            {{ t('app.delete') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
