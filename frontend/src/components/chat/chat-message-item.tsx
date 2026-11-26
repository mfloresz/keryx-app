import * as React from "react";
import { getToolName, type UIMessage } from "ai";
import {
  BotIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GitForkIcon,
  LinkIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WrenchIcon,
} from "lucide-react";

import { Markdown } from "#/components/chat/markdown";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "#/components/ui/attachment";
import { Button } from "#/components/ui/button";
import { Bubble, BubbleContent } from "#/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
} from "#/components/ui/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "#/components/ui/trace";
import { useI18n } from "#/i18n";
import {
  ensureAttachmentResolved,
  resolvedAttachmentUrl,
} from "#/utils/attachment-url";

export interface ChatMessageItemProps {
  message: UIMessage;
  isStreaming?: boolean;
  vote?: boolean | null;
  onEdit?: (message: UIMessage) => void;
  onRegenerate?: (message: UIMessage) => void;
  onFork?: (message: UIMessage) => void;
  onVote?: (message: UIMessage, isUpvoted: boolean) => void;
  onBranchChange?: (payload: {
    rootMessageId: string;
    snapshotId: string;
  }) => void;
  onToolApproval?: (payload: {
    approvalId: string;
    approved: boolean;
  }) => void;
}

/** Branch metadata attached by the server for non-destructive regeneration. */
interface BranchMetadata {
  rootMessageId: string;
  currentSnapshotId: string;
  currentIndex: number;
  snapshotCount: number;
  snapshots: Array<{ id: string; label: string; createdAt: string }>;
}

function getBranchMetadata(message: UIMessage): BranchMetadata | null {
  const metadata = (message as { metadata?: { keryxBranch?: BranchMetadata } })
    .metadata;
  const branch = metadata?.keryxBranch;
  if (!branch || branch.snapshotCount <= 1) return null;
  return branch;
}

function getMessageText(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => ("text" in p ? p.text : ""))
    .join("");
}

/**
 * Delay before a finished reasoning block folds itself away.
 */
const AUTO_COLLAPSE_DELAY = 1000;

/**
 * Reads the tool name from a tool part.
 *
 * The SDK stores live tool calls as static parts ("tool-read_file"), where
 * the name lives in the type, and persisted calls as dynamic parts, where
 * it lives in the toolName field. The SDK helper covers both shapes.
 */
function readToolName(part: unknown): string {
  const tool = part as Parameters<typeof getToolName>[0];
  try {
    return getToolName(tool);
  } catch {
    return "tool";
  }
}

/**
 * Reasoning is rendered as a collapsible Trace line: "Thinking" while it
 * streams, then the accumulated text on demand.
 *
 * The block auto-collapses a moment after the model stops thinking, so a
 * finished answer is not buried under the reasoning that produced it.
 */
