import * as React from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Markdown } from "#/components/chat/markdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useI18n } from "#/i18n";
import {
  fetchChatArtifact,
  publishArtifact,
} from "#/services/artifact-service";
import { isModelArtifact, useArtifactStore } from "#/stores/artifact";

/**
 * Right-hand panel that previews artifacts.
 *
 * Fenced-HTML artifacts carry their code in the message text and are
 * previewed through a sandboxed iframe pointing at a document published by
 * the backend. Model artifacts announce themselves via data-artifact parts
 * and fetch their content lazily from the backend; markdown ones render
 * through the Markdown component, HTML ones go through the same iframe.
 */
export function ArtifactPanel({ chatId }: { chatId: string }) {
  const { t } = useI18n();
  const {
    all,
    active,
    activeIndex,
    isOpen,
    tab,
    setTab,
    select,
    step,
    close,
  } = useArtifactStore();

  const [publishedUrl, setPublishedUrl] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Model artifact content, fetched lazily. `viewVersion` steps through
  // versions of the active model artifact (null = the stored version).
  const [fetchedCode, setFetchedCode] = React.useState<string | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [viewVersion, setViewVersion] = React.useState<number | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);

  const activeModel =
    active && isModelArtifact(active) ? active : null;
  const activeIsModel = activeModel !== null;
  const maxVersion = activeModel ? activeModel.version : 1;
  const effectiveVersion = activeModel
    ? (viewVersion ?? activeModel.version)
    : undefined;
  const activeType = activeModel ? activeModel.type : "html";
  // Fenced artifacts carry their code locally; model ones use the fetch result.
  const effectiveCode = active
    ? isModelArtifact(active)
      ? (fetchedCode ?? "")
      : active.code
    : "";

  // Reset the per-artifact view state when the selection changes.
  React.useEffect(() => {
    setViewVersion(null);
    setFetchedCode(null);
    setFetchError(null);
    setPublishedUrl(null);
    setPublishError(null);
  }, [active?.key]);

  // Model artifacts have no local code: fetch the content for the
  // effective version (refetches when the version selection steps).
  React.useEffect(() => {
    if (!activeIsModel || !activeModel) return;

    let cancelled = false;
    setFetching(true);
    setFetchError(null);

    fetchChatArtifact(chatId, activeModel.artifactId, effectiveVersion)
      .then((artifact) => {
        if (!cancelled) setFetchedCode(artifact.content);
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : t("artifact.fetchError"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIsModel, activeModel?.artifactId, effectiveVersion, chatId, reloadTick]);

  // Publish the HTML content (fenced or fetched) for the sandboxed iframe.
  // Markdown model artifacts render directly and never hit this effect.
  React.useEffect(() => {
    if (!isOpen || !active || activeType === "markdown") {
      setPublishedUrl(null);
      setPublishError(null);
      return;
    }
    // A model HTML artifact without content yet is still fetching.
    if (activeIsModel && !effectiveCode) return;

    let cancelled = false;
    setPublishing(true);
    setPublishError(null);
    setPublishedUrl(null);

    void publishArtifact(effectiveCode)
      .then((published) => {
        if (!cancelled) setPublishedUrl(published.url);
      })
      .catch((err) => {
        if (!cancelled) {
          setPublishError(
            err instanceof Error ? err.message : "Failed to publish preview",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPublishing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, active, activeIsModel, activeType, effectiveCode]);

  if (!isOpen) return null;

  async function handleCopy() {
    if (!active || !effectiveCode) return;
    await navigator.clipboard.writeText(effectiveCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!active || !effectiveCode) return;
    const isMarkdown = activeType === "markdown";
    const blob = new Blob([effectiveCode], {
      type: isMarkdown ? "text/markdown" : "text/html",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeIsModel
      ? `${activeModel!.artifactId}-v${effectiveVersion}.${isMarkdown ? "md" : "html"}`
      : `artifact-v${activeIndex + 1}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // Version stepping for model artifacts with more than one version.
  const hasVersions = activeIsModel && maxVersion > 1;
  const stepVersion = (delta: -1 | 1) => {
    if (!activeModel) return;
    setViewVersion((current) => {
      const from = current ?? activeModel.version;
      const next = Math.min(maxVersion, Math.max(1, from + delta));
      return next === activeModel.version ? null : next;
    });
  };

  const hasMultiple = all.length > 1;
  const isLoadingModel = activeIsModel && fetching && !fetchedCode;

  return (
    <aside
      data-slot="artifact-panel"
      className="fixed inset-0 z-50 flex flex-col bg-background lg:static lg:z-auto lg:h-full lg:w-[480px] lg:min-w-[380px] lg:max-w-[50%] lg:shrink-0 lg:border-l lg:border-border"
      aria-label={t("artifact.openPanel")}
    >
      {/* Header */}
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("artifact.previous")}
          disabled={!hasMultiple}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon />
        </Button>

        <span className="text-xs text-muted-foreground">
          {activeIndex + 1} / {all.length}
        </span>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("artifact.next")}
          disabled={!hasMultiple}
          onClick={() => step(1)}
        >
          <ChevronRightIcon />
        </Button>

        {all.length > 1 ? (
          <Select value={active?.key ?? ""} onValueChange={(v) => select(String(v))}>
            <SelectTrigger size="sm" className="ml-1 h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {all.map((artifact, index) => (
                <SelectItem key={artifact.key} value={artifact.key}>
                  {isModelArtifact(artifact) ? artifact.title : `v${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {hasVersions ? (
          <div className="ml-1 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.previousVersion")}
              disabled={effectiveVersion! <= 1}
              onClick={() => stepVersion(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="text-xs text-muted-foreground">
              v{effectiveVersion} / {maxVersion}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("artifact.nextVersion")}
              disabled={effectiveVersion! >= maxVersion}
              onClick={() => stepVersion(1)}
            >
              <ChevronRightIcon />
            </Button>
            <Select
              value={String(effectiveVersion)}
              onValueChange={(v) => {
                const num = Number(v);
                if (!Number.isFinite(num)) return;
                setViewVersion(num === maxVersion ? null : num);
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: maxVersion }, (_, i) => i + 1).map((v) => (
                  <SelectItem key={v} value={String(v)}>
                    v{v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("artifact.code")}
            aria-pressed={tab === "code"}
            onClick={() => setTab(tab === "code" ? "preview" : "code")}
          >
            <CodeIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("artifact.download")}
            disabled={!effectiveCode}
            onClick={handleDownload}
          >
            <DownloadIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("artifact.openNewTab")}
            disabled={!publishedUrl}
            onClick={() => {
              if (publishedUrl) window.open(publishedUrl, "_blank", "noopener");
            }}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("artifact.reload")}
            disabled={!active}
            onClick={() => {
              if (activeIsModel) {
                // Refetch the model artifact content.
                setFetchedCode(null);
                setReloadTick((tick) => tick + 1);
                return;
              }
              // Re-publish: bump the key so the effect runs again.
              setPublishedUrl(null);
              setPublishing(true);
              setPublishError(null);
              void publishArtifact(effectiveCode)
                .then((p) => setPublishedUrl(p.url))
                .catch(() => setPublishError(t("artifact.publishError")))
                .finally(() => setPublishing(false));
            }}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("artifact.close")}
            onClick={close}
          >
            <XIcon />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant={tab === "preview" ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setTab("preview")}
        >
          <EyeIcon className="size-3.5" />
          Preview
        </Button>
        <Button
          variant={tab === "code" ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setTab("code")}
        >
          <CodeIcon className="size-3.5" />
          Code
        </Button>
        {tab === "preview" ? (
          <Button
            variant="ghost"
            size="xs"
            className="ms-auto"
            disabled={!effectiveCode}
            onClick={() => void handleCopy()}
          >
            {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          </Button>
        ) : null}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!active ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("artifact.empty")}
          </p>
        ) : tab === "code" ? (
          <pre className="h-full overflow-auto p-3 text-xs">
            <code>{effectiveCode}</code>
          </pre>
        ) : isLoadingModel ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("artifact.loading")}
          </p>
        ) : fetchError ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-destructive">{t("artifact.fetchError")}</p>
            <Button
              size="sm"
              onClick={() => {
                setFetchError(null);
                setFetchedCode(null);
                setReloadTick((tick) => tick + 1);
              }}
            >
              {t("artifact.retry")}
            </Button>
          </div>
        ) : activeType === "markdown" ? (
          <div className="h-full max-w-none overflow-auto p-4">
            <Markdown>{effectiveCode}</Markdown>
          </div>
        ) : publishing ? (
          <p className="p-4 text-sm text-muted-foreground">
            {t("artifact.publishing")}
          </p>
        ) : publishError ? (
          <div className="space-y-3 p-4">
            <p className="text-sm text-destructive">{t("artifact.publishError")}</p>
            <Button
              size="sm"
              onClick={() => {
                setPublishError(null);
                setPublishing(true);
                void publishArtifact(effectiveCode)
                  .then((p) => setPublishedUrl(p.url))
                  .catch(() => setPublishError(t("artifact.publishError")))
                  .finally(() => setPublishing(false));
              }}
            >
              {t("artifact.retry")}
            </Button>
          </div>
        ) : publishedUrl ? (
          <iframe
            title={t("artifact.openPanel")}
            src={publishedUrl}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            referrerPolicy="no-referrer"
            className="size-full border-0 bg-white"
          />
        ) : null}
      </div>
    </aside>
  );
}
