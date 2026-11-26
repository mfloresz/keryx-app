import * as React from "react";
import {
  createFileRoute,
  useLocation,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/ai-sdk";
import type { FileUIPart, UIMessage } from "ai";
import { toast } from "sonner";

import { ArtifactPanel } from "#/components/artifacts/artifact-panel";
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
import { annotateBranchMetadata } from "#/shared/chat-core";
import { extractHtmlArtifacts, extractModelArtifacts } from "#/utils/html-artifacts";
import { useArtifactStore } from "#/stores/artifact";
import { watchChatTitle } from "#/services/title-watcher";
import {
  cancelChatStream,
  getChatStreamApi,
  getChatTransportHeaders,
} from "#/services/chat-transport";
import { respondToToolApproval } from "#/services/tool-approval";
import { KeryxChatTransport } from "#/services/keryx-chat-transport";
import { useAuth } from "#/stores/auth";
import { useChatStore } from "#/stores/chat";
import { useProjectsStore } from "#/stores/projects";
import { chatSearchSchema } from "#/routes/-search";
import { getUserFacingChatError } from "#/utils/chat-errors";
import { buildChatRequestBody } from "#/utils/chat-request";

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
  /** Branch snapshots for non-destructive regeneration. */
  branches: Record<string, unknown> | undefined;
  /** True when the server has not generated a title yet. */
  titleIsEmpty: boolean;
}

/**
 * How many trailing messages render by default; "Show earlier messages"
 * extends the window by the same amount per click.
 */
