import * as React from "react";

import {
  hashCode,
  type HtmlArtifact,
  type ModelArtifact,
} from "#/utils/html-artifacts";

export type ArtifactTab = "preview" | "code";

/**
 * Everything the panel can navigate between: fenced-HTML artifacts carry
 * their code locally, model artifacts carry only metadata (content is
 * fetched lazily from the backend).
 */
export type PanelArtifact = HtmlArtifact | ModelArtifact;

export function isModelArtifact(
  artifact: PanelArtifact,
): artifact is ModelArtifact {
  return "artifactId" in artifact;
}

interface ArtifactContextValue {
  /** Artifacts derived from the chat messages (HTML fences). */
  synced: HtmlArtifact[];
  /** Model artifacts announced via data-artifact message parts. */
  modelArtifacts: ModelArtifact[];
  /** Every artifact, including the ephemeral one opened from a code block. */
  all: PanelArtifact[];
  active: PanelArtifact | null;
  activeKey: string | null;
  activeIndex: number;
  isOpen: boolean;
  tab: ArtifactTab;
  syncItems: (next: HtmlArtifact[], model?: ModelArtifact[]) => void;
  open: (key?: string) => void;
  /** Opens a model artifact, registering it when the sync has not run yet. */
  openModelArtifact: (artifact: ModelArtifact) => void;
  openFromCodeBlock: (code: string) => void;
  select: (key: string) => void;
  step: (delta: -1 | 1) => void;
  setTab: (tab: ArtifactTab) => void;
  close: () => void;
  reset: () => void;
}

const ArtifactContext = React.createContext<ArtifactContextValue | null>(null);

/**
 * Single source of UI truth for the artifacts panel.
 * Items are synced (derived) from chat messages — HTML fences and
 * `data-artifact` parts alike; inline previews from Markdown resolve to the
 * matching synced item by code or fall back to an ephemeral entry so the
 * eye-button always works.
 */
export function ArtifactProvider({ children }: { children: React.ReactNode }) {
  const [synced, setSynced] = React.useState<HtmlArtifact[]>([]);
  const [modelArtifacts, setModelArtifacts] = React.useState<ModelArtifact[]>(
    [],
  );
  const [inlineItem, setInlineItem] = React.useState<HtmlArtifact | null>(null);
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [tab, setTab] = React.useState<ArtifactTab>("preview");

  const all = React.useMemo<PanelArtifact[]>(() => {
    const combined: PanelArtifact[] = [...synced, ...modelArtifacts];
    if (inlineItem && !combined.some((a) => a.key === inlineItem.key)) {
      return [...combined, inlineItem];
    }
    return combined;
  }, [synced, modelArtifacts, inlineItem]);

  const activeIndex = all.findIndex((a) => a.key === activeKey);
  const active = activeIndex >= 0 ? (all[activeIndex] ?? null) : null;

  const syncItems = React.useCallback(
    (next: HtmlArtifact[], model?: ModelArtifact[]) => {
      setSynced(next);
      // `modelArtifacts` is read below to reconcile the selection, so the
      // incoming list is tracked locally as well.
      const modelList = model ?? modelArtifacts;
      if (model) {
        setModelArtifacts((current) => {
          if (
            current.length === model.length &&
            current.every(
              (a, i) =>
                a.key === model[i]?.key && a.version === model[i]?.version,
            )
          ) {
            return current;
          }
          return model;
        });
      }
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
          const last = modelList.at(-1) ?? next.at(-1);
          return last ? last.key : null;
        }
        // Keep the selection while the artifact still exists (the panel may
        // have been opened from a card before this sync landed).
        const stillThere =
          next.some((a) => a.key === current) ||
          modelList.some((a) => a.key === current);
        return stillThere ? current : null;
      });
    },
    [activeKey, modelArtifacts],
  );

  const open = React.useCallback(
    (key?: string) => {
      setActiveKey((current) => {
        if (key && all.some((a) => a.key === key)) return key;
        if (!current && all.length) return all[all.length - 1]!.key;
        return current;
      });
      setTab("preview");
      setIsOpen(true);
    },
    [all],
  );

  const openModelArtifact = React.useCallback((artifact: ModelArtifact) => {
    // Insert (or bump) the artifact so the panel can resolve it even when the
    // message sync has not run yet.
    setModelArtifacts((current) => {
      const index = current.findIndex((a) => a.key === artifact.key);
      if (index < 0) return [...current, artifact];
      if (current[index]!.version >= artifact.version) return current;
      const updated = current.slice();
      updated[index] = artifact;
      return updated;
    });
    setActiveKey(artifact.key);
    setTab("preview");
    setIsOpen(true);
  }, []);

  const openFromCodeBlock = React.useCallback(
    (code: string) => {
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
    },
    [synced],
  );

  const select = React.useCallback(
    (key: string) => {
      if (all.some((a) => a.key === key)) setActiveKey(key);
    },
    [all],
  );

  const step = React.useCallback(
    (delta: -1 | 1) => {
      if (!all.length) return;
      setActiveKey((current) => {
        const index = all.findIndex((a) => a.key === current);
        const from = index < 0 ? all.length - 1 : index;
        const next = (from + delta + all.length) % all.length;
        return all[next]!.key;
      });
    },
    [all],
  );

  const close = React.useCallback(() => setIsOpen(false), []);

  const reset = React.useCallback(() => {
    setSynced([]);
    setModelArtifacts([]);
    setInlineItem(null);
    setActiveKey(null);
    setIsOpen(false);
    setTab("preview");
  }, []);

  const value = React.useMemo<ArtifactContextValue>(
    () => ({
      synced,
      modelArtifacts,
      all,
      active,
      activeKey,
      activeIndex,
      isOpen,
      tab,
      syncItems,
      open,
      openModelArtifact,
      openFromCodeBlock,
      select,
      step,
      setTab,
      close,
      reset,
    }),
    [
      synced,
      modelArtifacts,
      all,
      active,
      activeKey,
      activeIndex,
      isOpen,
      tab,
      syncItems,
      open,
      openModelArtifact,
      openFromCodeBlock,
      select,
      step,
      close,
      reset,
    ],
  );

  return (
    <ArtifactContext.Provider value={value}>
      {children}
    </ArtifactContext.Provider>
  );
}

export function useArtifactStore(): ArtifactContextValue {
  const context = React.useContext(ArtifactContext);
  if (!context) {
    throw new Error("useArtifactStore must be used inside an ArtifactProvider");
  }
  return context;
}
