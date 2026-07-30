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

interface ProviderKeyEntry {
  provider: string;
  label: string;
  configured: boolean;
  updatedAt: string | null;
}

interface CatalogModel {
  id: string;
  provider: string;
  displayName: string;
}

interface TitleGenerationPolicy {
  mode: "chat_model" | "custom";
  modelId: string;
}

interface AdminModelPreset {
  presetId: string;
  modelId: string;
  label: string;
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

// Provider key state
const providerKeys = ref<ProviderKeyEntry[]>([]);
const isProviderKeyDialogOpen = ref(false);
const editingProviderKey = ref<ProviderKeyEntry | null>(null);
const providerKeyValue = ref("");
const isSavingProviderKey = ref(false);
const isDeletingProviderKey = ref(false);

// Title generation policy state
const catalog = ref<CatalogModel[]>([]);
const titleGenPolicy = ref<TitleGenerationPolicy>({ mode: "chat_model", modelId: "" });
const originalTitleGenPolicy = ref<TitleGenerationPolicy>({ mode: "chat_model", modelId: "" });
const isSavingTitleGen = ref(false);

// Model preset state
const modelPresets = ref<AdminModelPreset[]>([]);
const isSavingModelPresets = ref(false);

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
	    const [usersResponse, invitationsResponse, modelsResponse, providerKeysResponse, titleGenResponse, modelPresetsResponse] = await Promise.all([
	      apiFetch("/api/admin/users", { signal: controller.signal }),
	      apiFetch("/api/admin/invitations", { signal: controller.signal }),
	      apiFetch("/api/admin/models", { signal: controller.signal }),
	      apiFetch("/api/admin/provider-keys", { signal: controller.signal }),
	      apiFetch("/api/admin/title-generation-policy", { signal: controller.signal }),
	      apiFetch("/api/admin/model-presets", { signal: controller.signal }),
	    ]);
		
	    await assertOk(usersResponse, t("admin.shared.loadError"));
	    await assertOk(invitationsResponse, t("admin.shared.loadError"));
	    await assertOk(modelsResponse, t("admin.shared.loadError"));
	    await assertOk(providerKeysResponse, t("admin.shared.loadError"));
	    await assertOk(titleGenResponse, t("admin.shared.loadError"));
	    await assertOk(modelPresetsResponse, t("admin.shared.loadError"));

	    users.value = (await readPayload<AdminUser[]>(usersResponse)) ?? [];
	    invitations.value =
	      (await readPayload<AdminInvitation[]>(invitationsResponse)) ?? [];
	    models.value = (await readPayload<AdminModel[]>(modelsResponse)) ?? [];
	    providerKeys.value =
	      (await readPayload<ProviderKeyEntry[]>(providerKeysResponse)) ?? [];

	    const titleGenData = await readPayload<{ policy: TitleGenerationPolicy; catalog: CatalogModel[] }>(titleGenResponse);
	    if (titleGenData) {
	      titleGenPolicy.value = { ...titleGenData.policy };
	      originalTitleGenPolicy.value = { ...titleGenData.policy };
	      catalog.value = titleGenData.catalog ?? [];
	    }

	    const modelPresetsData = await readPayload<{ presets: AdminModelPreset[]; catalog: CatalogModel[] }>(modelPresetsResponse);
	    if (modelPresetsData) {
	      modelPresets.value = modelPresetsData.presets.map(p => ({ ...p }));
	      // Merge catalog if title gen didn't already populate it
	      if (modelPresetsData.catalog && catalog.value.length === 0) {
	        catalog.value = modelPresetsData.catalog;
	      }
	    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      toast(t("admin.shared.loadError"));
    } else {
      toast(
        error instanceof Error ? error.message : t("admin.shared.loadError"),
      );
    }
  } finally {
    clearTimeout(timeoutId);
    isLoading.value = false;
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatEmail(email: string): string {
  if (email.length <= 50) return email;
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) return email.substring(0, 47) + "...";
  const localPart = email.substring(0, atIndex);
  const domain = email.substring(atIndex);
  const maxLocalLength = 50 - domain.length - 3;
  if (maxLocalLength < 3) return email.substring(0, 47) + "...";
  return localPart.substring(0, maxLocalLength) + "..." + domain;
}

