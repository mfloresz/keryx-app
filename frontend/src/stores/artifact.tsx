import * as React from "react";

import { hashCode, type HtmlArtifact } from "#/utils/html-artifacts";

export type ArtifactTab = "preview" | "code";

interface ArtifactContextValue {
  /** Artifacts derived from the chat messages. */
  synced: HtmlArtifact[];
  /** Every artifact, including the ephemeral one opened from a code block. */
  all: HtmlArtifact[];
  active: HtmlArtifact | null;
  activeKey: string | null;
  activeIndex: number;
  isOpen: boolean;
  tab: ArtifactTab;
  syncItems: (next: HtmlArtifact[]) => void;
  open: (key?: string) => void;
  openFromCodeBlock: (code: string) => void;
  select: (key: string) => void;
  step: (delta: -1 | 1) => void;
  setTab: (tab: ArtifactTab) => void;
  close: () => void;
  reset: () => void;
}

const ArtifactContext = React.createContext<ArtifactContextValue | null>(null);

/**
 * Single source of UI truth for the HTML artifacts panel.
 * Items are synced (derived) from chat messages; inline previews from
 * Markdown resolve to the matching synced item by code or fall back to an
 * ephemeral entry so the eye-button always works.
 */
export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const [synced, setSynced] = React.useState<HtmlArtifact[]>([]);
  const [inlineItem, setInlineItem] = React.useState<HtmlArtifact | null>(null);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [tab, setTab] = React.useState<ArtifactTab>("preview");

  const all = React.useMemo<HtmlArtifact[]>(() => {
    if (inlineItem && !synced.some((a) => a.key === inlineItem.key)) {
      return [...synced, inlineItem];
    }
    return synced;
  }, [synced, inlineItem]);

  const activeIndex = all.findIndex((a) => a.key === activeKey);
  const active = activeIndex >= 0 ? (all[activeIndex] ?? null) : null;

  const syncItems = React.useCallback((next: HtmlArtifact[]) => {
    setSynced(next);
    setInlineItem((current) => {
      if (!current) return null;
      // Drop the ephemeral entry once the same code lands in synced items.
      if (next.some((a) => a.code === current.code)) {
        const match = next.find((a) => a.code === current.code);
        if (match && activeKey === current.key) setActiveKey(match.key);
        return null;
      }
      return current;
    });
    setActiveKey((current) => {
      if (!current) {
        return next.length ? (next[next.length - 1]!.key) : null;
      }
      return next.some((a) => a.key === current) ? current : null;
    });
  }, [activeKey]);

  const open = React.useCallback((key?: string) => {
    setActiveKey((current) => {
      if (key && all.some((a) => a.key === key)) return key;
      if (!current && all.length) return all[all.length - 1]!.key;
      return current;
    });
    setTab("preview");
    setIsOpen(true);
  }, [all]);

  const openFromCodeBlock = React.useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const existing = synced.find((a) => a.code === trimmed);
    if (existing) {
      setActiveKey(existing.key);
    } else {
      const item: HtmlArtifact = {
        key: `inline-${hashCode(trimmed)}`,
        messageId: "inline",
        index: 0,
        code: trimmed,
      };
      setInlineItem(item);
      setActiveKey(item.key);
    }
    setTab("preview");
    setIsOpen(true);
  }, [synced]);

  const select = React.useCallback((key: string) => {
    if (all.some((a) => a.key === key)) setActiveKey(key);
  }, [all]);

  const step = React.useCallback((delta: -1 | 1) => {
    if (!all.length) return;
    setActiveKey((current) => {
      const index = all.findIndex((a) => a.key === current);
      const from = index < 0 ? all.length - 1 : index;
      const next = (from + delta + all.length) % all.length;
      return all[next]!.key;
    });
  }, [all]);

  const close = React.useCallback(() => setIsOpen(false), []);

  const reset = React.useCallback(() => {
    setSynced([]);
    setInlineItem(null);
    setActiveKey(null);
    setIsOpen(false);
    setTab("preview");
  }, []);

  const value = React.useMemo<ArtifactContextValue>(
    () => ({
      synced,
      all,
      active,
      activeKey,
      activeIndex,
      isOpen,
      tab,
      syncItems,
      open,
      openFromCodeBlock,
      select,
      step,
      setTab,
      close,
      reset,
    }),
    [
      synced,
      all,
      active,
      activeKey,
      activeIndex,
      isOpen,
      tab,
      syncItems,
      open,
      openFromCodeBlock,
      select,
      step,
      close,
      reset,
    ],
  );

  return (
    <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>
  );
}

export function useArtifactStore(): ArtifactContextValue {
  const context = React.useContext(ArtifactContext);
  if (!context) {
    throw new Error("useArtifactStore must be used inside an ArtifactProvider");
  }
  return context;
}
