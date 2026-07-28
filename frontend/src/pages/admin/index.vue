<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import { getAuthAdapter } from "@/services/runtime";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type UserRole = "admin" | "user";

interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

interface AdminInvitation {
  id: string;
  email: string;
  role: UserRole;
  usedAt: string | null;
  createdAt: string;
}

interface AdminModel {
  id: string;
  provider: string;
  displayName: string;
  enabled: boolean;
}

const { t } = useI18n();
const { toast } = useToast();
const auth = await getAuthAdapter();

const users = ref<AdminUser[]>([]);
const invitations = ref<AdminInvitation[]>([]);
const models = ref<AdminModel[]>([]);
const isLoading = ref(true);

const isInviteDialogOpen = ref(false);
const inviteEmail = ref("");
const inviteRole = ref<UserRole>("user");
const createdInvitationUrl = ref("");
const createdInvitationEmail = ref("");
const createdInvitationRole = ref<UserRole>("user");
const inviteError = ref("");
const isCreatingInvitation = ref(false);
const isSendingInvitationEmail = ref(false);

const updatingUserId = ref<string | null>(null);
const updatingModelId = ref<string | null>(null);
const deletingInvitationId = ref<string | null>(null);

const adminCount = computed(
  () => users.value.filter((user) => user.role === "admin").length,
);

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(await auth.getAuthorizationHeaders()),
      ...(init?.headers ?? {}),
    },
  });
}

async function readPayload<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

async function assertOk(response: Response, fallbackMessage: string): Promise<void> {
  if (response.ok) return;
  const payload = await readPayload<{ message?: string }>(response);
  throw new Error(payload?.message || fallbackMessage);
}

async function loadData(): Promise<void> {
  isLoading.value = true;
  try {
    const [usersResponse, invitationsResponse, modelsResponse] = await Promise.all([
      apiFetch("/api/admin/users"),
      apiFetch("/api/admin/invitations"),
      apiFetch("/api/admin/models"),
    ]);

    await assertOk(usersResponse, t("admin.shared.loadError"));
    await assertOk(invitationsResponse, t("admin.shared.loadError"));
    await assertOk(modelsResponse, t("admin.shared.loadError"));

    users.value = (await readPayload<AdminUser[]>(usersResponse)) ?? [];
    invitations.value =
      (await readPayload<AdminInvitation[]>(invitationsResponse)) ?? [];
    models.value = (await readPayload<AdminModel[]>(modelsResponse)) ?? [];
  } catch (error) {
    toast(
      error instanceof Error ? error.message : t("admin.shared.loadError"),
    );
  } finally {
    isLoading.value = false;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function resetInvitationForm(): void {
  inviteEmail.value = "";
  inviteRole.value = "user";
  createdInvitationUrl.value = "";
  createdInvitationEmail.value = "";
  createdInvitationRole.value = "user";
  inviteError.value = "";
  isSendingInvitationEmail.value = false;
}

function openInvitationDialog(): void {
  resetInvitationForm();
  isInviteDialogOpen.value = true;
}

async function handleCreateInvitation(): Promise<void> {
  if (isCreatingInvitation.value) return;

  isCreatingInvitation.value = true;
  inviteError.value = "";
  createdInvitationUrl.value = "";

  try {
    const response = await apiFetch("/api/admin/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: inviteEmail.value,
        role: inviteRole.value,
      }),
    });

    const payload = await readPayload<{ invitationUrl?: string; message?: string }>(
      response,
    );
    if (!response.ok) {
      throw new Error(payload?.message || t("admin.invitations.createError"));
    }

    createdInvitationUrl.value = payload?.invitationUrl ?? "";
    createdInvitationEmail.value = inviteEmail.value.trim().toLowerCase();
    createdInvitationRole.value = inviteRole.value;
    inviteEmail.value = "";
    await loadData();
    toast(t("admin.invitations.createSuccess"), "success");
  } catch (error) {
    inviteError.value =
      error instanceof Error ? error.message : t("admin.invitations.createError");
  } finally {
    isCreatingInvitation.value = false;
  }
}

async function handleCopyInvitationUrl(): Promise<void> {
  if (!createdInvitationUrl.value) return;

  try {
    await navigator.clipboard.writeText(createdInvitationUrl.value);
    toast(t("message.copied"), "success");
  } catch {
    toast(t("admin.invitations.copyError"));
  }
}

