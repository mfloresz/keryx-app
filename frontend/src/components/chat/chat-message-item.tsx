import * as React from "react";
import type { UIMessage } from "ai";
import {
  BotIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  GitForkIcon,
  LinkIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WrenchIcon,
} from "lucide-react";

import { Markdown } from "#/components/chat/markdown";
import { Button } from "#/components/ui/button";
import { Bubble, BubbleContent } from "#/components/ui/bubble";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
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
 * Reasoning is rendered as a collapsible Trace line: "Thinking" while it
 * streams, then the accumulated text on demand.
 */
function ReasoningPart({ text, running }: { text: string; running: boolean }) {
  // While the model is thinking the trace stays open; once it is done the
  // user decides. The key remounts the row per message so the collapsed
  // state is not shared between turns.
  const [open, setOpen] = React.useState(running);

  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <BotIcon />
      </TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
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
}: {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
}) {
  const { t } = useI18n();
  const isError = state === "output-error";
  const isDone = state === "output-available";

  return (
    <Trace>
      <TraceLine status={isError ? "error" : isDone ? undefined : "running"}>
        <TraceIcon>
          <WrenchIcon />
        </TraceIcon>
        <TraceTitle>
          {isError
            ? `${toolName} failed`
            : isDone
              ? toolName
              : `${toolName} running…`}
        </TraceTitle>
      </TraceLine>
      {output !== undefined ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceTitle>{"Result"}</TraceTitle>
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

export function ChatMessageItem({
  message,
  isStreaming,
  vote,
  onEdit,
  onRegenerate,
  onFork,
  onVote,
  onBranchChange,
}: ChatMessageItemProps) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const [copied, setCopied] = React.useState(false);

  const text = getMessageText(message);
  const reasoning = message.parts
    .filter((p) => p.type === "reasoning")
    .map((p) => ("text" in p ? p.text : ""))
    .join("");
  const tools = message.parts.filter(
    (p) => p.type === "dynamic-tool" || p.type.startsWith("tool-"),
  );
  const files = message.parts.filter((p) => p.type === "file");
  const sources = message.parts.filter(
    (p) => p.type === "source-url" || p.type === "source-document",
  );
  const branch = getBranchMetadata(message);

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
        <MessageHeader>
          <span className="text-xs text-muted-foreground">
            {isUser ? t("message.user") : t("message.ai")}
          </span>
        </MessageHeader>

        {reasoning ? (
          <ReasoningPart
            text={reasoning}
            running={Boolean(isStreaming) && !text}
          />
        ) : null}

        {tools.map((part, index) => {
          const tool = part as {
            toolCallId?: string;
            toolName?: string;
            state?: string;
            input?: unknown;
            output?: unknown;
          };
          return (
            <ToolPart
              key={tool.toolCallId ?? index}
              toolName={tool.toolName ?? "tool"}
              state={tool.state ?? "input-available"}
              input={tool.input}
              output={tool.output}
            />
          );
        })}

        {files.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {files.map((part, index) => {
              const file = part as { filename?: string; mediaType?: string };
              return (
                <li key={index}>
                  {file.filename ?? file.mediaType ?? "attachment"}
                </li>
              );
            })}
          </ul>
        ) : null}

        {text ? (
          isUser ? (
            <Bubble align="end" variant="muted">
              <BubbleContent>
                <span className="whitespace-pre-wrap">{text}</span>
              </BubbleContent>
            </Bubble>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <Markdown>{text}</Markdown>
            </div>
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
}
