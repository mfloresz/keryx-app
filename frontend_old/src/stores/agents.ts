import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { getAuthAdapter } from "@/services/runtime"
import type { ChatAgent } from "@/components/chat/ChatInput.vue"

export type Agent = ChatAgent

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

export const useAgentStore = defineStore("agents", () => {
  const agents = ref<Agent[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const mine = computed(() => agents.value.filter(a => a.source === "user_custom"))
  const shared = computed(() => agents.value.filter(a => a.source !== "user_custom"))
  const all = computed(() => agents.value)

  async function fetchAgents(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const res = await apiFetch("/api/agents")
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.message || `Failed to load agents: ${res.status}`)
      }
      const data = await res.json() as Agent[]
      // Sort: mine first then by name
      agents.value = [...data].sort((a, b) => {
        if (a.source === "user_custom" && b.source !== "user_custom") return -1
        if (a.source !== "user_custom" && b.source === "user_custom") return 1
        return a.name.localeCompare(b.name)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      // keep previous agents on error
      if (import.meta.env.DEV) console.error("[agents] fetch failed", err)
    } finally {
      isLoading.value = false
    }
  }

  async function getAgent(id: string): Promise<Agent | null> {
    // Prefer cached
    const cached = agents.value.find(a => a.id === id)
    if (cached) return cached
    try {
      const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Failed to get agent`)
      const data = await res.json() as Agent
      // also update cache
      const idx = agents.value.findIndex(a => a.id === data.id)
      if (idx >= 0) agents.value[idx] = data
      else agents.value.push(data)
      return data
    } catch {
      return null
    }
  }

  async function createAgent(payload: { name: string; description?: string; icon?: string; systemPrompt: string }): Promise<Agent> {
    const res = await apiFetch("/api/agents", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message || `Failed to create agent`)
    }
    const created = await res.json() as Agent
    created.source = "user_custom"
    agents.value.unshift(created)
    return created
  }

  async function updateAgent(id: string, payload: { name?: string; description?: string; icon?: string; systemPrompt?: string }): Promise<Agent> {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message || `Failed to update agent`)
    }
    const updated = await res.json() as Agent
    const idx = agents.value.findIndex(a => a.id === id)
    if (idx >= 0) agents.value[idx] = updated
    else agents.value.push(updated)
    return updated
  }

  async function deleteAgent(id: string): Promise<void> {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message || `Failed to delete agent`)
    }
    agents.value = agents.value.filter(a => a.id !== id)
  }

  async function duplicateAgent(id: string): Promise<Agent> {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}/duplicate`, {
      method: "POST",
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.message || `Failed to duplicate agent`)
    }
    const dup = await res.json() as Agent
    dup.source = "user_custom"
    agents.value.unshift(dup)
    return dup
  }

  return {
    agents,
    isLoading,
    error,
    mine,
    shared,
    all,
    fetchAgents,
    getAgent,
    createAgent,
    updateAgent,
    deleteAgent,
    duplicateAgent,
  }
})