// ---- Provider key handlers ----

function openProviderKeyDialog(entry: ProviderKeyEntry): void {
  editingProviderKey.value = entry;
  providerKeyValue.value = "";
  isProviderKeyDialogOpen.value = true;
}

async function handleSaveProviderKey(): Promise<void> {
  if (isSavingProviderKey.value || !editingProviderKey.value) return;

  isSavingProviderKey.value = true;
  try {
    const response = await apiFetch(
      `/api/admin/provider-keys/${encodeURIComponent(editingProviderKey.value.provider)}`,
      {
        method: "PUT",
        body: JSON.stringify({ apiKey: providerKeyValue.value }),
      },
    );
    await assertOk(response, t("admin.providerKeys.saveError"));
    isProviderKeyDialogOpen.value = false;
    await loadData();
    toast(t("admin.providerKeys.saveSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.providerKeys.saveError"));
  } finally {
    isSavingProviderKey.value = false;
  }
}

async function handleDeleteProviderKey(entry: ProviderKeyEntry): Promise<void> {
  if (isDeletingProviderKey.value) return;

  isDeletingProviderKey.value = true;
  try {
    const response = await apiFetch(
      `/api/admin/provider-keys/${encodeURIComponent(entry.provider)}`,
      { method: "DELETE" },
    );
    await assertOk(response, t("admin.providerKeys.deleteError"));
    await loadData();
    toast(t("admin.providerKeys.deleteSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.providerKeys.deleteError"));
  } finally {
    isDeletingProviderKey.value = false;
  }
}

	// ---- Title generation policy handlers ----

const titleGenHasChanges = computed(() => {
  return titleGenPolicy.value.mode !== originalTitleGenPolicy.value.mode ||
    (titleGenPolicy.value.mode === "custom" && titleGenPolicy.value.modelId !== originalTitleGenPolicy.value.modelId);
});

function handleTitleGenModelChange(value: any) {
  titleGenPolicy.value.modelId = typeof value === "string" ? value : "";
}

async function handleSaveTitleGenPolicy(): Promise<void> {
  if (isSavingTitleGen.value) return;

  isSavingTitleGen.value = true;
  try {
    const response = await apiFetch("/api/admin/title-generation-policy", {
      method: "PUT",
      body: JSON.stringify({
        mode: titleGenPolicy.value.mode,
        modelId: titleGenPolicy.value.modelId,
      }),
    });
    await assertOk(response, t("admin.titleGeneration.saveError"));
    originalTitleGenPolicy.value = { ...titleGenPolicy.value };
    toast(t("admin.titleGeneration.saveSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.titleGeneration.saveError"));
  } finally {
    isSavingTitleGen.value = false;
  }
}

// ---- Model preset handlers ----

function handleModelPresetChange(presetId: string, modelId: string) {
  const idx = modelPresets.value.findIndex(p => p.presetId === presetId);
  if (idx !== -1 && modelPresets.value[idx]) {
    (modelPresets.value[idx] as AdminModelPreset).modelId = modelId;
  }
}

