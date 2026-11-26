import { createFileRoute } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import * as React from "react";

import { ChatMessageItem } from "#/components/chat/chat-message-item";
import { Spinner } from "#/components/ui/spinner";
import type { PublicChatRecord } from "#/domain/chat/types";
import { useI18n } from "#/i18n";
import { getChatRepository } from "#/services/runtime";

export const Route = createFileRoute("/share/$id")({
  component: SharedChatPage,
});

const ATTACHMENT_API_PREFIX = "/api/attachments/";

/**
 * Rewrites stored attachment URLs (/api/attachments/{id}, which require auth)
 * to the public, unauthenticated endpoint so images in a shared chat load for
 * visitors without a session.
 */
function rewriteAttachmentUrls(
  messages: UIMessage[],
  chatId: string,
): UIMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.parts)) return message;
    const parts = message.parts.map((part) => {
      const filePart = part as { type?: string; url?: string };
      if (filePart.type !== "file" || typeof filePart.url !== "string") {
        return part;
      }
      if (!filePart.url.startsWith(ATTACHMENT_API_PREFIX)) return part;
      const attachmentId = filePart.url.slice(ATTACHMENT_API_PREFIX.length);
      return {
        ...part,
        url: `/api/public/chats/${chatId}/attachments/${attachmentId}`,
      };
    });
    return { ...message, parts } as UIMessage;
  });
}

function SharedChatPage() {
  const { id: chatId } = Route.useParams();
  const { t } = useI18n();

  const [chat, setChat] = React.useState<PublicChatRecord | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const repo = await getChatRepository();
        const record = await repo.getPublicChat(chatId);
        if (cancelled) return;
        if (!record) {
          setError(t("share.notFound"));
          return;
        }
        setChat(record);
      } catch {
        if (!cancelled) setError(t("share.loadError"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, t]);

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !chat) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {error ?? t("share.notFound")}
        </p>
        <a
          href="/"
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
        >
          {t("app.name")}
        </a>
      </div>
    );
  }

  const messages = rewriteAttachmentUrls(
    (chat.messages ?? []) as UIMessage[],
    chatId,
  );

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("share.badge")}
          </span>
          <span className="truncate text-sm font-medium">
            {chat.title || t("share.untitled")}
          </span>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
