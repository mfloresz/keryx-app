import * as React from "react";

import { Spinner } from "#/components/ui/spinner";
import {
  Trace,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "#/components/ui/trace";
import { useI18n } from "#/i18n";

/**
 * Phrases shown while the model has not produced any visible output yet.
 * They rotate so a slow first token does not look like a frozen UI.
 */
const PHRASES = [
  "chat.thinking",
  "chat.thinkingIdle",
  "chat.thinkingPonder",
  "chat.thinkingDraft",
] as const;

const ROTATE_MS = 2200;

/** Tracks the user's reduced-motion preference so the rotation can stop. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export interface ThinkingIndicatorProps {
  /** Current run status; anything other than submitted/streaming hides it. */
  status?: string;
  /** Tool currently running, if any; replaces the rotating phrase. */
  toolName?: string | null;
  className?: string;
}

/**
 * Placeholder shown after the user sends and before the assistant has any
 * renderable content. Mirrors the "thinking" affordance of chat apps: a
 * spinner plus a rotating phrase, or the running tool's name when known.
 */
export function ThinkingIndicator({
  status,
  toolName,
  className,
}: ThinkingIndicatorProps) {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = React.useState(0);

  const rotating = !toolName && !reducedMotion;

  React.useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % PHRASES.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotating]);

  if (status && status !== "submitted" && status !== "streaming") {
    return null;
  }

  const label = toolName
    ? t("chat.tools.running", { name: toolName })
    : t(PHRASES[index] ?? PHRASES[0]!);

  return (
    <Trace className={className}>
      <TraceLine
        status="running"
        role="status"
        aria-live="polite"
        data-testid="thinking-indicator"
      >
        <TraceIcon>
          <Spinner />
        </TraceIcon>
        <TraceTitle>{label}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}