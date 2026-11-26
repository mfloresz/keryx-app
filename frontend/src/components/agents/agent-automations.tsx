import * as React from "react";
import {
  ExternalLinkIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import { Switch } from "#/components/ui/switch";
import { Textarea } from "#/components/ui/textarea";
import { useI18n } from "#/i18n";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  triggerAutomation,
  updateAutomation,
  type Automation,
} from "#/services/automations";
import { formatScheduleLabel } from "#/utils/schedule";

const INTERVAL_OPTIONS = [
  "every:15m",
  "every:30m",
  "every:1h",
  "every:6h",
  "every:12h",
  "every:24h",
] as const;
const DAILY_OPTION = "daily";

function statusBadge(
  automation: Automation,
  t: (key: string) => string,
): { label: string; variant: "secondary" | "destructive" | "outline" } {
  if (!automation.enabled) {
    return { label: t("automations.statusPaused"), variant: "secondary" };
  }
  if (automation.consecutiveFailures > 0) {
    return { label: t("automations.statusError"), variant: "destructive" };
  }
  if (automation.lastRun) {
    return { label: t("automations.statusSuccess"), variant: "outline" };
  }
  return { label: t("automations.statusPending"), variant: "secondary" };
}

/**
 * Automations for one agent (agent detail page, user-owned agents only).
 * The schedule, prompt and toggles manage a recurring run of the agent.
 */
export function AgentAutomationsSection({ agentId }: { agentId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [automations, setAutomations] = React.useState<Automation[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Automation | null>(
    null,
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await listAutomations();
        if (!cancelled) {
          setAutomations(all.filter((a) => a.agentId === agentId));
        }
      } catch {
        if (!cancelled) {
          toast.error(t("automations.loadFailed"));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, t]);

  async function handleToggle(automation: Automation, enabled: boolean) {
    // Optimistic: the switch flips immediately, then reverts on failure.
    setAutomations((current) =>
      current.map((a) => (a.id === automation.id ? { ...a, enabled } : a)),
    );
    try {
      const updated = await updateAutomation(automation.id, { enabled });
      setAutomations((current) =>
        current.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch {
      setAutomations((current) =>
        current.map((a) =>
          a.id === automation.id
            ? { ...a, enabled: automation.enabled }
            : a,
        ),
      );
      toast.error(t("automations.updateFailed"));
    }
  }

  async function handleRunNow(automation: Automation) {
    try {
      await triggerAutomation(automation.id);
      toast.success(t("automations.runTriggered"));
    } catch {
      toast.error(t("automations.runFailed"));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteAutomation(deleteTarget.id);
      setAutomations((current) =>
        current.filter((a) => a.id !== deleteTarget.id),
      );
    } catch {
      toast.error(t("automations.deleteFailed"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">
            {t("automations.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("automations.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-4" />
          {t("automations.create")}
        </Button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : automations.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("automations.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {automations.map((automation) => {
            const badge = statusBadge(automation, t);
            return (
              <li
                key={automation.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {formatScheduleLabel(automation.schedule, t)}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {automation.taskPrompt}
                  </p>
                  {automation.consecutiveFailures > 0 ? (
                    <p className="mt-0.5 text-xs text-destructive">
                      {t("automations.failures", {
                        count: automation.consecutiveFailures,
                      })}
                    </p>
                  ) : null}
                </div>

                <Badge variant={badge.variant}>{badge.label}</Badge>

                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={automation.enabled}
                    onCheckedChange={(checked) =>
                      void handleToggle(automation, checked)
                    }
                    aria-label={t("automations.enabled")}
                  />
                  {t("automations.enabled")}
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRunNow(automation)}
                >
                  <PlayIcon className="size-4" />
                  {t("automations.runNow")}
                </Button>

                {automation.chatId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void navigate({
                        to: "/chat/$id",
                        params: { id: automation.chatId! },
                      })
                    }
                  >
                    <ExternalLinkIcon className="size-4" />
                    {t("automations.openChat")}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive"
                  aria-label={t("app.delete")}
                  onClick={() => setDeleteTarget(automation)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <CreateAutomationDialog
        agentId={agentId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(automation) =>
          setAutomations((current) => [...current, automation])
        }
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("automations.deleteTitle")}
        description={t("automations.deleteDescription")}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

function CreateAutomationDialog({
  agentId,
  open,
  onOpenChange,
  onCreated,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (automation: Automation) => void;
}) {
  const { t } = useI18n();

  const [scheduleKind, setScheduleKind] =
    React.useState<string>("every:1h");
  const [dailyTime, setDailyTime] = React.useState("09:00");
  const [taskPrompt, setTaskPrompt] = React.useState("");
  const [webhookOutUrl, setWebhookOutUrl] = React.useState("");
  const [allowWriteTools, setAllowWriteTools] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);

  function reset() {
    setScheduleKind("every:1h");
    setDailyTime("09:00");
    setTaskPrompt("");
    setWebhookOutUrl("");
    setAllowWriteTools(false);
  }

  async function handleCreate() {
    const prompt = taskPrompt.trim();
    if (!prompt || isCreating) return;
    const schedule =
      scheduleKind === DAILY_OPTION ? `daily:${dailyTime}` : scheduleKind;
    setIsCreating(true);
    try {
      const created = await createAutomation({
        agentId,
        taskPrompt: prompt,
        schedule,
        webhookOutUrl: webhookOutUrl.trim() || undefined,
        allowWriteTools,
      });
      onCreated(created);
      onOpenChange(false);
      reset();
    } catch {
      toast.error(t("automations.createFailed"));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("automations.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("automations.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="automation-schedule">
              {t("automations.schedule")}
            </Label>
            <Select
              value={scheduleKind}
              onValueChange={(value) => setScheduleKind(String(value))}
            >
              <SelectTrigger id="automation-schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {formatScheduleLabel(option, t)}
                  </SelectItem>
                ))}
                <SelectItem value={DAILY_OPTION}>
                  {t("automations.daily")}
                </SelectItem>
              </SelectContent>
            </Select>
            {scheduleKind === DAILY_OPTION ? (
              <Input
                type="time"
                value={dailyTime}
                onChange={(event) => setDailyTime(event.target.value)}
                aria-label={t("automations.dailyTime")}
              />
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="automation-prompt">
              {t("automations.taskPrompt")}
            </Label>
            <Textarea
              id="automation-prompt"
              value={taskPrompt}
              onChange={(event) => setTaskPrompt(event.target.value)}
              placeholder={t("automations.taskPromptPlaceholder")}
              rows={4}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="automation-webhook">
              {t("automations.webhookUrl")}
            </Label>
            <Input
              id="automation-webhook"
              type="url"
              value={webhookOutUrl}
              onChange={(event) => setWebhookOutUrl(event.target.value)}
              placeholder={t("automations.webhookUrlPlaceholder")}
            />
          </div>

          <label className="flex items-start gap-3">
            <Switch
              checked={allowWriteTools}
              onCheckedChange={(checked) => setAllowWriteTools(checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {t("automations.allowWriteTools")}
              </span>
              <span className="mt-0.5 block text-xs text-destructive">
                {t("automations.allowWriteToolsWarning")}
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("app.cancel")}
          </Button>
          <Button
            disabled={!taskPrompt.trim() || isCreating}
            onClick={() => void handleCreate()}
          >
            {isCreating ? t("app.loading") : t("automations.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
