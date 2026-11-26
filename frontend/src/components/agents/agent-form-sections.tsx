import * as React from "react";
import {
  CheckIcon,
  FileTextIcon,
  GlobeIcon,
  PaletteIcon,
  PaperclipIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { AgentKnowledge } from "#/components/chat/types";
import { Attachment, AttachmentMedia } from "#/components/ui/attachment";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Spinner } from "#/components/ui/spinner";
import { useI18n } from "#/i18n";
import {
  deleteAgentKnowledge,
  uploadAgentKnowledge,
} from "#/services/agent-knowledge";
import { listSkills, type SkillInfo } from "#/services/skills";
import { cn } from "cn";

const MAX_STARTER_PROMPTS = 4;

const TOOLS = [
  {
    id: "web_search",
    icon: GlobeIcon,
    labelKey: "agents.toolsSection.webSearch",
  },
  {
    id: "update_artifact",
    icon: PaletteIcon,
    labelKey: "agents.toolsSection.updateArtifact",
  },
] as const;

/** Toggle chips for the extra tools the agent may use. */
export function ToolsSection({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-1.5">
      <Label>{t("agents.toolsSection.label")}</Label>
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((tool) => {
          const active = selected.includes(tool.id);
          return (
            <Button
              key={tool.id}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((id) => id !== tool.id)
                    : [...selected, tool.id],
                )
              }
            >
              {active ? (
                <CheckIcon className="size-4" />
              ) : (
                <tool.icon className="size-4" />
              )}
              {t(tool.labelKey)}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("agents.toolsSection.hint")}
      </p>
    </div>
  );
}

/**
 * Multi-select over the skills the admin enabled. When no skill exists the
 * section collapses to a subtle hint so users don't think it's broken.
 */
export function SkillsSection({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (skills: string[]) => void;
}) {
  const { t } = useI18n();
  const [skills, setSkills] = React.useState<SkillInfo[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        // A failed load renders the same hint as an empty catalog.
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (skills !== null && skills.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("agents.skillsSection.emptyHint")}
      </p>
    );
  }

  if (skills === null) {
    return (
      <div className="space-y-1.5">
        <Label>{t("agents.skillsSection.label")}</Label>
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{t("agents.skillsSection.label")}</Label>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {skills.map((skill) => {
          const active = selected.includes(skill.name);
          return (
            <button
              key={skill.name}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((name) => name !== skill.name)
                    : [...selected, skill.name],
                )
              }
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                active ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input",
                )}
              >
                {active ? <CheckIcon className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {skill.name}
                </span>
                {skill.description ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Dynamic list of first-message suggestions (max 4). */
export function StarterPromptsSection({
  prompts,
  onChange,
}: {
  prompts: string[];
  onChange: (prompts: string[]) => void;
}) {
  const { t } = useI18n();

  function updatePrompt(index: number, value: string) {
    onChange(prompts.map((p, i) => (i === index ? value : p)));
  }

  return (
    <div className="space-y-1.5">
      <Label>{t("agents.starterPrompts.label")}</Label>
      {prompts.map((prompt, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={prompt}
            onChange={(event) => updatePrompt(index, event.target.value)}
            placeholder={t("agents.starterPrompts.placeholder")}
            maxLength={200}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("app.delete")}
            className="shrink-0"
            onClick={() =>
              onChange(prompts.filter((_, i) => i !== index))
            }
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={prompts.length >= MAX_STARTER_PROMPTS}
        onClick={() => onChange([...prompts, ""])}
      >
        <PlusIcon className="size-4" />
        {t("agents.starterPrompts.add")}
      </Button>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Knowledge files for the agent (edit page only, the agent needs an id).
 * Uploads use the same multipart shape as chat attachments.
 */
export function KnowledgeSection({
  agentId,
  knowledge,
  onKnowledgeChange,
}: {
  agentId: string;
  knowledge: AgentKnowledge[];
  onKnowledgeChange: (knowledge: AgentKnowledge[]) => void;
}) {
  const { t } = useI18n();
  const [isUploading, setIsUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setIsUploading(true);
    try {
      const uploaded = await uploadAgentKnowledge(agentId, files);
      onKnowledgeChange([...knowledge, ...uploaded]);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("agents.knowledge.uploadFailed"),
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(file: AgentKnowledge) {
    setDeletingId(file.id);
    try {
      await deleteAgentKnowledge(agentId, file.id);
      onKnowledgeChange(knowledge.filter((f) => f.id !== file.id));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("agents.knowledge.deleteFailed"),
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{t("agents.knowledge.label")}</Label>
      <p className="text-xs text-muted-foreground">
        {t("agents.knowledge.hint")}
      </p>

      {knowledge.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {knowledge.map((file) => (
            <Attachment key={file.id} size="sm">
              <AttachmentMedia variant="icon">
                <FileTextIcon />
              </AttachmentMedia>
              <span className="max-w-40 truncate text-xs">
                {file.filename}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t("app.delete")}
                disabled={deletingId === file.id}
                onClick={() => void handleDelete(file)}
              >
                {deletingId === file.id ? <Spinner /> : <XIcon />}
              </Button>
            </Attachment>
          ))}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <Spinner className="size-4" />
        ) : (
          <PaperclipIcon className="size-4" />
        )}
        {isUploading
          ? t("agents.knowledge.uploading")
          : t("agents.knowledge.add")}
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
