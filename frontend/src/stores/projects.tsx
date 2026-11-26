import * as React from "react";

import { getAuthAdapter } from "#/services/runtime";

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
  fileCount: number;
  totalSize: number;
}

export interface ProjectFile {
  path: string;
  size: number;
  updatedAt: string;
}

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

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.message || fallback);
}

interface ProjectsContextValue {
  projects: ProjectSummary[];
  isLoading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  createProject: (payload: {
    name: string;
    description?: string;
  }) => Promise<ProjectSummary>;
  updateProject: (
    id: string,
    payload: { name: string; description?: string },
  ) => Promise<ProjectSummary>;
  deleteProject: (id: string) => Promise<void>;
  listFiles: (projectId: string) => Promise<ProjectFile[]>;
  getFile: (projectId: string, path: string) => Promise<string>;
  putFile: (
    projectId: string,
    path: string,
    content: string,
  ) => Promise<void>;
  deleteFile: (projectId: string, path: string) => Promise<void>;
}

const ProjectsContext = React.createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchProjects = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/projects");
      if (!res.ok) throw await readError(res, "Failed to load projects");
      setProjects((await res.json()) as ProjectSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (import.meta.env.DEV) console.error("[projects] fetch failed", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createProject = React.useCallback(
    async (payload: { name: string; description?: string }) => {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await readError(res, "Failed to create project");
      const created = (await res.json()) as ProjectSummary;
      created.fileCount = 0;
      created.totalSize = 0;
      setProjects((current) => [created, ...current]);
      return created;
    },
    [],
  );

  const updateProject = React.useCallback(
    async (id: string, payload: { name: string; description?: string }) => {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw await readError(res, "Failed to update project");
      const updated = (await res.json()) as ProjectSummary;
      setProjects((current) =>
        current.map((p) => (p.id === id ? { ...p, ...updated } : p)),
      );
      return updated;
    },
    [],
  );

  const deleteProject = React.useCallback(async (id: string) => {
    const res = await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw await readError(res, "Failed to delete project");
    setProjects((current) => current.filter((p) => p.id !== id));
  }, []);

  const listFiles = React.useCallback(async (projectId: string) => {
    const res = await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
    );
    if (!res.ok) throw await readError(res, "Failed to list files");
    return (await res.json()) as ProjectFile[];
  }, []);

  const getFile = React.useCallback(
    async (projectId: string, path: string) => {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw await readError(res, "Failed to read file");
      const data = (await res.json()) as { content?: string };
      return data.content ?? "";
    },
    [],
  );

  const putFile = React.useCallback(
    async (projectId: string, path: string, content: string) => {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/file`,
        { method: "PUT", body: JSON.stringify({ path, content }) },
      );
      if (!res.ok) throw await readError(res, "Failed to write file");
    },
    [],
  );

  const deleteFile = React.useCallback(
    async (projectId: string, path: string) => {
      const res = await apiFetch(
        `/api/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(path)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw await readError(res, "Failed to delete file");
    },
    [],
  );

  const value = React.useMemo<ProjectsContextValue>(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjectsStore(): ProjectsContextValue {
  const context = React.useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjectsStore must be used inside a ProjectsProvider");
  }
  return context;
}
