import * as React from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { useI18n } from "#/i18n";
import { publishArtifact } from "#/services/artifact-service";
import { hashCode } from "#/utils/html-artifacts";

/**
 * Renders model-generated HTML inline, inside the message itself.
 *
 * The HTML is NOT injected with srcdoc/blob (those inherit the app's strict
 * CSP and get their inline <script> blocked). Instead it is published to the
 * backend, which serves it as its own network document with a relaxed CSP
 * (see internal/api/artifacts.go), and framed with a sandbox that runs
 * scripts but has no same-origin access to the app.
 */

// Module-level cache: content hash -> published network-document URL. Keeps
// remounts and repeated blocks from republishing identical HTML.
const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function publishCached(html: string): Promise<string> {
  const key = hashCode(html);
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = publishArtifact(html)
    .then((published) => {
      urlCache.set(key, published.url);
      inflight.delete(key);
      return published.url;
    })
    .catch((err: unknown) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, request);
  return request;
}

/** Returns `value` only after it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

export function InlineHtmlPreview({ html }: { html: string }) {
  const { t } = useI18n();
  const source = html.trim();
  // Wait for the fence to stop growing (streaming) before publishing, so we
  // don't POST once per token.
  const debounced = useDebouncedValue(source, 600);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    setError(null);
    setUrl(null);
    publishCached(debounced)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, reload]);

  if (!source) return null;

  return (
    <div
      className="mt-2 overflow-hidden rounded-md border bg-card"
      data-slot="inline-html-preview"
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("message.codePreview")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReload((n) => n + 1)}
          disabled={!debounced}
        >
          {t("message.reload")}
        </Button>
      </div>
      {error ? (
        <div className="flex items-start gap-2 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : url ? (
        <iframe
          title={t("message.codePreview")}
          src={url}
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          referrerPolicy="no-referrer"
          className="h-[480px] w-full border-0 bg-white"
        />
      ) : (
        <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          {t("message.previewLoading")}
        </div>
      )}
    </div>
  );
}