async function handleSaveModelPresets(): Promise<void> {
  if (isSavingModelPresets.value) return;

  isSavingModelPresets.value = true;
  try {
    for (const preset of modelPresets.value) {
      const response = await apiFetch(`/api/admin/model-presets/${encodeURIComponent(preset.presetId)}`, {
        method: "PUT",
        body: JSON.stringify({ modelId: preset.modelId }),
      });
      await assertOk(response, t("admin.modelPresets.saveError"));
    }
    toast(t("admin.modelPresets.saveSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.modelPresets.saveError"));
  } finally {
    isSavingModelPresets.value = false;
  }
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

  const email = inviteEmail.value.trim();
  if (!email) {
    inviteError.value = "Email is required";
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    inviteError.value = "Please enter a valid email address";
    return;
  }

  isCreatingInvitation.value = true;
  inviteError.value = "";
  createdInvitationUrl.value = "";

  try {
    const response = await apiFetch("/api/admin/invitations", {
      method: "POST",
      body: JSON.stringify({
        email,
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
    createdInvitationEmail.value = email.toLowerCase();
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

  const text = createdInvitationUrl.value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for non-secure contexts where the Clipboard API is unavailable
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (!copied) throw new Error("copy command failed");
    }
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
  <div class="min-h-0 flex-1 overflow-y-auto overflow-hidden" aria-live="polite">
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
                  <TableCell class="font-medium max-w-0 break-words" :title="user.email">{{ formatEmail(user.email) }}</TableCell>
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
                  <TableCell class="font-medium max-w-0 break-words" :title="invitation.email">{{ formatEmail(invitation.email) }}</TableCell>
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

      <!-- Provider API Keys -->
      <Card>
        <CardHeader>
          <CardTitle>{{ t('admin.providerKeys.title') }}</CardTitle>
          <p class="text-sm text-muted-foreground">
            {{ t('admin.providerKeys.description') }}
          </p>
        </CardHeader>
        <CardContent>
          <div class="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('admin.providerKeys.providerColumn') }}</TableHead>
                  <TableHead>{{ t('admin.providerKeys.statusColumn') }}</TableHead>
                  <TableHead class="w-[200px]">{{ t('admin.providerKeys.actionsColumn') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableEmpty v-if="!isLoading && providerKeys.length === 0" :colspan="3">
                  {{ t('admin.providerKeys.noKeys') }}
                </TableEmpty>
                <TableRow v-for="entry in providerKeys" :key="entry.provider">
                  <TableCell class="font-medium break-words">{{ entry.label }}</TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-block size-2 rounded-full"
                        :class="entry.configured ? 'bg-emerald-500' : 'bg-muted-foreground/30'"
                      />
                      <span class="break-words">
                        {{ entry.configured ? t('admin.providerKeys.statusConfigured') : t('admin.providerKeys.statusNotConfigured') }}
                      </span>
                    </div>
                    <p
                      v-if="entry.configured && entry.updatedAt"
                      class="mt-1 text-xs text-muted-foreground"
                    >
                      {{ t('admin.providerKeys.updatedAt') }}: {{ formatDateTime(entry.updatedAt) }}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div class="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        @click="openProviderKeyDialog(entry)"
                      >
                        {{ entry.configured ? t('app.save') : t('admin.providerKeys.saveButton') }}
                      </Button>
                      <Button
                        v-if="entry.configured"
                        variant="outline"
                        size="sm"
                        :disabled="isDeletingProviderKey"
                        @click="handleDeleteProviderKey(entry)"
                      >
                        {{ t('admin.providerKeys.deleteButton') }}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

	      <Separator />

	      <!-- Title Generation Policy -->
	      <Card>
	        <CardHeader>
	          <CardTitle>{{ t('admin.titleGeneration.title') }}</CardTitle>
	          <p class="text-sm text-muted-foreground">
	            {{ t('admin.titleGeneration.description') }}
	          </p>
	        </CardHeader>
	        <CardContent class="space-y-4">
	          <div class="space-y-3">
	            <label class="flex items-center gap-3 text-sm">
	              <input
	                type="radio"
	                name="titleGenMode"
	                value="chat_model"
	                class="size-4 accent-primary"
	                :checked="titleGenPolicy.mode === 'chat_model'"
	                @change="titleGenPolicy.mode = 'chat_model'"
	              />
	              <span>{{ t('admin.titleGeneration.modeChatModel') }}</span>
	            </label>
	            <label class="flex items-center gap-3 text-sm">
	              <input
	                type="radio"
	                name="titleGenMode"
	                value="custom"
	                class="size-4 accent-primary"
	                :checked="titleGenPolicy.mode === 'custom'"
	                @change="titleGenPolicy.mode = 'custom'"
	              />
	              <span>{{ t('admin.titleGeneration.modeCustom') }}</span>
	            </label>
	          </div>

	          <div v-if="titleGenPolicy.mode === 'custom'" class="space-y-2">
	            <Label for="titleGenModel">{{ t('admin.titleGeneration.modelLabel') }}</Label>
	            <Select
	              :model-value="titleGenPolicy.modelId"
	@update:model-value="($event) => handleTitleGenModelChange($event)"
	            >
	              <SelectTrigger id="titleGenModel" class="w-full">
	                <SelectValue :placeholder="t('admin.titleGeneration.modelPlaceholder')" />
	              </SelectTrigger>
	              <SelectContent>
	                <SelectItem
	                  v-for="model in catalog"
	                  :key="model.id"
	                  :value="model.id"
	                >
	                  {{ model.displayName }}
	                  <span class="text-muted-foreground">&middot; {{ model.provider }}</span>
	                </SelectItem>
	              </SelectContent>
	            </Select>
	          </div>

	          <div class="flex justify-end">
	            <Button
	              :disabled="isSavingTitleGen || !titleGenHasChanges"
	              @click="handleSaveTitleGenPolicy"
	            >
	              {{ isSavingTitleGen ? t('admin.titleGeneration.saving') : t('admin.titleGeneration.saveButton') }}
	            </Button>
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
                    <div class="text-sm text-muted-foreground break-words">
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

	      <Separator />

	      <Card>
	        <CardHeader>
	          <CardTitle>{{ t('admin.modelPresets.title') }}</CardTitle>
	          <p class="text-sm text-muted-foreground">
	            {{ t('admin.modelPresets.description') }}
	          </p>
	        </CardHeader>
	        <CardContent class="space-y-4">
	          <div v-for="preset in modelPresets" :key="preset.presetId" class="flex items-center gap-4">
	            <Label class="w-40 shrink-0 text-sm font-medium">{{ preset.label }}</Label>
	            <Select
	              :model-value="preset.modelId"
	              @update:model-value="(event: any) => handleModelPresetChange(preset.presetId, String(event))"
	            >
	              <SelectTrigger class="w-full">
	                <SelectValue :placeholder="t('admin.modelPresets.modelPlaceholder')" />
	              </SelectTrigger>
	              <SelectContent>
	                <SelectItem
	                  v-for="m in catalog"
	                  :key="m.id"
	                  :value="m.id"
	                >
	                  {{ m.displayName }}
	                  <span class="text-muted-foreground">&middot; {{ m.provider }}</span>
	                </SelectItem>
	              </SelectContent>
	            </Select>
	          </div>
	          <div class="flex justify-end">
	            <Button
	              :disabled="isSavingModelPresets"
	              @click="handleSaveModelPresets"
	            >
	              {{ isSavingModelPresets ? t('admin.modelPresets.saving') : t('admin.modelPresets.saveButton') }}
	            </Button>
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
            <p class="break-all break-words">{{ createdInvitationUrl }}</p>
            <div class="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" @click="handleCopyInvitationUrl">
                {{ t('message.copy') }}
              </Button>
              <Button size="sm" :disabled="isSendingInvitationEmail" @click="handleSendInvitationEmail">
                {{ isSendingInvitationEmail ? t('admin.invitations.sending') : t('admin.invitations.sendButton') }}
              </Button>
            </div>
          </div>
          <p v-if="inviteError" role="alert" class="text-sm text-destructive">{{ inviteError }}</p>
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

    <Dialog v-model:open="isProviderKeyDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('admin.providerKeys.modifyTitle') }}</DialogTitle>
          <DialogDescription>
            {{ editingProviderKey?.label }} — {{ t('admin.providerKeys.keyHint') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="api-key-input">{{ t('admin.providerKeys.keyLabel') }}</Label>
            <Input
              id="api-key-input"
              v-model="providerKeyValue"
              type="password"
              :placeholder="t('admin.providerKeys.keyPlaceholder')"
              autocomplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="isProviderKeyDialogOpen = false">
            {{ t('app.cancel') }}
          </Button>
          <Button :disabled="isSavingProviderKey || !providerKeyValue.trim()" @click="handleSaveProviderKey">
            {{ isSavingProviderKey ? t('admin.providerKeys.saving') : t('admin.providerKeys.saveButton') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