function ReasoningPart({ text, running }: { text: string; running: boolean }) {
  const { t } = useI18n();
  // While the model is thinking the trace stays open; once it is done it
  // folds away on its own and the user can reopen it.
  const [open, setOpen] = React.useState(running);
  const wasRunning = React.useRef(running);

  React.useEffect(() => {
    if (wasRunning.current && !running) {
      const timer = setTimeout(() => setOpen(false), AUTO_COLLAPSE_DELAY);
      wasRunning.current = false;
      return () => clearTimeout(timer);
    }
    wasRunning.current = running;
  }, [running]);

  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <BotIcon />
      </TraceIcon>
      <TraceTitle>{running ? t("chat.thinking") : t("message.thought")}</TraceTitle>
    </TraceLine>
  );

  if (!text) return line;

  return (
    <TraceCollapsible open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap text-sm text-muted-foreground">
        {text}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function ToolPart({
  toolName,
  state,
  input,
  output,
  approval,
  onApproval,
}: {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  approval?: {
    id: string;
    approved?: boolean;
    requestReason?: string;
  };
  onApproval?: (payload: {
    approvalId: string;
    approved: boolean;
  }) => void;
}) {
  const { t } = useI18n();
  const isError = state === "output-error";
  const isDone = state === "output-available";
  // The tool is waiting for the user to approve it.
  const needsApproval = state === "approval-requested" && !approval?.approved;
  // The user refused: the SDK records the refusal on the approval, so the
  // state can be "approval-responded" or already carry the denial output.
  const wasDenied = approval?.approved === false;

  return (
    <Trace>
      <TraceLine
        status={isError ? "error" : isDone || wasDenied ? undefined : "running"}
      >
        <TraceIcon>
          <WrenchIcon />
        </TraceIcon>
        <TraceTitle>
          {needsApproval
            ? t("chat.tools.awaitingApproval", { name: toolName })
            : wasDenied
              ? t("chat.tools.denied", { name: toolName })
              : isError
                ? t("chat.tools.failed", { name: toolName })
                : isDone
                  ? toolName
                  : t("chat.tools.running", { name: toolName })}
        </TraceTitle>
      </TraceLine>

      {needsApproval ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {approval?.requestReason ??
              t("chat.tools.approvalDescription", { name: toolName })}
          </p>
          <div className="ms-auto flex items-center gap-1">
            <Button
              size="xs"
              onClick={() =>
                onApproval?.({ approvalId: approval!.id, approved: true })
              }
            >
              {t("chat.tools.approve")}
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                onApproval?.({ approvalId: approval!.id, approved: false })
              }
            >
              {t("chat.tools.deny")}
            </Button>
          </div>
        </div>
      ) : null}

      {output !== undefined ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>{t("chat.tools.result")}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <pre className="overflow-x-auto text-xs">
              {typeof output === "string"
                ? output
                : JSON.stringify(output, null, 2)}
            </pre>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : null}
      {input !== undefined && output === undefined ? (
        <pre className="overflow-x-auto text-xs text-muted-foreground">
          {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
        </pre>
      ) : null}
      <span className="sr-only">{t("chat.tools.label")}</span>
    </Trace>
  );
}