async function handleSendInvitationEmail(): Promise<void> {
  if (
    isSendingInvitationEmail.value ||
    !createdInvitationUrl.value ||
    !createdInvitationEmail.value
  ) {
    return;
  }

  isSendingInvitationEmail.value = true;
  inviteError.value = "";

  try {
    const response = await apiFetch("/api/admin/invitations/send", {
      method: "POST",
      body: JSON.stringify({
        email: createdInvitationEmail.value,
        invitationUrl: createdInvitationUrl.value,
        role: createdInvitationRole.value,
      }),
    });

    await assertOk(response, t("admin.invitations.sendError"));
    toast(t("admin.invitations.sendSuccess"), "success");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t("admin.invitations.sendError");
    toast(message);
  } finally {
    isSendingInvitationEmail.value = false;
  }
}

async function handleUserRoleChange(
  user: AdminUser,
  nextRole: unknown,
): Promise<void> {
  if (updatingUserId.value || nextRole === user.role) return;
  if (nextRole !== "admin" && nextRole !== "user") return;

  updatingUserId.value = user.id;
  try {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ role: nextRole }),
    });
    await assertOk(response, t("admin.users.updateError"));
    await loadData();
    toast(t("admin.users.updateSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.users.updateError"));
  } finally {
    updatingUserId.value = null;
  }
}

async function handleDeleteInvitation(invitationId: string): Promise<void> {
  if (deletingInvitationId.value) return;

  deletingInvitationId.value = invitationId;
  try {
    const response = await apiFetch(
      `/api/admin/invitations/${encodeURIComponent(invitationId)}`,
      { method: "DELETE" },
    );
    await assertOk(response, t("admin.invitations.deleteError"));
    invitations.value = invitations.value.filter(
      (invitation) => invitation.id !== invitationId,
    );
    toast(t("admin.invitations.deleteSuccess"), "success");
  } catch (error) {
    toast(
      error instanceof Error ? error.message : t("admin.invitations.deleteError"),
    );
  } finally {
    deletingInvitationId.value = null;
  }
}

