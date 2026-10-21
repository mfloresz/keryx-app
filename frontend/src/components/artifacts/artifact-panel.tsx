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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useI18n } from "#/i18n";
import { publishArtifact } from "#/services/artifact-service";
import { useArtifactStore } from "#/stores/artifact";

/**
 * Right-hand panel that previews HTML artifacts.
 *
 * The preview runs in a sandboxed iframe pointing at a document published
 * by the backend, so the artifact's scripts execute without access to the
 * parent's origin.
 */
export function ArtifactPanel() {
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

  // Publish whenever the active artifact changes.
  React.useEffect(() => {
    if (!isOpen || !active) {
      setPublishedUrl(null);
      setPublishError(null);
      return;
    }

    let cancelled = false;
    setPublishing(true);
    setPublishError(null);
    setPublishedUrl(null);

    void publishArtifact(active.code)
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
  }, [isOpen, active]);

  if (!isOpen) return null;

  async function handleCopy() {
    if (!active) return;
    await navigator.clipboard.writeText(active.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!active) return;
    const blob = new Blob([active.code], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `artifact-v${activeIndex + 1}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasMultiple = all.length > 1;

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
                  v{index + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              // Re-publish: bump the key so the effect runs again.
              setPublishedUrl(null);
              setPublishing(true);
              setPublishError(null);
              void publishArtifact(active!.code)
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
            <code>{active.code}</code>
          </pre>
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
                void publishArtifact(active.code)
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
