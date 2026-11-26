import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BotIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { Button } from "#/components/ui/button";
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
import { Switch } from "#/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useI18n } from "#/i18n";
import {
  createAdminAgent,
  createAdminInvitation,
  deleteAdminAgent,
  deleteAdminInvitation,
  deleteProviderKey,
  deletePromptOverride,
  getModelPresets,
  getPromptOverrides,
  getTitleGenerationPolicy,
  getWebSearchConfig,
  listAdminAgents,
  listAdminInvitations,
  listAdminModels,
  listAdminUsers,
  listProviderKeys,
  sendAdminInvitation,
  setModelPreset,
  setPromptOverride,
  setTitleGenerationPolicy,
  setWebSearchConfig,
  updateAdminAgent,
  updateAdminModel,
  updateAdminUserRole,
  upsertProviderKey,
  type CatalogModel,
  type GlobalAgent,
  type ModelPreset,
  type PromptOverride,
  type ProviderKey,
  type TitleGenerationPolicy,
  type WebSearchConfig,
} from "#/services/admin-api";

type AdminTab = "access" | "connections" | "models" | "behavior";

const PROMPT_TAGS = ["{username}", "{date}", "{datetime}", "{language}"];

export function AdminConsole() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<AdminTab>("access");

  const users = useQuery({ queryKey: ["admin", "users"], queryFn: listAdminUsers });
  const invitations = useQuery({
    queryKey: ["admin", "invitations"],
    queryFn: listAdminInvitations,
  });
  const models = useQuery({
    queryKey: ["admin", "models"],
    queryFn: listAdminModels,
  });
  const providerKeys = useQuery({
    queryKey: ["admin", "provider-keys"],
    queryFn: listProviderKeys,
  });
  const webSearch = useQuery({
    queryKey: ["admin", "web-search"],
    queryFn: getWebSearchConfig,
  });
  const titlePolicy = useQuery({
    queryKey: ["admin", "title-policy"],
    queryFn: getTitleGenerationPolicy,
  });
  const modelPresets = useQuery({
    queryKey: ["admin", "model-presets"],
    queryFn: getModelPresets,
  });
  const prompts = useQuery({
    queryKey: ["admin", "prompts"],
    queryFn: getPromptOverrides,
  });
  const globalAgents = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: listAdminAgents,
  });

  const isLoading =
    users.isLoading ||
    invitations.isLoading ||
    models.isLoading ||
    providerKeys.isLoading;

  const adminCount = (users.data ?? []).filter(
    (u) => u.role === "admin",
  ).length;

  /** Invalidates the given query keys, e.g. invalidate([["admin", "users"]]). */
  async function invalidate(keys: string[][]) {
    for (const key of keys) {
      await queryClient.invalidateQueries({ queryKey: key });
    }
  }

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as AdminTab)}>
      <TabsList>
        <TabsTrigger value="access">{t("admin.dashboard.users")}</TabsTrigger>
        <TabsTrigger value="connections">
          {t("admin.connections.title")}
        </TabsTrigger>
        <TabsTrigger value="models">
          {t("admin.dashboard.models")}
        </TabsTrigger>
        <TabsTrigger value="behavior">
          {t("admin.behavior.title")}
        </TabsTrigger>
      </TabsList>

      {/* ---- Access: users + invitations ---- */}
      <TabsContent value="access" className="mt-4 space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">{t("admin.dashboard.users")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("admin.dashboard.usersDescription")}
            </p>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {(users.data ?? []).map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {user.name || user.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <Select
                    value={user.role}
                    onValueChange={async (value) => {
                      try {
                        await updateAdminUserRole(user.id, String(value));
                        await invalidate([["admin", "users"]]);
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : t("admin.shared.loadError"),
                        );
                      }
                    }}
                    disabled={user.role === "admin" && adminCount === 1}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">
                        {t("admin.shared.roleUser")}
                      </SelectItem>
                      <SelectItem value="admin">
                        {t("admin.shared.roleAdmin")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </section>

        <InvitationsCard
          invitations={invitations.data ?? []}
          isLoading={invitations.isLoading}
          onChanged={() => invalidate([["admin", "invitations"]])}
        />
      </TabsContent>

      {/* ---- Connections: provider keys + web search ---- */}
      <TabsContent value="connections" className="mt-4 space-y-6">
        <ProviderKeysCard
          keys={providerKeys.data ?? []}
          isLoading={providerKeys.isLoading}
          onChanged={() => invalidate([["admin", "provider-keys"]])}
        />
        <WebSearchCard
          config={webSearch.data}
          isLoading={webSearch.isLoading}
          onChanged={() => invalidate([["admin", "web-search"]])}
        />
      </TabsContent>

      {/* ---- Models: title policy, presets, catalog ---- */}
      <TabsContent value="models" className="mt-4 space-y-6">
        <TitlePolicyCard
          policy={titlePolicy.data?.policy}
          catalog={titlePolicy.data?.catalog ?? []}
          isLoading={titlePolicy.isLoading}
          onChanged={() => invalidate([["admin", "title-policy"]])}
        />
        <ModelPresetsCard
          presets={modelPresets.data?.presets ?? []}
          catalog={modelPresets.data?.catalog ?? []}
          isLoading={modelPresets.isLoading}
          onChanged={() => invalidate([["admin", "model-presets"]])}
        />
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">{t("admin.models.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("admin.dashboard.modelsDescription")}
            </p>
          </div>
          {models.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {(models.data ?? []).map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {model.displayName || model.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {model.provider} · {model.id}
                    </p>
                  </div>
                  <Switch
                    checked={model.enabled}
                    aria-label={t("admin.models.enabledForUserColumn")}
                    onCheckedChange={async (checked) => {
                      try {
                        await updateAdminModel(model.id, checked);
                        await invalidate([["admin", "models"]]);
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : t("admin.shared.loadError"),
                        );
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      {/* ---- Behavior: prompts + global agents ---- */}
      <TabsContent value="behavior" className="mt-4 space-y-6">
        <PromptsCard
          prompts={prompts.data}
          isLoading={prompts.isLoading}
          onChanged={() => invalidate([["admin", "prompts"]])}
        />
        <GlobalAgentsCard
          agents={globalAgents.data ?? []}
          isLoading={globalAgents.isLoading}
          onChanged={() => invalidate([["admin", "agents"]])}
        />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

function InvitationsCard({
  invitations,
  isLoading,
  onChanged,
}: {
  invitations: import("#/services/admin-api").AdminInvitation[];
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("user");
  const [error, setError] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [createdLink, setCreatedLink] = React.useState<string | null>(null);
  const [createdToken, setCreatedToken] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);

  async function handleCreate() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t("admin.invitations.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("admin.invitations.emailInvalid"));
      return;
    }
    setIsCreating(true);
    setError("");
    try {
      const result = await createAdminInvitation(trimmed, role);
      const link =
        result.url ?? `${window.location.origin}/invite/${result.token ?? ""}`;
      setCreatedLink(link);
      setCreatedToken(result.token ?? null);
      await onChanged();
      toast.success(t("admin.invitations.createSuccess"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("admin.invitations.createError"),
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSend() {
    if (!createdToken) return;
    try {
      await sendAdminInvitation(email.trim(), createdToken);
      toast.success(t("admin.invitations.sendSuccess"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.invitations.sendError"),
      );
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{t("admin.dashboard.invitations")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin.dashboard.invitationsDescription")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEmail("");
            setRole("user");
            setError("");
            setCreatedLink(null);
            setCreatedToken(null);
            setOpen(true);
          }}
        >
          {t("admin.invitations.createButton")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : invitations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.invitations.noInvitations")}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {invitation.email}
                </p>
                <p className="text-xs text-muted-foreground">
                  {invitation.role} ·{" "}
                  {invitation.usedAt
                    ? t("admin.invitations.statusUsed")
                    : t("admin.invitations.statusPending")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setDeleteTarget(invitation.id)}
              >
                {t("sidebar.delete")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.invitations.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("admin.invitations.singleUseDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">
                {t("admin.invitations.email")}
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                aria-invalid={Boolean(error)}
                onChange={(event) => setEmail(event.target.value)}
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">
                {t("admin.invitations.role")}
              </Label>
              <Select value={role} onValueChange={(v) => setRole(String(v))}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">
                    {t("admin.shared.roleUser")}
                  </SelectItem>
                  <SelectItem value="admin">
                    {t("admin.shared.roleAdmin")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {createdLink ? (
              <div className="space-y-1.5">
                <Label>Link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={createdLink} />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(createdLink);
                      toast.success(t("admin.invitations.copySuccess"));
                    }}
                  >
                    {t("admin.invitations.copyLink")}
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSend()}
                >
                  {t("admin.invitations.sendButton")}
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("app.cancel")}
            </Button>
            <Button disabled={isCreating} onClick={() => void handleCreate()}>
              {isCreating
                ? t("admin.invitations.creating")
                : t("admin.invitations.createButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("admin.invitations.title")}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={async () => {
          const id = deleteTarget;
          setDeleteTarget(null);
          if (!id) return;
          try {
            await deleteAdminInvitation(id);
            await onChanged();
            toast.success(t("admin.invitations.deleteSuccess"));
          } catch (err) {
            toast.error(
              err instanceof Error
                ? err.message
                : t("admin.invitations.deleteError"),
            );
          }
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Provider keys
// ---------------------------------------------------------------------------

function ProviderKeysCard({
  keys,
  isLoading,
  onChanged,
}: {
  keys: ProviderKey[];
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [target, setTarget] = React.useState<ProviderKey | null>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  async function handleSave() {
    if (!target) return;
    setIsSaving(true);
    try {
      await upsertProviderKey(target.provider, apiKey.trim());
      setTarget(null);
      setApiKey("");
      await onChanged();
      toast.success(t("admin.connections.saved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">{t("admin.connections.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.connections.description")}
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {keys.map((key) => (
            <div
              key={key.provider}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{key.label}</p>
                <p className="text-xs text-muted-foreground">
                  {key.configured
                    ? `${t("admin.connections.configured")}${
                        key.updatedAt
                          ? ` · ${t("admin.connections.updatedAt", {
                              date: new Date(key.updatedAt).toLocaleString(),
                            })}`
                          : ""
                      }`
                    : t("admin.connections.notConfigured")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTarget(key);
                    setApiKey("");
                  }}
                >
                  {key.configured
                    ? t("admin.connections.update")
                    : t("admin.connections.saveKey")}
                </Button>
                {key.configured ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      try {
                        await deleteProviderKey(key.provider);
                        await onChanged();
                      } catch (err) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : t("admin.shared.loadError"),
                        );
                      }
                    }}
                  >
                    {t("admin.connections.deleteKey")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.connections.setKey")}</DialogTitle>
            <DialogDescription>
              {target?.label} — {t("admin.connections.keyNeverShown")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="provider-key">API Key</Label>
            <Input
              id="provider-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isSaving || !apiKey.trim()}
              onClick={() => void handleSave()}
            >
              {t("admin.connections.saveKey")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

function WebSearchCard({
  config,
  isLoading,
  onChanged,
}: {
  config: WebSearchConfig | undefined;
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = React.useState("");
  const [enabled, setEnabled] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (config && !dirty) setEnabled(config.enabled);
  }, [config, dirty]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await setWebSearchConfig(apiKey.trim(), enabled);
      setApiKey("");
      setDirty(false);
      await onChanged();
      toast.success(t("admin.connections.saved"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">{t("admin.connections.webSearch")}</h2>
        <p className="text-sm text-muted-foreground">
          {config?.configured
            ? t("admin.connections.configured")
            : t("admin.connections.notConfigured")}
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="web-search-key">
              {t("admin.connections.braveKey")}
            </Label>
            <Input
              id="web-search-key"
              type="password"
              value={apiKey}
              placeholder={
                config?.configured
                  ? t("admin.connections.keyNeverShown")
                  : undefined
              }
              onChange={(event) => {
                setApiKey(event.target.value);
                setDirty(true);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => {
                setEnabled(checked);
                setDirty(true);
              }}
            />
            {t("admin.connections.enableWebSearch")}
          </label>
          <Button
            size="sm"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
          >
            {t("app.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Title generation policy
// ---------------------------------------------------------------------------

function TitlePolicyCard({
  policy,
  catalog,
  isLoading,
  onChanged,
}: {
  policy: TitleGenerationPolicy | undefined;
  catalog: CatalogModel[];
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<TitleGenerationPolicy["mode"]>(
    "chat_model",
  );
  const [modelId, setModelId] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    if (policy && !dirty) {
      setMode(policy.mode);
      setModelId(policy.modelId ?? "");
    }
  }, [policy, dirty]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await setTitleGenerationPolicy(mode, modelId);
      setDirty(false);
      await onChanged();
      toast.success(t("app.save"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">{t("admin.models.titleGeneration")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.models.titleGenerationDescription")}
        </p>
      </div>
      {isLoading || !policy ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="title-mode"
              checked={mode === "chat_model"}
              onChange={() => {
                setMode("chat_model");
                setDirty(true);
              }}
            />
            {t("admin.models.useChatModel")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="title-mode"
              checked={mode === "custom"}
              onChange={() => {
                setMode("custom");
                setDirty(true);
              }}
            />
            {t("admin.models.useDedicatedModel")}
          </label>
          {mode === "custom" ? (
            <Select
              value={modelId}
              onValueChange={(value) => {
                setModelId(String(value));
                setDirty(true);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("admin.models.chooseModel")} />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.displayName} · {model.provider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            size="sm"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
          >
            {t("app.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Model presets
// ---------------------------------------------------------------------------

function ModelPresetsCard({
  presets,
  catalog,
  isLoading,
  onChanged,
}: {
  presets: ModelPreset[];
  catalog: CatalogModel[];
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);

  const dirty = Object.keys(drafts).length > 0;

  async function handleSave() {
    setIsSaving(true);
    try {
      for (const [presetId, modelId] of Object.entries(drafts)) {
        await setModelPreset(presetId, modelId);
      }
      setDrafts({});
      await onChanged();
      toast.success(t("app.save"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">{t("admin.models.modelPresets")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.models.modelPresetsDescription")}
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          {presets.map((preset) => (
            <div
              key={preset.presetId}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-sm">{preset.label}</span>
              <Select
                value={drafts[preset.presetId] ?? preset.modelId}
                onValueChange={(value) =>
                  setDrafts((current) => ({
                    ...current,
                    [preset.presetId]: String(value),
                  }))
                }
              >
                <SelectTrigger size="sm" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName} · {model.provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Button
            size="sm"
            disabled={!dirty || isSaving}
            onClick={() => void handleSave()}
          >
            {t("app.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prompt overrides
// ---------------------------------------------------------------------------

function PromptsCard({
  prompts,
  isLoading,
  onChanged,
}: {
  prompts: { base: PromptOverride; title: PromptOverride } | undefined;
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [resetKey, setResetKey] = React.useState<string | null>(null);

  async function handleSave(key: string) {
    const value = drafts[key];
    if (value === undefined) return;
    setIsSaving(true);
    try {
      await setPromptOverride(key, value);
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await onChanged();
      toast.success(t("app.save"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !prompts) {
    return (
      <section className="space-y-3">
        <h2 className="font-medium">{t("admin.prompts.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      </section>
    );
  }

  const entries: Array<{ key: string; label: string; override: PromptOverride }> = [
    { key: "base", label: t("admin.prompts.base"), override: prompts.base },
    { key: "title", label: t("admin.prompts.titlePrompt"), override: prompts.title },
  ];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium">{t("admin.prompts.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.prompts.description")}
        </p>
      </div>
      {entries.map((entry) => {
        const value = drafts[entry.key] ?? entry.override.prompt;
        const changed = drafts[entry.key] !== undefined;
        return (
          <div key={entry.key} className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-2">
              <Label>{entry.label}</Label>
              <span className="text-[11px] text-muted-foreground">
                {entry.override.source === "override"
                  ? t("admin.prompts.override")
                  : t("admin.prompts.embedded")}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {PROMPT_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                  onClick={() =>
                    setDrafts((current) => ({
                      ...current,
                      [entry.key]: (current[entry.key] ?? entry.override.prompt)
                        .replace("{username}", "Test")
                        .replace("{date}", "2026-01-01")
                        .replace("{datetime}", "2026-01-01 12:00")
                        .replace("{language}", "en"),
                    }))
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={value}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [entry.key]: event.target.value,
                }))
              }
              rows={8}
              className="w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {value.length}/20000
              </span>
              <Button
                size="sm"
                disabled={!changed || isSaving || !value.trim()}
                onClick={() => void handleSave(entry.key)}
              >
                <SaveIcon className="mr-2 size-4" />
                {t("app.save")}
              </Button>
              {entry.override.source === "override" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setResetKey(entry.key)}
                >
                  <RefreshCwIcon className="mr-2 size-4" />
                  {t("admin.prompts.reset")}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}

      <ConfirmDialog
        open={resetKey !== null}
        onOpenChange={(open) => !open && setResetKey(null)}
        title={t("admin.prompts.reset")}
        description={t("admin.prompts.resetDescription")}
        confirmLabel={t("admin.prompts.reset")}
        destructive
        onConfirm={async () => {
          const key = resetKey;
          setResetKey(null);
          if (!key) return;
          try {
            await deletePromptOverride(key);
            await onChanged();
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : t("admin.shared.loadError"),
            );
          }
        }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Global agents
// ---------------------------------------------------------------------------

function GlobalAgentsCard({
  agents,
  isLoading,
  onChanged,
}: {
  agents: GlobalAgent[];
  isLoading: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState<GlobalAgent | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<GlobalAgent | null>(
    null,
  );

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">{t("admin.agents.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("admin.agents.description")}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon className="mr-2 size-4" />
          {t("admin.agents.create")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.agents.empty")}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {agents.map((agent) => (
            <div
              key={agent.id + ":" + agent.source}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <BotIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{agent.name}</p>
                  {agent.description ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {agent.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {agent.source === "builtin"
                    ? t("agents.byCatalog")
                    : agent.source === "user_custom"
                      ? t("agents.byMe")
                      : t("agents.byGlobal")}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("admin.agents.edit")}
                  onClick={() => setEditing(agent)}
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("admin.agents.delete")}
                  className="text-destructive"
                  onClick={() => setDeleteTarget(agent)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <GlobalAgentDialog
        open={creating || editing !== null}
        agent={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await onChanged();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("admin.agents.delete")}
        description={deleteTarget?.name}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={async () => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          try {
            await deleteAdminAgent(target.id);
            await onChanged();
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : t("admin.shared.loadError"),
            );
          }
        }}
      />
    </section>
  );
}

function GlobalAgentDialog({
  open,
  agent,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  agent: GlobalAgent | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [systemPrompt, setSystemPrompt] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? "");
    setDescription(agent?.description ?? "");
    setIcon(agent?.icon ?? "");
    setSystemPrompt(agent?.systemPrompt ?? "");
  }, [open, agent]);

  async function handleSave() {
    if (!name.trim() || !systemPrompt.trim()) return;
    setIsSaving(true);
    try {
      if (agent) {
        await updateAdminAgent(agent.id, {
          name: name.trim(),
          description: description.trim(),
          icon: icon.trim(),
          systemPrompt,
        });
      } else {
        await createAdminAgent({
          name: name.trim(),
          description: description.trim(),
          icon: icon.trim(),
          systemPrompt,
        });
      }
      await onSaved();
      toast.success(t("app.save"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {agent ? t("admin.agents.edit") : t("admin.agents.create")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-desc">Description</Label>
            <Input
              id="agent-desc"
              maxLength={300}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-icon">Icon</Label>
            <Input
              id="agent-icon"
              maxLength={40}
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-prompt">System Prompt</Label>
            <textarea
              id="agent-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={8}
              className="w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("app.cancel")}
          </Button>
          <Button
            disabled={isSaving || !name.trim() || !systemPrompt.trim()}
            onClick={() => void handleSave()}
          >
            {t("app.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
