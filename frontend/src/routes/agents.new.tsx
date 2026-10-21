import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { useI18n } from "#/i18n";
import { useAgentsStore } from "#/stores/agents";

export const Route = createFileRoute("/agents/new")({
  component: NewAgentPage,
});

function NewAgentPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { createAgent } = useAgentsStore();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !systemPrompt.trim()) return;

    setIsSaving(true);
    try {
      const created = await createAgent({
        name: trimmed,
        description: description.trim(),
        icon: icon.trim() || undefined,
        systemPrompt,
      });
      void navigate({ to: "/agents/$id", params: { id: created.id } });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create agent",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(event);
        }}
        className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("agents.create")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("agents.subtitle")}
          </p>
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
            placeholder="sparkles"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-prompt">System prompt</Label>
          <textarea
            id="agent-prompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={12}
            required
            className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

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
    </div>
  );
}