function SourcesList({
  sources,
}: {
  sources: Array<{ key: string; title: string; url?: string }>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="text-xs">
      <Button
        variant="ghost"
        size="xs"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <LinkIcon className="size-3.5" />
        {sources.length}
        {t("message.sources")}
      </Button>
      {open ? (
        <ul className="mt-1 space-y-1 ps-6">
          {sources.map((source) => (
            <li key={source.key}>
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-4"
                >
                  {source.title}
                </a>
              ) : (
                <span>{source.title}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const ChatMessageItem = React.memo(function ChatMessageItem({
  message,
  isStreaming,
  vote,
  onEdit,
  onRegenerate,
  onFork,
  onVote,
  onBranchChange,
  onToolApproval,
}: ChatMessageItemProps) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const [copied, setCopied] = React.useState(false);

  const text = getMessageText(message);
  // Reasoning blocks are kept apart: the model can think, call a tool and
  // then think again, and each block is its own collapsible row.
  const reasoningBlocks = message.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => ("text" in p ? (p.text ?? "") : ""))
    .filter((t) => t.trim().length > 0);
  const tools = message.parts.filter(
    (p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"),
  );
  const files = message.parts.filter((p) => p.type === "file");
  const sources = message.parts.filter(
    (p) => p.type === "source-url" || p.type === "source-document",
  );
  const branch = getBranchMetadata(message);

  // Parsing markdown is the expensive part of rendering a message. Memoizing
  // on the text lets renders with identical text (reasoning-only updates,
  // vote changes, sibling streaming) skip the re-parse entirely.
  const renderedMarkdown = React.useMemo(
    () => (
      <Markdown streaming={Boolean(isStreaming)}>{text}</Markdown>
    ),
    [text, isStreaming],
  );

  async function handleCopy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Message align={isUser ? "end" : "start"}>
      {!isUser ? (
        <MessageAvatar>
          <BotIcon className="size-4" />
        </MessageAvatar>
      ) : null}

      <MessageContent>
        {reasoningBlocks.map((block, index) => (
          <ReasoningPart
            key={`reasoning-${index}`}
            text={block}
            running={Boolean(isStreaming) && !text && index === reasoningBlocks.length - 1}
          />
        ))}

        {tools.map((part, index) => {
          const tool = part as {
            toolCallId?: string;
            toolName?: string;
            state?: string;
            input?: unknown;
            output?: unknown;
            approval?: {
              id: string;
              approved?: boolean;
              requestReason?: string;
            };
          };
          return (
            <ToolPart
              key={tool.toolCallId ?? index}
              toolName={readToolName(part)}
              state={tool.state ?? "input-available"}
              input={tool.input}
              output={tool.output}
              approval={tool.approval}
              onApproval={onToolApproval}
            />
          );
        })}

        {files.length > 0 ? (
          <AttachmentGroup>
            {files.map((part, index) => {
              const file = part as {
                url?: string;
                filename?: string;
                mediaType?: string;
              };
              const url = file.url;
              const isImage = (file.mediaType ?? "").startsWith("image/");
              // Backend attachments need the auth header, so the bytes are
              // fetched into an object URL for the preview to render.
              ensureAttachmentResolved(url);
              const previewUrl = resolvedAttachmentUrl(url) ?? url;

              return (
                <Attachment
                  key={index}
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => {
                    if (previewUrl) {
                      window.open(previewUrl, "_blank", "noopener");
                    }
                  }}
                >
                  <AttachmentMedia variant={isImage ? "image" : "icon"}>
                    {isImage && previewUrl ? (
                      <img src={previewUrl} alt={file.filename ?? ""} />
                    ) : (
                      <PaperclipIcon />
                    )}
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>
                      {file.filename ?? file.mediaType ?? "attachment"}
                    </AttachmentTitle>
                    <AttachmentDescription>
                      {file.mediaType ?? ""}
                    </AttachmentDescription>
                  </AttachmentContent>
                </Attachment>
              );
            })}
          </AttachmentGroup>
        ) : null}

        {text ? (
          isUser ? (
            <Bubble align="end" variant="muted">
              <BubbleContent>
                <span className="whitespace-pre-wrap">{text}</span>
              </BubbleContent>
            </Bubble>
          ) : (
            <div className="max-w-none">{renderedMarkdown}</div>
          )
        ) : null}

        {sources.length > 0 ? (
          <SourcesList
            sources={sources.map((part) => {
              const source = part as {
                type: string;
                sourceId: string;
                url?: string;
                title?: string;
                mediaType?: string;
                filename?: string;
              };
              return {
                key: source.sourceId,
                title: source.title ?? source.filename ?? source.sourceId,
                url: source.url,
              };
            })}
          />
        ) : null}

        {branch ? (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("message.previousBranch")}
              onClick={() => {
                const count = branch.snapshotCount;
                const next =
                  (branch.currentIndex - 1 + count) % count;
                const target = branch.snapshots[next];
                if (target) {
                  onBranchChange?.({
                    rootMessageId: branch.rootMessageId,
                    snapshotId: target.id,
                  });
                }
              }}
            >
              <ChevronLeftIcon />
            </Button>
            <span>
              {branch.currentIndex + 1} of {branch.snapshotCount}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("message.nextBranch")}
              onClick={() => {
                const count = branch.snapshotCount;
                const next = (branch.currentIndex + 1) % count;
                const target = branch.snapshots[next];
                if (target) {
                  onBranchChange?.({
                    rootMessageId: branch.rootMessageId,
                    snapshotId: target.id,
                  });
                }
              }}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : null}

        {!isUser ? (
          <MessageFooter>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("message.copy")}
              onClick={() => void handleCopy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
            {onRegenerate ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("message.regenerate")}
                onClick={() => onRegenerate(message)}
              >
                <RefreshCwIcon />
              </Button>
            ) : null}
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("message.edit")}
                onClick={() => onEdit(message)}
              >
                <PencilIcon />
              </Button>
            ) : null}
            {onFork ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("message.fork")}
                onClick={() => onFork(message)}
              >
                <GitForkIcon />
              </Button>
            ) : null}
            {onVote ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("message.goodResponse")}
                  aria-pressed={vote === true}
                  className={vote === true ? "text-primary" : undefined}
                  onClick={() => onVote(message, true)}
                >
                  <ThumbsUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("message.badResponse")}
                  aria-pressed={vote === false}
                  className={vote === false ? "text-destructive" : undefined}
                  onClick={() => onVote(message, false)}
                >
                  <ThumbsDownIcon />
                </Button>
              </>
            ) : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
});
