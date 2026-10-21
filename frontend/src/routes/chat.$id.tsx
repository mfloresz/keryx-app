import * as React from "react";
import {
  createFileRoute,
  useLocation,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { toast } from "sonner";

import { ChatMessageItem } from "#/components/chat/chat-message-item";
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
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "#/components/ui/message-scroller";
import { Spinner } from "#/components/ui/spinner";
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "#/components/ui/trace";
import { useI18n } from "#/i18n";
import { getChatRepository, getAuthAdapter } from "#/services/runtime";
import { getChatStreamApi, getChatTransportHeaders } from "#/services/chat-transport";
import { KeryxChatTransport } from "#/services/keryx-chat-transport";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";
import { useProjectsStore } from "#/stores/projects";
import { chatSearchSchema } from "#/routes/-search";
import { getUserFacingChatError } from "#/utils/chat-errors";

export const Route = createFileRoute("/chat/$id")({
  validateSearch: chatSearchSchema,
  component: ChatPage,
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

interface LoadedChat {
  messages: UIMessage[];
  preset: string | null;
  agentId: string | null;
  projectId: string | null;
  votes: Record<string, boolean | null>;
}

/**
 * Outer component: resolves the chat before the conversation mounts.
 *
 * `useChat` takes its transcript as an initial value, so the messages have
 * to be in hand before it is created — otherwise the first render starts
 * from an empty thread and the hydration races the stream.
 */
function ChatPage() {
  const { id: chatId } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const chatRepository = React.useMemo(() => getChatRepository(), []);

  const [loaded, setLoaded] = React.useState<LoadedChat | null>(null);
  const [isLoadingChat, setIsLoadingChat] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Reset inside the async body: setting state synchronously in an
      // effect triggers a cascading render.
      setIsLoadingChat(true);
      setLoadError(null);
      try {
        const repo = await chatRepository;
        const chat = await repo.getChat(chatId);
        if (cancelled) return;
        if (!chat) throw new Error("Chat not found");

        let votes: Record<string, boolean | null> = {};
        try {
          const voteList = await repo.getVotes(chatId);
          votes = voteList.reduce<Record<string, boolean | null>>(
            (acc, v) => {
              acc[v.messageId] = v.isUpvoted;
              return acc;
            },
            {},
          );
        } catch {
          // Vote load failures are non-fatal.
        }

        if (!cancelled) {
          setLoaded({
            messages: (chat.messages ?? []) as unknown as UIMessage[],
            preset: chat.preset ?? null,
            agentId: chat.agentId ?? null,
            projectId: chat.projectId ?? null,
            votes,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error
              ? getUserFacingChatError(err.message, t)
              : t("chat.errors.unexpected"),
          );
        }
      } finally {
        if (!cancelled) setIsLoadingChat(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, chatRepository, t]);

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h2 className="font-heading text-lg font-semibold">
            {t("chat.notFoundTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button className="mt-4" onClick={() => void navigate({ to: "/" })}>
            {t("chat.startNewChat")}
          </Button>
        </div>
      </div>
    );
  }

  if (isLoadingChat || !loaded) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner />
      </div>
    );
  }

  return <ChatConversation chatId={chatId} loaded={loaded} />;
}

function ChatConversation({
  chatId,
  loaded,
}: {
  chatId: string;
  loaded: LoadedChat;
}) {
  const search = useSearch({ from: "/chat/$id" });
  const location = useLocation();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { userName, userEmail } = useAuth();
  const chatStore = useChatStore();
  const projectsStore = useProjectsStore();

  const [presets, setPresets] = React.useState<ModelPreset[]>([]);
  const [agents, setAgents] = React.useState<ChatAgent[]>([]);
  const [webSearchGloballyEnabled, setWebSearchGloballyEnabled] =
    React.useState(false);
  // The URL wins over the persisted value on a fresh navigation; the
  // watchers persist the selection whenever it differs from the stored one.
  const [selectedPreset, setSelectedPreset] = React.useState(
    search.preset ?? loaded.preset ?? "fast",
  );
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(
    search.agentId ?? loaded.agentId,
  );
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(
    search.projectId ?? loaded.projectId,
  );
  const [votes, setVotes] = React.useState<Record<string, boolean | null>>(
    loaded.votes,
  );

  const [editMessage, setEditMessage] = React.useState<UIMessage | null>(null);
  const [editText, setEditText] = React.useState("");
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState("");
  const [newProjectDescription, setNewProjectDescription] = React.useState("");
  const [isCreatingProject, setIsCreatingProject] = React.useState(false);

  const chatRepository = React.useMemo(
    () => getChatRepository(),
    [],
  );

  // ---- Load presets, agents, and the web-search toggle ----
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


  // ---- The chat session ----
  const transport = React.useMemo(
    () =>
      new KeryxChatTransport({
        api: getChatStreamApi(chatId),
        headers: getChatTransportHeaders,
      }),
    [chatId],
  );

  const { messages, sendMessage, regenerate, status, stop } =
    useChat<UIMessage>({
      id: chatId,
      messages: loaded.messages,
      transport,
      onError(error) {
        let message = error.message;
        if (typeof message === "string" && message[0] === "{") {
          try {
            message = JSON.parse(message).message || message;
          } catch {
            // Keep the original message.
          }
        }
        toast.error(getUserFacingChatError(message, t));
      },
    });

  const isBusy = status === "streaming" || status === "submitted";

  // A message sent from the new-chat screen arrives through the router
  // state: the chat and its first user message already exist, so all that
  // is left is to run the stream. The state is consumed exactly once.
  const pending = location.state as
    | {
        pendingText?: string;
        pendingWebSearch?: boolean;
        pendingFiles?: unknown[];
      }
    | undefined;
  const pendingSent = React.useRef(false);

  React.useEffect(() => {
    const text = pending?.pendingText;
    if (!text || pendingSent.current) return;
    pendingSent.current = true;

    void sendMessage(
      { text, files: (pending.pendingFiles ?? []) as never[] },
      { body: buildRequestBody(pending.pendingWebSearch ?? false) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.pendingText]);


  // Refresh the title and usage after a stream completes, without
  // re-hydrating the conversation (which would make it flicker).
  const previousStatus = React.useRef(status);
  React.useEffect(() => {
    const wasBusy =
      previousStatus.current === "streaming" ||
      previousStatus.current === "submitted";
    previousStatus.current = status;
    if (!wasBusy || status !== "ready") return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const repo = await chatRepository;
          const updated = await repo.getChat(chatId);
          if (updated) {
            chatStore.updateChat(chatId, {
              label: updated.title || "Untitled",
            });
          }
        } catch {
          // Ignore refresh errors after streaming.
        }
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [status, chatId, chatRepository, chatStore]);

  // ---- Persistence of the per-chat selectors ----
  React.useEffect(() => {
    if (!selectedAgentId) return;
    void (async () => {
      try {
        const repo = await chatRepository;
        await repo.updateAgent(chatId, selectedAgentId);
      } catch {
        // Non-fatal: the selection stays local for this session.
      }
    })();
  }, [selectedAgentId, chatId, chatRepository]);

  React.useEffect(() => {
    void (async () => {
      try {
        const repo = await chatRepository;
        await repo.updatePreset(chatId, selectedPreset);
      } catch {
        // Non-fatal: the selection stays local for this session.
      }
    })();
  }, [selectedPreset, chatId, chatRepository]);

  React.useEffect(() => {
    void (async () => {
      try {
        const repo = await chatRepository;
        await repo.updateProject(chatId, selectedProjectId);
      } catch {
        // Non-fatal: the selection stays local for this session.
      }
    })();
  }, [selectedProjectId, chatId, chatRepository]);

  // ---- Request body shared by submit, edit and regenerate ----
  const buildRequestBody = React.useCallback(
    (webSearch: boolean) => ({
      preset: selectedPreset,
      webSearch,
      language: locale,
      // Dynamic user context the backend injects into its system prompt.
      username: userName || userEmail || "",
      datetime: new Date().toISOString(),
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      ...(selectedAgentId ? { agentId: selectedAgentId } : {}),
      ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
    }),
    [selectedPreset, locale, userName, userEmail, selectedAgentId, selectedProjectId],
  );

  async function handleSubmit({
    text,
    files,
    webSearch,
  }: {
    text: string;
    files: PendingAttachment[];
    webSearch: boolean;
  }) {
    try {
      // Files travel as file parts; the transport maps them to attachment
      // references and the backend resolves the bytes.
      const fileParts = files.map((file) => ({
        type: "file" as const,
        filename: file.filename,
        mediaType: file.mediaType,
        url: "",
      }));

      void sendMessage(
        { text, files: fileParts },
        { body: buildRequestBody(webSearch) },
      );
    } catch (err) {
      toast.error(
        getUserFacingChatError(
          err instanceof Error ? err.message : null,
          t,
        ),
      );
    }
  }

  async function handleRegenerate(message: UIMessage) {
    try {
      const repo = await chatRepository;
      await repo.deleteMessage(chatId, {
        messageId: message.id,
        type: "regenerate",
      });
    } catch {
      toast.error(t("chat.failedRegenerate"));
      return;
    }
    void regenerate({
      messageId: message.id,
      body: buildRequestBody(false),
    });
  }

  async function handleEdit(message: UIMessage) {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("");
    setEditMessage(message);
    setEditText(text);
  }

  async function confirmEdit() {
    if (!editMessage) return;
    const text = editText.trim();
    if (!text || text.length > 10000) return;

    try {
      const repo = await chatRepository;
      await repo.deleteMessage(chatId, {
        messageId: editMessage.id,
        type: "edit",
      });
    } catch {
      toast.error(t("chat.failedEdit"));
      return;
    }

    setEditMessage(null);
    void sendMessage(
      { text, messageId: editMessage.id },
      { body: buildRequestBody(false) },
    );
  }

  async function handleFork(message: UIMessage) {
    try {
      const repo = await chatRepository;
      const newChat = await repo.forkChat(chatId, message.id);
      chatStore.addChat({
        id: newChat.id,
        label: newChat.title || "Untitled",
        to: `/chat/${newChat.id}`,
        createdAt: newChat.createdAt || new Date().toISOString(),
      });
      void navigate({ to: "/chat/$id", params: { id: newChat.id } });
    } catch {
      toast.error(t("chat.failedFork"));
    }
  }

  async function handleVote(message: UIMessage, isUpvoted: boolean) {
    try {
      const repo = await chatRepository;
      await repo.saveVote(chatId, {
        messageId: message.id,
        isUpvoted,
      });
      setVotes((current) => ({ ...current, [message.id]: isUpvoted }));
    } catch {
      // Vote failures are non-fatal.
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

  const lastMessage = messages.at(-1);
  const showThinking =
    isBusy && lastMessage?.role === "assistant" && !lastMessage.parts?.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessageItem
                    message={message}
                    isStreaming={
                      isBusy && message.id === lastMessage?.id
                    }
                    vote={votes[message.id] ?? null}
                    onEdit={(message) => void handleEdit(message)}
                    onRegenerate={(message) => void handleRegenerate(message)}
                    onFork={(message) => void handleFork(message)}
                    onVote={(message, upvoted) => void handleVote(message, upvoted)}
                  />
                </MessageScrollerItem>
              ))}

              {showThinking ? (
                <MessageScrollerItem messageId="thinking">
                  <Trace>
                    <TraceLine status="running">
                      <TraceIcon>
                        <Spinner />
                      </TraceIcon>
                      <TraceTitle>{t("chat.thinking")}</TraceTitle>
                    </TraceLine>
                  </Trace>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
            <MessageScrollerButton />
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>

      <ChatPromptInput
        status={status}
        preset={selectedPreset}
        presets={presets}
        webSearchGloballyEnabled={webSearchGloballyEnabled}
        agents={agents}
        agentId={selectedAgentId}
        projects={projectsStore.projects as unknown as ChatProject[]}
        projectId={selectedProjectId}
        onSubmit={(payload) => void handleSubmit(payload)}
        onStop={() => void stop()}
        onPresetChange={setSelectedPreset}
        onAgentChange={setSelectedAgentId}
        onProjectChange={setSelectedProjectId}
        onCreateProject={() => setCreateProjectOpen(true)}
      />

      {/* Edit message */}
      <Dialog
        open={editMessage !== null}
        onOpenChange={(open) => !open && setEditMessage(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("message.edit")}</DialogTitle>
            <DialogDescription>
              {t("message.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            rows={6}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMessage(null)}>
              {t("app.cancel")}
            </Button>
            <Button onClick={() => void confirmEdit()}>{t("app.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create project */}
      <Dialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
      >
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
                onChange={(event) =>
                  setNewProjectDescription(event.target.value)
                }
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
