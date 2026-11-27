import * as React from "react";
import {
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CodeIcon,
  GraduationCapIcon,
  LeafIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  ScaleIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
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
  onDelete,
}: {
  agent: Agent;
  onSelect: (agent: Agent) => void;
  onDelete?: (agent: Agent) => void;
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
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
      <button
        type="button"
        aria-label={agent.name}
        onClick={() => onSelect(agent)}
        className="flex flex-1 flex-col text-left focus-visible:outline-none"
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

      {onDelete ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("agents.actions")}
                className="absolute top-2 right-2 size-8 bg-background/80 text-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              />
            }
          >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">{t("agents.actions")}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(agent)}
            >
              <Trash2Icon className="mr-2 size-3.5" />
              {t("agents.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}