async function handleModelToggle(model: AdminModel, event: Event): Promise<void> {
  const checked = (event.target as HTMLInputElement).checked;
  if (updatingModelId.value || checked === model.enabled) return;

  const previousEnabled = model.enabled;
  model.enabled = checked;
  updatingModelId.value = model.id;
  try {
    const response = await apiFetch(`/api/admin/models/${encodeURIComponent(model.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: checked }),
    });
    await assertOk(response, t("admin.models.updateError"));
    toast(t("admin.models.updateSuccess"), "success");
  } catch (error) {
    model.enabled = previousEnabled;
    toast(error instanceof Error ? error.message : t("admin.models.updateError"));
  } finally {
    updatingModelId.value = null;
  }
}

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="space-y-6 p-6">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('admin.dashboard.title') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ t('admin.dashboard.description') }}
        </p>
      </div>

      <Card>
        <CardHeader class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div class="space-y-1">
            <CardTitle>{{ t('admin.users.title') }}</CardTitle>
            <p class="text-sm text-muted-foreground">
              {{ t('admin.users.description') }}
            </p>
          </div>
          <Button @click="openInvitationDialog">
            {{ t('admin.invitations.createTitle') }}
          </Button>
        </CardHeader>
        <CardContent class="space-y-6">
          <div class="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('admin.users.emailColumn') }}</TableHead>
                  <TableHead>{{ t('admin.users.roleColumn') }}</TableHead>
                  <TableHead>{{ t('admin.users.createdAtColumn') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableEmpty v-if="!isLoading && users.length === 0" :colspan="3">
                  {{ t('admin.users.empty') }}
                </TableEmpty>
                <TableRow v-for="user in users" :key="user.id">
                  <TableCell class="font-medium">{{ user.email }}</TableCell>
                  <TableCell>
                    <Select
                      :model-value="user.role"
                      :disabled="updatingUserId === user.id || (user.role === 'admin' && adminCount === 1)"
                      @update:model-value="handleUserRoleChange(user, $event)"
                    >
                      <SelectTrigger class="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">{{ t('admin.shared.roleUser') }}</SelectItem>
                        <SelectItem value="admin">{{ t('admin.shared.roleAdmin') }}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p
                      v-if="user.role === 'admin' && adminCount === 1"
                      class="mt-2 text-xs text-muted-foreground"
                    >
                      {{ t('admin.users.lastAdminHint') }}
                    </p>
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    {{ formatDateTime(user.createdAt) }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div class="space-y-2">
            <h3 class="text-sm font-medium">{{ t('admin.invitations.existingTitle') }}</h3>
            <p class="text-sm text-muted-foreground">
              {{ t('admin.invitations.singleUseDescription') }}
            </p>
          </div>

          <div class="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('admin.invitations.emailColumn') }}</TableHead>
                  <TableHead>{{ t('admin.invitations.roleColumn') }}</TableHead>
                  <TableHead>{{ t('admin.invitations.statusColumn') }}</TableHead>
                  <TableHead>{{ t('admin.invitations.createdAtColumn') }}</TableHead>
                  <TableHead class="w-[120px] text-right">{{ t('admin.invitations.actionsColumn') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableEmpty v-if="!isLoading && invitations.length === 0" :colspan="5">
                  {{ t('admin.invitations.noInvitations') }}
                </TableEmpty>
                <TableRow v-for="invitation in invitations" :key="invitation.id">
                  <TableCell class="font-medium">{{ invitation.email }}</TableCell>
                  <TableCell>{{ invitation.role === 'admin' ? t('admin.shared.roleAdmin') : t('admin.shared.roleUser') }}</TableCell>
                  <TableCell>
                    {{ invitation.usedAt ? t('admin.invitations.statusUsed') : t('admin.invitations.statusPending') }}
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    {{ formatDateTime(invitation.createdAt) }}
                  </TableCell>
                  <TableCell class="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      :disabled="deletingInvitationId === invitation.id"
                      @click="handleDeleteInvitation(invitation.id)"
                    >
                      {{ deletingInvitationId === invitation.id ? t('admin.shared.deleting') : t('app.delete') }}
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>{{ t('admin.models.title') }}</CardTitle>
          <p class="text-sm text-muted-foreground">
            {{ t('admin.models.description') }}
          </p>
        </CardHeader>
        <CardContent>
          <div class="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('admin.models.modelColumn') }}</TableHead>
                  <TableHead class="w-[180px]">{{ t('admin.models.enabledForUserColumn') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableEmpty v-if="!isLoading && models.length === 0" :colspan="2">
                  {{ t('admin.models.empty') }}
                </TableEmpty>
                <TableRow v-for="model in models" :key="model.id">
                  <TableCell>
                    <div class="font-medium">{{ model.displayName }}</div>
                    <div class="text-sm text-muted-foreground">
                      {{ model.provider }} · {{ model.id }}
                    </div>
                  </TableCell>
                  <TableCell>
                    <label class="flex items-center gap-3 text-sm">
                      <input
                        role="checkbox"
                        type="checkbox"
                        class="size-4 accent-primary"
                        :checked="model.enabled"
                        :disabled="updatingModelId === model.id"
                        @change="handleModelToggle(model, $event)"
                      >
                      <span>
                        {{ model.enabled ? t('admin.models.enabledLabel') : t('admin.models.disabledLabel') }}
                      </span>
                    </label>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog v-model:open="isInviteDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('admin.invitations.createTitle') }}</DialogTitle>
          <DialogDescription>
            {{ t('admin.invitations.singleUseDescription') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="invite-email">{{ t('admin.invitations.email') }}</Label>
            <Input id="invite-email" v-model="inviteEmail" type="email" />
          </div>

          <div class="space-y-2">
            <Label for="invite-role">{{ t('admin.invitations.role') }}</Label>
            <Select v-model="inviteRole">
              <SelectTrigger id="invite-role" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{{ t('admin.shared.roleUser') }}</SelectItem>
                <SelectItem value="admin">{{ t('admin.shared.roleAdmin') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div v-if="createdInvitationUrl" class="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <p class="break-all">{{ createdInvitationUrl }}</p>
            <div class="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" @click="handleCopyInvitationUrl">
                {{ t('message.copy') }}
              </Button>
              <Button size="sm" :disabled="isSendingInvitationEmail" @click="handleSendInvitationEmail">
                {{ isSendingInvitationEmail ? t('admin.invitations.sending') : t('admin.invitations.sendButton') }}
              </Button>
            </div>
          </div>
          <p v-if="inviteError" class="text-sm text-destructive">{{ inviteError }}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="isInviteDialogOpen = false">
            {{ t('app.cancel') }}
          </Button>
          <Button :disabled="isCreatingInvitation" @click="handleCreateInvitation">
            {{ isCreatingInvitation ? t('admin.invitations.creating') : t('admin.invitations.createButton') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
