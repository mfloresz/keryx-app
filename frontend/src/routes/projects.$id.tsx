import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DownloadIcon,
  FileIcon,
  MessageSquareIcon,
  PencilIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useI18n } from "#/i18n";
import {
  useProjectsStore,
  type ProjectFile,
  type ProjectSummary,
} from "#/stores/projects";

export const Route = createFileRoute("/projects/$id")({
  component: ProjectDetailPage,
});

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    projects,
    fetchProjects,
    listFiles,
    getFile,
    putFile,
    deleteFile,
    deleteProject,
  } = useProjectsStore();

  const [project, setProject] = React.useState<ProjectSummary | null>(null);
  const [files, setFiles] = React.useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [openFile, setOpenFile] = React.useState<ProjectFile | null>(null);
  const [fileContent, setFileContent] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [newFilePath, setNewFilePath] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<ProjectFile | null>(
    null,
  );
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectFile | null>(
    null,
  );
  const [deleteProjectOpen, setDeleteProjectOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        await fetchProjects();
        const found = projects.find((p) => p.id === id);
        if (!cancelled) setProject(found ?? null);

        const list = await listFiles(id);
        if (!cancelled) setFiles(list);
      } catch {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function refreshFiles() {
    try {
      setFiles(await listFiles(id));
    } catch {
      setFiles([]);
    }
  }

  async function handleOpenFile(file: ProjectFile) {
    try {
      const content = await getFile(id, file.path);
      setOpenFile(file);
      setFileContent(content);
    } catch {
      toast.error("Failed to read file");
    }
  }

  async function handleSaveFile() {
    if (!openFile) return;
    setIsSaving(true);
    try {
      await putFile(id, openFile.path, fileContent);
      await refreshFiles();
      toast.success("File saved");
    } catch {
      toast.error("Failed to write file");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateFile() {
    const path = newFilePath.trim();
    if (!path) return;
    try {
      await putFile(id, path, "");
      await refreshFiles();
      setCreateOpen(false);
      setNewFilePath("");
    } catch {
      toast.error("Failed to create file");
    }
  }

  async function handleRenameFile() {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (!next) return;
    try {
      await putFile(id, renameTarget.path, fileContent);
      await putFile(id, next, fileContent);
      await deleteFile(id, renameTarget.path);
      await refreshFiles();
      setRenameTarget(null);
    } catch {
      toast.error("Failed to rename file");
    }
  }

  async function handleDownload(file: ProjectFile) {
    const content = await getFile(id, file.path);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = basename(file.path);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteFile() {
    if (!deleteTarget) return;
    try {
      await deleteFile(id, deleteTarget.path);
      await refreshFiles();
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete file");
    }
  }

  async function handleDeleteProject() {
    try {
      await deleteProject(id);
      setDeleteProjectOpen(false);
      void navigate({ to: "/projects" });
    } catch {
      toast.error("Failed to delete project");
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h2 className="font-heading text-lg font-semibold">
            {t("projects.emptyDescription")}
          </h2>
          <Button
            className="mt-4"
            onClick={() => void navigate({ to: "/projects" })}
          >
            {t("app.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{project.name}</h2>
          {project.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {project.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigate({ to: "/", search: { projectId: project.id } })
            }
          >
            <MessageSquareIcon className="mr-2 size-4" />
            {t("chat.askAboutProject")}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("projects.delete")}
            className="text-destructive"
            onClick={() => setDeleteProjectOpen(true)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {files.length} files
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setNewFilePath("");
            setCreateOpen(true);
          }}
        >
          New file
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            {t("projects.emptyDescription")}
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-1 p-4">
            {files.map((file) => (
              <div
                key={file.path}
                className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => void handleOpenFile(file)}
                  className="min-w-0 flex-1 text-left text-sm hover:underline"
                >
                  {basename(file.path)}
                </button>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSize(file.size)}
                </span>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("projects.edit")}
                    onClick={() => {
                      setRenameTarget(file);
                      setRenameValue(file.path);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Download"
                    onClick={() => {
                      void handleDownload(file);
                    }}
                  >
                    <DownloadIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("projects.delete")}
                    className="text-destructive"
                    onClick={() => setDeleteTarget(file)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File viewer / editor */}
      <Dialog
        open={openFile !== null}
        onOpenChange={(open) => !open && setOpenFile(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{openFile ? basename(openFile.path) : ""}</DialogTitle>
            <DialogDescription>{openFile?.path}</DialogDescription>
          </DialogHeader>
          <textarea
            value={fileContent}
            onChange={(event) => setFileContent(event.target.value)}
            rows={16}
            className="w-full resize-none rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFile(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => void handleSaveFile()}
            >
              <SaveIcon className="mr-2 size-4" />
              {t("app.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create file */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-file-path">Path</Label>
            <Input
              id="new-file-path"
              value={newFilePath}
              onChange={(event) => setNewFilePath(event.target.value)}
              placeholder="notes.md"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={!newFilePath.trim()}
              onClick={() => void handleCreateFile()}
            >
              {t("app.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename file */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.edit")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rename-file-path">Path</Label>
            <Input
              id="rename-file-path"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => void handleRenameFile()}
            >
              {t("app.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("projects.deleteTitle")}
        description={deleteTarget?.path}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void handleDeleteFile()}
      />

      <ConfirmDialog
        open={deleteProjectOpen}
        onOpenChange={setDeleteProjectOpen}
        title={t("projects.deleteTitle")}
        description={t("projects.deleteDescription")}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void handleDeleteProject()}
      />
    </div>
  );
}