const MESSAGE_WINDOW = 30;

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
            branches: (chat.branches ?? undefined) as Record<
              string,
              unknown
            > | undefined,
            titleIsEmpty: !chat.title,
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
  const artifactStore = useArtifactStore();

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
  // Starter prompt chips fill the composer on click; the nonce makes each
  // click unique so re-clicking the same chip still re-fills the text.
  const [prefill, setPrefill] = React.useState<{
    text: string;
    nonce: number;
  } | null>(null);
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

  // The project list backs the composer's project picker. Without it the
  // picker is empty after a reload, so the attached project looks lost.
  React.useEffect(() => {
    void projectsStore.fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ---- The chat session ----
  // A page reload no longer cancels a server-side generation, so the
  // transport carries how much assistant text the rehydrated transcript
  // already contains: the reconnect then asks the backend to stream only
  // the remainder instead of replaying the full accumulated text.
  const transport = React.useMemo(() => {
    const lastLoaded = loaded.messages.at(-1);
    // The backend `since` cursor counts UTF-8 bytes (Go string length), so
    // the client must count bytes too — JS `.length` (UTF-16 code units)
    // would slice non-ASCII answers mid-character on resume.
    const resumeTextLength =
      lastLoaded?.role === "assistant"
        ? (lastLoaded.parts ?? [])
            .filter((p) => p.type === "text")
            .reduce(
              (sum, p) =>
                sum +
                ("text" in p
                  ? new TextEncoder().encode(p.text ?? "").length
                  : 0),
              0,
            )
        : 0;
    return new KeryxChatTransport({
      api: getChatStreamApi(chatId),
      headers: getChatTransportHeaders,
      resumeTextLength,
    });
  }, [chatId, loaded.messages]);

  const chat = useChat<UIMessage>({
    id: chatId,
    messages: loaded.messages,
    transport,
    // Opt-in to automatic reconnection on mount when a server-side run is
    // still streaming (the transport implements reconnectToStream).
    resume: true,
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
  const {
    messages,
    sendMessage,
    status,
    setMessages,
    clearError,
    addToolApprovalResponse,
  } = chat;

  // assistant-ui runtime over the AI SDK chat. The transport remains the
  // single streaming path; the runtime lends its cancel bookkeeping and
  // branch-aware regeneration (startRun) to the existing UI below. The
  // provider also makes assistant-ui primitives available for incremental
  // adoption in the message rows.
  const runtime = useAISDKRuntime(chat);

  const isBusy = status === "streaming" || status === "submitted";

  // The server creates branch snapshots when a message is regenerated, so
  // the branches have to be re-read after every regeneration.
  const [branches, setBranches] = React.useState(loaded.branches);
  const refreshBranches = React.useCallback(async () => {
    try {
      const repo = await chatRepository;
      const updated = await repo.getChat(chatId);
      setBranches((updated?.branches ?? undefined) as
        | Record<string, unknown>
        | undefined);
    } catch {
      // Non-fatal: the navigator simply stays hidden.
    }
  }, [chatRepository, chatId]);

  // Annotated messages carry the branch metadata the server persists for
  // non-destructive regeneration, so the navigator can be rendered.
  const annotatedMessages = React.useMemo<UIMessage[]>(() => {
    const rawMessages = messages as unknown as Array<{ id: string; parts: unknown }>;
    if (!branches) return messages;
    try {
      const annotated = annotateBranchMetadata({
        id: chatId,
        title: null,
        visibility: "private",
        createdAt: new Date().toISOString(),
        messages: rawMessages,
        votes: [],
        branches,
      } as never);
      return (annotated.messages ?? messages) as unknown as UIMessage[];
    } catch {
      return messages;
    }
  }, [messages, branches, chatId]);

  // Artifacts are derived from the message text and the data-artifact
  // parts, so they stay consistent with the transcript as it streams.
  React.useEffect(() => {
    const rawMessages =
      (annotatedMessages as unknown as Array<{ id: string; parts: unknown }>) ??
      [];
    artifactStore.syncItems(
      extractHtmlArtifacts(rawMessages),
      extractModelArtifacts(rawMessages),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotatedMessages]);

  // The server may generate the title after the stream ends; poll until it
  // lands so the sidebar stops showing "Untitled" without a reload.
  React.useEffect(() => {
    if (!loaded.titleIsEmpty) return;
    const timer = setTimeout(() => {
      watchChatTitle(
        chatId,
        () => chatStore.chats,
        chatStore.updateChat,
      );
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, loaded.titleIsEmpty]);

  // A message sent from the new-chat screen arrives through the router
  // state: the chat and its first user message already exist, so all that
  // is left is to run the stream. The state is consumed exactly once.
  const pending = location.state as
    | {
        pendingText?: string;
        pendingWebSearch?: boolean;
        pendingFiles?: unknown[];
        pendingPinnedSkills?: string[];
      }
    | undefined;
  const pendingSent = React.useRef(false);

  React.useEffect(() => {
    const text = pending?.pendingText;
    if (!text || pendingSent.current) return;
    pendingSent.current = true;

    void sendMessage(
      { text, files: (pending.pendingFiles ?? []) as never[] },
      {
        body: buildRequestBody(
          pending.pendingWebSearch ?? false,
          pending.pendingPinnedSkills ?? [],
        ),
      },
    );

    // The pending message lives in the history entry's state, which the
    // browser restores on a reload — and a fresh mount resets the ref
    // above, so the send would replay. Replacing the entry with empty
    // state consumes the message for good.
    void navigate({
      to: "/chat/$id",
      params: { id: chatId },
      search: true,
      replace: true,
      state: {},
    });
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

  // ---- Tool approvals ----
  // The backend holds the stream open while a write is pending approval.
  // Answering resumes it; the SDK then continues the model turn.
  // Stabilized with useCallback: the callback is a prop of every message
  // row, and a new identity would break ChatMessageItem's memoization on
  // every streamed token.
  const handleToolApproval = React.useCallback(
    (payload: { approvalId: string; approved: boolean }) => {
      void (async () => {
        try {
          await respondToToolApproval(chatId, payload);
          await addToolApprovalResponse({
            id: payload.approvalId,
            approved: payload.approved,
          });
        } catch (err) {
          toast.error(
            getUserFacingChatError(
              err instanceof Error ? err.message : null,
              t,
            ),
          );
        }
      })();
    },
    [chatId, addToolApprovalResponse, t],
  );

  // ---- Request body shared by submit, edit and regenerate ----
  const buildRequestBody = React.useCallback(
    (webSearch: boolean, pinnedSkills: string[] = []) =>
      buildChatRequestBody({
        preset: selectedPreset,
        webSearch,
        language: locale,
        username: userName || userEmail || "",
        agentId: selectedAgentId,
        projectId: selectedProjectId,
        pinnedSkills,
      }),
    [selectedPreset, locale, userName, userEmail, selectedAgentId, selectedProjectId],
  );

  // All handlers below are message-row props: stable identities are what
  // let React.memo skip re-rendering every message on each streamed token.
  const handleSubmit = React.useCallback(
    ({
      text,
      files,
      webSearch,
      pinnedSkills,
    }: {
      text: string;
      files: PendingAttachment[];
      webSearch: boolean;
      pinnedSkills: string[];
    }) => {
      void (async () => {
        try {
          // Files are uploaded against the chat, then referenced by storage
          // key: the transport maps the parts to attachment references and the
          // backend resolves the bytes.
          let fileParts: FileUIPart[] = [];

          if (files.length) {
            const attachmentRepo = await import(
              "#/adapters/api/api-attachment-repository"
            ).then((m) => m.apiAttachmentRepository);
            const uploaded = await attachmentRepo.persistFiles(
              chatId,
              files.map((file) => ({
                file: file.file,
                filename: file.filename,
                mediaType: file.mediaType,
                convertedMarkdown: file.convertedMarkdown,
              })),
            );
            fileParts = uploaded as typeof fileParts;
          }

          // A previous failure leaves the chat in the "error" state; clearing
          // it lets the user retry without reloading the page.
          if (status === "error") clearError();

          void sendMessage(
            { text, files: fileParts },
            { body: buildRequestBody(webSearch, pinnedSkills) },
          );
        } catch (err) {
          toast.error(
            getUserFacingChatError(
              err instanceof Error ? err.message : null,
              t,
            ),
          );
        }
      })();
    },
    [chatId, status, clearError, sendMessage, buildRequestBody, t],
  );

  const handleRegenerate = React.useCallback(
    (message: UIMessage) => {
      void (async () => {
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
        // Regenerate runs through the runtime so the replaced response is
        // recorded as a branch instead of a foreign delete. The parent (the
        // turn the response answers) is read from the runtime state — not
        // the messages prop — so the callback identity stays stable across
        // streamed tokens. The request config travels as runConfig, which
        // the transport picks up from metadata.
        const threadMessages = runtime.thread.getState().messages;
        const index = threadMessages.findIndex((m) => m.id === message.id);
        const parentId = index > 0 ? threadMessages[index - 1]!.id : null;
        runtime.thread.startRun({
          parentId,
          runConfig: { custom: buildRequestBody(false) },
        });
        // The branch snapshot is written server-side; pick it up once the
        // regeneration has settled.
        setTimeout(() => void refreshBranches(), 800);
      })();
    },
    [chatRepository, chatId, t, buildRequestBody, refreshBranches, runtime],
  );

  const handleEdit = React.useCallback((message: UIMessage) => {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("");
    setEditMessage(message);
    setEditText(text);
  }, []);

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

  const loadVotes = React.useCallback(async () => {
    try {
      const repo = await chatRepository;
      const voteList = await repo.getVotes(chatId);
      setVotes(
        voteList.reduce<Record<string, boolean | null>>((acc, v) => {
          acc[v.messageId] = v.isUpvoted;
          return acc;
        }, {}),
      );
    } catch {
      // Vote load failures are non-fatal.
    }
  }, [chatRepository, chatId]);

  const handleBranchChange = React.useCallback(
    (payload: { rootMessageId: string; snapshotId: string }) => {
      void (async () => {
        try {
          const repo = await chatRepository;
          const updated = await repo.switchBranch(chatId, payload);
          setMessages((updated.messages ?? []) as unknown as UIMessage[]);
          // The active snapshot moved, so the navigator has to follow.
          setBranches((updated?.branches ?? undefined) as
            | Record<string, unknown>
            | undefined);
          await loadVotes();
        } catch {
          toast.error(t("chat.failedSwitchBranch"));
        }
      })();
    },
    [chatRepository, chatId, setMessages, loadVotes, t],
  );

  const handleFork = React.useCallback(
    (message: UIMessage) => {
      void (async () => {
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
      })();
    },
    [chatRepository, chatId, chatStore, navigate, t],
  );

  const handleVote = React.useCallback(
    (message: UIMessage, isUpvoted: boolean) => {
      void (async () => {
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
      })();
    },
    [chatRepository, chatId],
  );

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

  // Starter prompt chips: only when the selected agent suggests them and
  // the conversation is still empty. Clicking fills the composer.
  const selectedAgent =
    agents.find((a) => a.id === selectedAgentId) ?? null;
  const starterPrompts =
    messages.length === 0
      ? (selectedAgent?.starterPrompts ?? []).filter(Boolean)
      : [];

  // ChatGPT-style windowing: only the last WINDOW_STEP messages render.
  // Long transcripts would otherwise mount every markdown document at once.
  // The route remounts on chat switch, so the window needs no reset.
  const [visibleCount, setVisibleCount] = React.useState(MESSAGE_WINDOW);
  const visibleMessages = React.useMemo(
    () => annotatedMessages.slice(-visibleCount),
    [annotatedMessages, visibleCount],
  );
  const hiddenCount = annotatedMessages.length - visibleMessages.length;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Thread and composer */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
              {hiddenCount > 0 ? (
                <MessageScrollerItem messageId="show-earlier">
                  <Button
                    variant="outline"
                    size="sm"
                    className="mx-auto"
                    onClick={() => setVisibleCount((count) => count + MESSAGE_WINDOW)}
                  >
                    {t("chat.showEarlier")}
                  </Button>
                </MessageScrollerItem>
              ) : null}

              {starterPrompts.length > 0 ? (
                <MessageScrollerItem messageId="starter-prompts">
                  <div className="flex flex-wrap justify-center gap-2">
                    {starterPrompts.map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPrefill((current) => ({
                            text: prompt,
                            nonce: (current?.nonce ?? 0) + 1,
                          }))
                        }
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </MessageScrollerItem>
              ) : null}

              {visibleMessages.map((message) => (
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
                    onEdit={handleEdit}
                    onRegenerate={handleRegenerate}
                    onFork={handleFork}
                    onVote={handleVote}
                    onBranchChange={handleBranchChange}
                    onToolApproval={handleToolApproval}
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
        prefill={prefill}
        onSubmit={handleSubmit}
        onStop={() => {
          // Server-side cancel first (the local abort only stops the UI);
          // the runtime's cancelRun performs the local abort plus the
          // cancelled-message bookkeeping.
          void cancelChatStream(chatId);
          runtime.thread.cancelRun();
        }}
        onPresetChange={setSelectedPreset}
        onAgentChange={setSelectedAgentId}
        onProjectChange={setSelectedProjectId}
        onCreateProject={() => setCreateProjectOpen(true)}
      />
      </div>

      {/* The artifact panel sits beside the thread on wide screens. */}
      <ArtifactPanel chatId={chatId} />

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
    </AssistantRuntimeProvider>
  );
}
