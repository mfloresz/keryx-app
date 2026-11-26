import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FolderIcon, MessageSquareIcon, PencilIcon, Trash2Icon } from "lucide-react";
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
import { useProjectsStore, type ProjectSummary } from "#/stores/projects";

export const Route = createFileRoute("/projects/")({
  component: ProjectsPage,
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

function ProjectsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    projects,
    isLoading,
    fetchProjects,
    createProject,
    updateProject,
    deleteProject,
  } = useProjectsStore();

  const [search, setSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<ProjectSummary | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectSummary | null>(
    null,
  );
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  async function confirmCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      await createProject({ name: trimmed, description: description.trim() });
      setCreateOpen(false);
      setName("");
      setDescription("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("projects.createFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmEdit() {
    if (!editTarget) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      await updateProject(editTarget.id, {
        name: trimmed,
        description: description.trim(),
      });
      setEditTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("projects.updateFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteProject(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("projects.deleteDescription"),
      );
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {t("projects.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("projects.subtitle")}
              </p>
            </div>
            <Button
              className="shrink-0 rounded-full px-5"
              onClick={() => {
                setName("");
                setDescription("");
                setCreateOpen(true);
              }}
            >
              {t("projects.create")}
            </Button>
          </div>

          <div className="mt-6">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("projects.search")}
              aria-label={t("projects.search")}
              className="max-w-sm"
            />
          </div>

          {isLoading && projects.length === 0 ? (
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-40 animate-pulse rounded-xl border bg-muted/50"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-16 text-center text-sm text-muted-foreground">
              {t("projects.emptyDescription")}
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => (
                <div
                  key={project.id}
                  className="flex flex-col rounded-xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                      <h3 className="truncate text-sm font-semibold">
                        {project.name}
                      </h3>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("projects.edit")}
                        onClick={() => {
                          setEditTarget(project);
                          setName(project.name);
                          setDescription(project.description ?? "");
                        }}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("projects.delete")}
                        className="text-destructive"
                        onClick={() => setDeleteTarget(project)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>

                  {project.description ? (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {project.description}
                    </p>
                  ) : null}

                  <p className="mt-3 text-xs text-muted-foreground/70">
                    {project.fileCount} files · {formatSize(project.totalSize)}
                  </p>

                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void navigate({
                          to: "/projects/$id",
                          params: { id: project.id },
                        })
                      }
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void navigate({
                          to: "/",
                          search: { projectId: project.id },
                        })
                      }
                    >
                      <MessageSquareIcon className="mr-2 size-4" />
                      {t("chat.askAboutProject")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("projects.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Input
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isSaving || !name.trim()}
              onClick={() => void confirmCreate()}
            >
              {t("app.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("projects.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-project-name">Name</Label>
              <Input
                id="edit-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-project-description">Description</Label>
              <Input
                id="edit-project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isSaving || !name.trim()}
              onClick={() => void confirmEdit()}
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
        description={t("projects.deleteDescription")}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
