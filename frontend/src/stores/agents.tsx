import * as React from "react";

import type { ChatAgent } from "#/components/chat/types";
import { getAuthAdapter } from "#/services/runtime";

export type Agent = ChatAgent;

/** Normalizes a HeadersInit into a plain record so it can be spread. */
function toHeaderRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers as Record<string, string>;
}


async function authHeaders(): Promise<Record<string, string>> {
  const auth = await getAuthAdapter();
  return await auth.getAuthorizationHeaders();
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(await authHeaders()),
    ...toHeaderRecord(init?.headers),
  };
  return fetch(path, { ...init, headers });
}

interface AgentsContextValue {
  agents: Agent[];
  mine: Agent[];
  shared: Agent[];
  all: Agent[];
  isLoading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  getAgent: (id: string) => Promise<Agent | null>;
  createAgent: (payload: {
    name: string;
    description?: string;
    icon?: string;
    systemPrompt: string;
  }) => Promise<Agent>;
  updateAgent: (
    id: string,
    payload: Partial<{
      name: string;
      description?: string;
      icon?: string;
      systemPrompt: string;
    }>,
  ) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  duplicateAgent: (id: string) => Promise<Agent>;
}

const AgentsContext = React.createContext<AgentsContextValue | null>(null);

export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchAgents = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/agents");
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message || `Failed to load agents: ${res.status}`,
        );
      }
      const data = (await res.json()) as Agent[];
      // Sort: mine first, then by name.
      setAgents(
        [...data].sort((a, b) => {
          if (a.source === "user_custom" && b.source !== "user_custom")
            return -1;
          if (a.source !== "user_custom" && b.source === "user_custom")
            return 1;
          return a.name.localeCompare(b.name);
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (import.meta.env.DEV) console.error("[agents] fetch failed", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAgent = React.useCallback(async (id: string): Promise<Agent | null> => {
    try {
      const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to get agent");
      const data = (await res.json()) as Agent;
      setAgents((current) => {
        const index = current.findIndex((a) => a.id === data.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = data;
          return next;
        }
        return [...current, data];
      });
      return data;
    } catch {
      return null;
    }
  }, []);

  const createAgent = React.useCallback(
    async (payload: {
      name: string;
      description?: string;
      icon?: string;
      systemPrompt: string;
    }): Promise<Agent> => {
      const res = await apiFetch("/api/agents", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payloadError = await res.json().catch(() => null);
        throw new Error(
          payloadError?.message || `Failed to create agent: ${res.status}`,
        );
      }
      const created = (await res.json()) as Agent;
      setAgents((current) => [created, ...current]);
      return created;
    },
    [],
  );

  const updateAgent = React.useCallback(
    async (
      id: string,
      payload: Partial<{
        name: string;
        description?: string;
        icon?: string;
        systemPrompt: string;
      }>,
    ): Promise<Agent> => {
      const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const payloadError = await res.json().catch(() => null);
        throw new Error(
          payloadError?.message || `Failed to update agent: ${res.status}`,
        );
      }
      const updated = (await res.json()) as Agent;
      setAgents((current) =>
        current.map((a) => (a.id === id ? { ...a, ...updated } : a)),
      );
      return updated;
    },
    [],
  );

  const deleteAgent = React.useCallback(async (id: string) => {
    const res = await apiFetch(`/api/agents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(
        payload?.message || `Failed to delete agent: ${res.status}`,
      );
    }
    setAgents((current) => current.filter((a) => a.id !== id));
  }, []);

  const duplicateAgent = React.useCallback(
    async (id: string): Promise<Agent> => {
      const res = await apiFetch(
        `/api/agents/${encodeURIComponent(id)}/duplicate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message || `Failed to duplicate agent: ${res.status}`,
        );
      }
      const created = (await res.json()) as Agent;
      setAgents((current) => [created, ...current]);
      return created;
    },
    [],
  );

  const value = React.useMemo<AgentsContextValue>(
    () => ({
      agents,
      mine: agents.filter((a) => a.source === "user_custom"),
      shared: agents.filter((a) => a.source !== "user_custom"),
      all: agents,
      isLoading,
      error,
      fetchAgents,
      getAgent,
      createAgent,
      updateAgent,
      deleteAgent,
      duplicateAgent,
    }),
    [
      agents,
      isLoading,
      error,
      fetchAgents,
      getAgent,
      createAgent,
      updateAgent,
      deleteAgent,
      duplicateAgent,
    ],
  );

  return (
    <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>
  );
}

export function useAgentsStore(): AgentsContextValue {
  const context = React.useContext(AgentsContext);
  if (!context) {
    throw new Error("useAgentsStore must be used inside an AgentsProvider");
  }
  return context;
}
