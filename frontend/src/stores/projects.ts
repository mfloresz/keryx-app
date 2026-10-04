import { defineStore } from "pinia"
import { ref } from "vue"
import { getAuthAdapter } from "@/services/runtime"
import type { ChatProject } from "@/components/chat/ChatInput.vue"

export interface ProjectSummary extends ChatProject {
  ownerId?: string
  createdAt?: string
  updatedAt?: string
  fileCount: number
  totalSize: number
}

export interface ProjectFile {
  path: string
  size: number
  updatedAt: string
}

export type { ChatProject as Project }

async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter()
  return await auth.getAuthorizationHeaders()
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(await authHeaders()),
    ...(init?.headers as Record<string, string> ?? {}),
  }
  return fetch(path, { ...init, headers })
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null)
  return new Error(body?.message || fallback)
}

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref<ProjectSummary[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetchProjects(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const res = await apiFetch("/api/projects")
      if (!res.ok) throw await readError(res, "Failed to load projects")
      projects.value = (await res.json()) as ProjectSummary[]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      if (import.meta.env.DEV) console.error("[projects] fetch failed", err)
    } finally {
      isLoading.value = false
    }
  }

  async function createProject(payload: { name: string; description?: string }): Promise<ProjectSummary> {
    const res = await apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw await readError(res, "Failed to create project")
    const created = (await res.json()) as ProjectSummary
    created.fileCount = 0
    created.totalSize = 0
    projects.value.unshift(created)
    return created
  }

  async function updateProject(id: string, payload: { name: string; description?: string }): Promise<ProjectSummary> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw await readError(res, "Failed to update project")
    const updated = (await res.json()) as ProjectSummary
    const idx = projects.value.findIndex(p => p.id === id)
    if (idx >= 0) projects.value[idx] = { ...projects.value[idx], ...updated }
    return updated
  }

  async function deleteProject(id: string): Promise<void> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (!res.ok) throw await readError(res, "Failed to delete project")
    projects.value = projects.value.filter(p => p.id !== id)
  }

  async function listFiles(projectId: string): Promise<ProjectFile[]> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/files`)
    if (!res.ok) throw await readError(res, "Failed to list files")
    return (await res.json()) as ProjectFile[]
  }

  async function getFile(projectId: string, path: string): Promise<string> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw await readError(res, "Failed to read file")
    const data = await res.json() as { content?: string }
    return data.content ?? ""
  }

  async function putFile(projectId: string, path: string, content: string): Promise<void> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    })
    if (!res.ok) throw await readError(res, "Failed to write file")
  }

  async function deleteFile(projectId: string, path: string): Promise<void> {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    })
    if (!res.ok) throw await readError(res, "Failed to delete file")
  }

  return {
    projects,
    isLoading,
    error,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
    listFiles,
    getFile,
    putFile,
    deleteFile,
  }
})
