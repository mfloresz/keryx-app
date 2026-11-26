import * as React from "react";
import {
  CodeBlock,
  Markdown as FlowdownMarkdown,
  childrenToText,
  getLanguage,
  type Components,
  type LabelOverrides,
} from "@localix-ai/flowdown";
import { highlight } from "@localix-ai/flowdown/highlight";
import { EyeIcon } from "lucide-react";

import { Button } from "#/components/ui/button";
import { useI18n } from "#/i18n";
import { useArtifactStore } from "#/stores/artifact";

/**
 * Math is a stage of its own, fetched the first time a reply holds a formula.
 * The loader is module-level so its reference is stable across renders.
 */
const loadMath = () => import("@localix-ai/flowdown/math");

/**
 * Fenced code with the app's own HTML-preview action.
 *
 * flowdown draws the block (language, download, copy, highlighting); an
 * `html` fence additionally gets a button that opens the isolated preview
 * from the artifacts panel. The button sits under the block so it never
 * collides with the built-in actions.
 */
function MarkdownPre(props: React.ComponentProps<"pre"> & { node?: unknown }) {
  const { children } = props;
  const { t } = useI18n();
  const { openFromCodeBlock } = useArtifactStore();

  const child = React.Children.toArray(children)[0];
  const code = React.isValidElement<{
    className?: string;
    children?: React.ReactNode;
  }>(child)
    ? child
    : null;
  const language = getLanguage(code?.props.className);
  const source = code ? childrenToText(code.props.children) : "";

  return (
    <div className="my-3">
      <CodeBlock {...props} />
      {language === "html" && source.trim() ? (
        <div className="mt-1 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("message.preview")}
            title={t("message.preview")}
            onClick={() => openFromCodeBlock(source)}
          >
            <EyeIcon />
            {t("message.preview")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MarkdownLink({
  node: _node,
  children,
  href,
  ...props
}: React.ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium underline underline-offset-4"
      {...props}
    >
      {children}
    </a>
  );
}

/** Kept module-level: a new map on every render re-renders every block. */
const components: Components = {
  pre: MarkdownPre,
  a: MarkdownLink,
};

export interface MarkdownProps {
  children: string;
  /** The text is still arriving: complete its unfinished end and show a caret. */
  streaming?: boolean;
}

export function Markdown({ children, streaming = false }: MarkdownProps) {
  const { t } = useI18n();

  const labels = React.useMemo<LabelOverrides>(
    () => ({
      callouts: {
        note: t("markdown.callouts.note"),
        tip: t("markdown.callouts.tip"),
        important: t("markdown.callouts.important"),
        warning: t("markdown.callouts.warning"),
        caution: t("markdown.callouts.caution"),
      },
      variants: t("markdown.variants"),
      fileTree: t("markdown.fileTree"),
      scrollableTable: t("markdown.scrollableTable"),
      scrollableCode: t("markdown.scrollableCode"),
      taskDone: t("markdown.taskDone"),
      taskOpen: t("markdown.taskOpen"),
      diagram: t("markdown.diagram"),
      drawingDiagram: t("markdown.drawingDiagram"),
      diagramFailed: (reason) => t("markdown.diagramFailed", { reason }),
      enlarge: t("markdown.enlarge"),
      showSource: t("markdown.showSource"),
      showDiagram: t("markdown.showDiagram"),
      copySource: t("markdown.copySource"),
      downloadSvg: t("markdown.downloadSvg"),
      zoomIn: t("markdown.zoomIn"),
      zoomOut: t("markdown.zoomOut"),
      fit: t("markdown.fit"),
      actualSize: t("markdown.actualSize"),
      close: t("markdown.close"),
      copy: t("markdown.copy"),
      copied: t("markdown.copied"),
      download: t("markdown.download"),
    }),
    [t],
  );

  return (
    <FlowdownMarkdown
      streaming={streaming}
      highlight={highlight}
      math={loadMath}
      mermaid
      components={components}
      labels={labels}
    >
      {children}
    </FlowdownMarkdown>
  );
}