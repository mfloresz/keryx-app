import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
import { getAuthAdapter } from "#/services/runtime";
import { useAuth } from "#/stores/auth";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type AdminTab = "access" | "invitations" | "models";

interface AdminData {
  users: AdminUser[];
  invitations: AdminInvitation[];
  models: AdminModel[];
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface AdminInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

interface AdminModel {
  id: string;
  displayName: string;
  provider: string;
  enabled: boolean;
}

async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = await getAuthAdapter();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(await auth.getAuthorizationHeaders()),
    ...(init?.headers as Record<string, string> | undefined),
  };
  return fetch(path, { ...init, headers });
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Request failed: ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

function AdminPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { session } = useAuth();

  const [tab, setTab] = React.useState<AdminTab>("access");

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("user");
  const [isCreating, setIsCreating] = React.useState(false);
  const [createdLink, setCreatedLink] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminInvitation | null>(
    null,
  );

  const isAdmin = session?.user.role === "admin";

  // The three lists load together and refetch after a mutation. TanStack
  // Query owns the fetching, so there is no effect to synchronise.
  const queryClient = useQueryClient();
  const { data: adminData, isLoading, refetch } = useQuery({
    queryKey: ["admin"],
    queryFn: async () => {
      const [userList, invitationList, modelList] = await Promise.all([
        adminFetch("/api/admin/users").then((r) => readJson<AdminUser[]>(r)),
        adminFetch("/api/admin/invitations").then((r) =>
          readJson<AdminInvitation[]>(r),
        ),
        adminFetch("/api/admin/models").then((r) => readJson<AdminModel[]>(r)),
      ]);
      return {
        users: userList,
        invitations: invitationList,
        models: modelList,
      };
    },
    enabled: isAdmin,
  });

  const users = adminData?.users ?? [];
  const invitations = adminData?.invitations ?? [];
  const models = adminData?.models ?? [];

  React.useEffect(() => {
    if (!isAdmin) {
      void navigate({ to: "/" });
    }
  }, [isAdmin, navigate]);

  async function handleCreateInvitation() {
    const email = inviteEmail.trim();
    if (!email) return;
    setIsCreating(true);
    try {
      const result = await adminFetch("/api/admin/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role: inviteRole }),
      }).then((r) => readJson<{ token?: string; url?: string }>(r));

      const link = result.url ?? `${window.location.origin}/invite/${result.token}`;
      setCreatedLink(link);
      await refetch();
      toast.success(t("admin.invitations.createSuccess"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.invitations.createError"),
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteInvitation() {
    if (!deleteTarget) return;
    try {
      await adminFetch(`/api/admin/invitations/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
      await refetch();
      toast.success(t("admin.invitations.deleteSuccess"));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.invitations.deleteError"),
      );
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    try {
      await adminFetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    }
  }

  async function handleToggleModel(modelId: string, enabled: boolean) {
    try {
      await adminFetch(`/api/admin/models/${modelId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      // Reflect the change immediately; the refetch reconciles with the server.
      queryClient.setQueryData<AdminData>(["admin"], (current) =>
        current
          ? {
              ...current,
              models: current.models.map((m) =>
                m.id === modelId ? { ...m, enabled } : m,
              ),
            }
          : current,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("admin.shared.loadError"),
      );
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("admin.dashboard.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("admin.dashboard.description")}
        </p>

        <Tabs value={tab} onValueChange={(value) => setTab(value as AdminTab)} className="mt-6">
          <TabsList>
            <TabsTrigger value="access">
              {t("admin.dashboard.users")}
            </TabsTrigger>
            <TabsTrigger value="invitations">
              {t("admin.dashboard.invitations")}
            </TabsTrigger>
            <TabsTrigger value="models">
              {t("admin.dashboard.models")}
            </TabsTrigger>
          </TabsList>

          {/* Users */}
          <TabsContent value="access" className="mt-4 space-y-3">
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
                {users.map((user) => (
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
                      onValueChange={(value) =>
                        void handleRoleChange(user.id, String(value))
                      }
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
          </TabsContent>

          {/* Invitations */}
          <TabsContent value="invitations" className="mt-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">
                  {t("admin.dashboard.invitations")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("admin.dashboard.invitationsDescription")}
                </p>
              </div>
              <Button
                onClick={() => {
                  setInviteEmail("");
                  setInviteRole("user");
                  setCreatedLink(null);
                  setInviteOpen(true);
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
                      onClick={() => setDeleteTarget(invitation)}
                    >
                      {t("sidebar.delete")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Models */}
          <TabsContent value="models" className="mt-4 space-y-3">
            <div>
              <h2 className="font-medium">{t("admin.dashboard.models")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("admin.dashboard.modelsDescription")}
              </p>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{t("app.loading")}</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {model.displayName || model.id}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {model.provider}
                      </p>
                    </div>
                    <Switch
                      checked={model.enabled}
                      onCheckedChange={(checked) =>
                        void handleToggleModel(model.id, checked)
                      }
                      aria-label={t("admin.models.enabledForUserColumn")}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
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
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">
                {t("admin.invitations.role")}
              </Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(String(v))}>
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
                      toast.success("Copied");
                    }}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              {t("app.cancel")}
            </Button>
            <Button
              disabled={isCreating || !inviteEmail.trim()}
              onClick={() => void handleCreateInvitation()}
            >
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
        description={deleteTarget?.email}
        confirmLabel={t("app.delete")}
        destructive
        onConfirm={() => void handleDeleteInvitation()}
      />
    </div>
  );
}
