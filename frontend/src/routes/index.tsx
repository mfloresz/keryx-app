import * as React from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { ChatPromptInput } from "#/components/chat/chat-prompt-input";
import type {
  ChatAgent,
  ChatProject,
  ModelPreset,
  PendingAttachment,
} from "#/components/chat/types";
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
import { getAuthAdapter, getChatRepository } from "#/services/runtime";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";
import { useProjectsStore } from "#/stores/projects";
import { getUserFacingChatError } from "#/utils/chat-errors";
import { randomUUID } from "#/shared/uuid";
import { chatSearchSchema } from "#/routes/-search";

export const Route = createFileRoute("/")({
  validateSearch: chatSearchSchema,
  component: NewChat,
});

function buildFallbackPresets(t: (key: string) => string): ModelPreset[] {
  return [
    {
      preset: "fast",
      label: t("chat.presetFast"),
      description: t("chat.presetFastDesc"),
      supportsImages: true,
      supportsSearch: false,
    },
    {
      preset: "reflect",
      label: t("chat.presetReflect"),
      description: t("chat.presetReflectDesc"),
      supportsImages: false,
      supportsSearch: false,
    },
    {
      preset: "extended_context",
      label: t("chat.presetExtended"),
      description: t("chat.presetExtendedDesc"),
      supportsImages: false,
      supportsSearch: false,
    },
  ];
}

function NewChat() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const { userName, userEmail } = useAuth();
  const chatStore = useChatStore();
  const projectsStore = useProjectsStore();

  const [presets, setPresets] = React.useState<ModelPreset[]>([]);
  const [agents, setAgents] = React.useState<ChatAgent[]>([]);
  const [webSearchGloballyEnabled, setWebSearchGloballyEnabled] =
    React.useState(false);
  const [selectedPreset, setSelectedPreset] = React.useState("fast");
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(
    search.agentId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(
    search.projectId ?? null,
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState("");
  const [newProjectDescription, setNewProjectDescription] = React.useState("");
  const [isCreatingProject, setIsCreatingProject] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/web-search/config");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setWebSearchGloballyEnabled(data.enabled === true);
        }
      } catch {
        // Silently ignore — the toggle simply won't appear.
      }

      try {
        const res = await fetch("/api/agents", {
          headers: await (await getAuthAdapter()).getAuthorizationHeaders(),
        });
        if (res.ok && !cancelled) {
          setAgents((await res.json()) as ChatAgent[]);
        }
      } catch {
        if (!cancelled) setAgents([]);
      }

      try {
        const res = await fetch("/api/models/presets");
        if (res.ok) {
          const data = (await res.json()) as ModelPreset[];
          if (data.length) {
            if (!cancelled) setPresets(data);
            return;
          }
        }
      } catch {
        // Fall through to the built-in presets.
      }
      if (!cancelled) setPresets(buildFallbackPresets(t));
    })();

    return () => {
      cancelled = true;
    };
  }, [t]);

  React.useEffect(() => {
    if (selectedProjectId) {
      void projectsStore.fetchProjects();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit({
    text,
    files,
    webSearch,
  }: {
    text: string;
    files: PendingAttachment[];
    webSearch: boolean;
  }) {
    if (isSubmitting) return;
    setIsSubmitting(true);

    // Persisted attachment parts, carried over to the conversation route.
    let pendingFiles: unknown[] = [];

    try {
      const repo = await getChatRepository();
      // The chat starts empty. The first user message is persisted by the
      // stream endpoint, which upserts it by id — persisting it here too
      // would show it twice.
      const baseChat = {
        id: randomUUID(),
        title: "" as string | null,
        visibility: "private" as const,
        createdAt: new Date().toISOString(),
        messages: [],
        votes: [],
        webSearch: Boolean(webSearch),
        preset: selectedPreset,
        agentId: selectedAgentId,
        projectId: selectedProjectId ?? undefined,
      };
      const saved = await repo.createChat(baseChat);
      const chatId = saved.id;

      // Attachments are uploaded against the real chat ID; the stream
      // request then references them by storage key.
      if (files.length) {
        const attachmentRepo = await import(
          "#/adapters/api/api-attachment-repository"
        ).then((m) => m.apiAttachmentRepository);
        const cleanFiles = await attachmentRepo.persistFiles(
          chatId,
          files.map((file) => ({
            file: file.file,
            filename: file.filename,
            mediaType: file.mediaType,
            convertedMarkdown: file.convertedMarkdown,
          })),
        );
        if (cleanFiles.length) {
          pendingFiles = cleanFiles;
        }
      }

      chatStore.addChat({
        id: chatId,
        label: baseChat.title || "Untitled",
        to: `/chat/${chatId}`,
        createdAt: baseChat.createdAt,
      });

      // The chat is created with the user message already persisted, so the
      // conversation route only has to run the stream — the message itself
      // is handed over through the router state.
      void navigate({
        to: "/chat/$id",
        params: { id: chatId },
        search: {
          preset: selectedPreset,
          ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
          ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        },
        state: {
          pendingText: text,
          pendingWebSearch: Boolean(webSearch),
          pendingFiles,
        },
      });
    } catch (err) {
      toast.error(
        getUserFacingChatError(
          err instanceof Error ? err.message : null,
          t,
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCreateProject() {
    const name = newProjectName.trim();
    if (!name || isCreatingProject) return;
    setIsCreatingProject(true);
    try {
      const created = await projectsStore.createProject({
        name,
        description: newProjectDescription.trim(),
      });
      setSelectedProjectId(created.id);
      setCreateProjectOpen(false);
      setNewProjectName("");
      setNewProjectDescription("");
    } catch {
      toast.error(t("chat.project.createFailed"));
    } finally {
      setIsCreatingProject(false);
    }
  }

  const displayName = userName || userEmail?.split("@")[0] || "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-3xl min-w-0">
          <div className="mb-8 px-1">
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
              {displayName
                ? t("chat.greeting", { name: displayName })
                : t("chat.welcomeTitle")}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("chat.inputPlaceholder")}
            </p>
          </div>

          <ChatPromptInput
            status={isSubmitting ? "submitted" : "ready"}
            preset={selectedPreset}
            presets={presets}
            webSearchGloballyEnabled={webSearchGloballyEnabled}
            agents={agents}
            agentId={selectedAgentId}
            projects={projectsStore.projects as unknown as ChatProject[]}
            projectId={selectedProjectId}
            onSubmit={(payload) => void handleSubmit(payload)}
            onStop={() => {}}
            onPresetChange={setSelectedPreset}
            onAgentChange={setSelectedAgentId}
            onProjectChange={setSelectedProjectId}
            onCreateProject={() => setCreateProjectOpen(true)}
          />
        </div>
      </div>

      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("chat.project.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("chat.project.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-project-name">Name</Label>
              <Input
                id="new-project-name"
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-project-description">Description</Label>
              <Input
                id="new-project-description"
                value={newProjectDescription}
                onChange={(event) => setNewProjectDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateProjectOpen(false)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isCreatingProject || !newProjectName.trim()}
              onClick={() => void confirmCreateProject()}
            >
              {t("app.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
