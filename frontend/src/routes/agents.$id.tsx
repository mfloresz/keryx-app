import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { AgentAutomationsSection } from "#/components/agents/agent-automations";
import {
  KnowledgeSection,
  SkillsSection,
  StarterPromptsSection,
  ToolsSection,
} from "#/components/agents/agent-form-sections";
import type { AgentKnowledge } from "#/components/chat/types";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useI18n } from "#/i18n";
import { useAgentsStore, type Agent } from "#/stores/agents";

export const Route = createFileRoute("/agents/$id")({
  component: AgentEditorPage,
});

function AgentEditorPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { getAgent, updateAgent, deleteAgent, duplicateAgent } = useAgentsStore();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [tools, setTools] = React.useState<string[]>([]);
  const [skills, setSkills] = React.useState<string[]>([]);
  const [starterPrompts, setStarterPrompts] = React.useState<string[]>([]);
  const [knowledge, setKnowledge] = React.useState<AgentKnowledge[]>([]);
  const [loadedAgent, setLoadedAgent] = React.useState<Agent | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      const agent = await getAgent(id);
      if (cancelled) return;
      if (agent) {
        setLoadedAgent(agent);
        setName(agent.name);
        setDescription(agent.description ?? "");
        setIcon(agent.icon ?? "");
        setSystemPrompt(agent.systemPrompt);
        setTools(agent.tools ?? []);
        setSkills(agent.skills ?? []);
        setStarterPrompts(agent.starterPrompts ?? []);
        setKnowledge(agent.knowledge ?? []);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getAgent]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsSaving(true);
    try {
      await updateAgent(id, {
        name: trimmed,
        description: description.trim(),
        icon: icon.trim(),
        systemPrompt,
        tools,
        skills,
        starterPrompts: starterPrompts
          .map((prompt) => prompt.trim())
          .filter(Boolean),
      });
      toast.success("Agent saved");
      void navigate({ to: "/agents" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update agent",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDuplicate() {
    try {
      const created = await duplicateAgent(id);
      void navigate({ to: "/agents/$id", params: { id: created.id } });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to duplicate agent",
      );
    }
  }

  async function handleDelete() {
    try {
      await deleteAgent(id);
      void navigate({ to: "/agents" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete agent",
      );
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      </div>
    );
  }

  const isUserOwned = loadedAgent?.source === "user_custom";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave(event);
        }}
        className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t("agents.editor")}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDuplicate()}
            >
              Duplicate
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => void handleDelete()}
            >
              {t("sidebar.delete")}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-description">Description</Label>
          <Input
            id="agent-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-icon">Icon</Label>
          <Input
            id="agent-icon"
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-prompt">System prompt</Label>
          <textarea
            id="agent-prompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={12}
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <ToolsSection selected={tools} onChange={setTools} />

        <SkillsSection selected={skills} onChange={setSkills} />

        <StarterPromptsSection
          prompts={starterPrompts}
          onChange={setStarterPrompts}
        />

        <KnowledgeSection
          agentId={id}
          knowledge={knowledge}
          onKnowledgeChange={setKnowledge}
        />

        <div className="flex gap-2">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? t("app.loading") : t("app.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: "/agents" })}
          >
            {t("app.cancel")}
          </Button>
        </div>
      </form>

      {/* Automations only exist for agents the user owns. */}
      {isUserOwned ? (
        <div className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-6">
          <AgentAutomationsSection agentId={id} />
        </div>
      ) : null}
    </div>
  );
}
