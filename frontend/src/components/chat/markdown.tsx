import * as React from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useHighlightedCode } from "#/hooks/use-highlighted-code";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "#/components/ui/code-block";

/**
 * Replacement renderer for <pre> elements in markdown (code fences).
 * Fenced code arrives as <pre><code>, so read it from the hast node.
 */
function MarkdownPre({
  node,
  children,
  ...props
}: React.ComponentProps<"pre"> & ExtraProps) {
  const element = node?.children[0];

  if (element?.type !== "element" || element.tagName !== "code") {
    return <pre {...props}>{children}</pre>;
  }

  const language =
    /language-([^\s,]+)/.exec(String(element.properties.className ?? ""))?.[1] ??
    "";
  const code = element.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "");

  return <MarkdownCodeBlock code={code} language={language} />;
}

function MarkdownCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const lines = useHighlightedCode(code, language);

  return (
    <CodeBlock className="not-typeset my-3">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

const components = {
  pre: MarkdownPre,
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium underline underline-offset-4"
    >
      {children}
    </a>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
