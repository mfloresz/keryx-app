import * as React from "react";
import {
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CodeIcon,
  GraduationCapIcon,
  LeafIcon,
  PenLineIcon,
  ScaleIcon,
  SparklesIcon,
} from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { useI18n } from "#/i18n";
import type { Agent } from "#/stores/agents";

const ICON_MAP: Record<string, typeof BotIcon> = {
  code: CodeIcon,
  scale: ScaleIcon,
  "pen-line": PenLineIcon,
  sparkles: SparklesIcon,
  graduationcap: GraduationCapIcon,
  leaf: LeafIcon,
  book: BookOpenIcon,
  brain: BrainIcon,
};

function getAgentHeaderColor(id: string, source: Agent["source"]): string {
  // A stable hue per agent so the card header reads as a stable identity.
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  const saturation = source === "user_custom" ? 55 : 45;
  const lightness = 72;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function AgentCard({
  agent,
  onSelect,
}: {
  agent: Agent;
  onSelect: (agent: Agent) => void;
}) {
  const { t } = useI18n();

  const raw = (agent.icon || "").toLowerCase().trim();
  const icon = ICON_MAP[raw] ?? BotIcon;

  const badgeLabel =
    agent.source === "user_custom"
      ? t("agents.byMe")
      : agent.source === "global_custom" || agent.source === "override"
        ? t("agents.byGlobal")
        : t("agents.byCatalog");

  return (
    <button
      type="button"
      aria-label={agent.name}
      onClick={() => onSelect(agent)}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className="relative flex h-36 w-full items-center justify-center overflow-hidden bg-[var(--agent-header)]"
        style={
          {
            "--agent-header": getAgentHeaderColor(agent.id, agent.source),
          } as React.CSSProperties
        }
      >
        {React.createElement(icon, {
          className: "h-12 w-12 text-background drop-shadow-sm",
        })}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="line-clamp-1 text-sm font-semibold tracking-tight">
          {agent.name}
        </h3>
        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
          {agent.description || t("agents.emptyDescription")}
        </p>
        <div className="mt-auto pt-3">
          <Badge variant="secondary" className="text-[11px] font-normal">
            {badgeLabel}
          </Badge>
        </div>
      </div>
    </button>
  );
}
