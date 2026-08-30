<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/composables/useToast";
import { getAuthAdapter } from "@/services/runtime";
import { Users, Plug2, SlidersHorizontal, Sparkles } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

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

interface PromptOverrideInfo {
  key: string;
  prompt: string;
  source: "embedded" | "override";
  updatedAt?: string;
}

type AdminAgent = {
  id: string;
  builtinId?: string;
  ownerId?: string;
  name: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  source: "builtin" | "override" | "global_custom" | "user_custom";
  createdAt?: string;
  updatedAt?: string;
};

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

// Web Search config state
interface WebSearchConfig {
  enabled: boolean;
  configured: boolean;
}

const webSearchConfig = ref<WebSearchConfig>({ enabled: false, configured: false });
const webSearchApiKey = ref("");
const originalWebSearchConfig = ref<WebSearchConfig>({ enabled: false, configured: false });
const isSavingWebSearch = ref(false);
const webSearchHasChanges = computed(() => {
  return webSearchConfig.value.enabled !== originalWebSearchConfig.value.enabled || webSearchApiKey.value.trim() !== "";
});

const adminCount = computed(
  () => users.value.filter((user) => user.role === "admin").length,
);
const pendingInvitationsCount = computed(
  () => invitations.value.filter((inv) => !inv.usedAt).length,
);
const enabledModelsCount = computed(
  () => models.value.filter((m) => m.enabled).length,
);
const activeAdminTab = ref("access");

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
    const [usersResponse, invitationsResponse, modelsResponse, providerKeysResponse, titleGenResponse, modelPresetsResponse, webSearchResponse] = await Promise.all([
      apiFetch("/api/admin/users", { signal: controller.signal }),
      apiFetch("/api/admin/invitations", { signal: controller.signal }),
      apiFetch("/api/admin/models", { signal: controller.signal }),
      apiFetch("/api/admin/provider-keys", { signal: controller.signal }),
      apiFetch("/api/admin/title-generation-policy", { signal: controller.signal }),
      apiFetch("/api/admin/model-presets", { signal: controller.signal }),
      apiFetch("/api/admin/web-search-config", { signal: controller.signal }),
    ]);

    // Handle each response independently so a single failing endpoint
    // doesn't hide all admin data (regression seen when invitations 500'd).
    let hasError = false
    async function tryParse<T>(res: Response, setter: (v: T) => void, fallback: T) {
      if (!res.ok) {
        hasError = true
        if (import.meta.env.DEV) console.warn("[admin] load failed", res.url, res.status)
        return
      }
      try {
        const data = await readPayload<T>(res)
        setter(data ?? fallback)
      } catch {
        hasError = true
      }
    }

    await tryParse<AdminUser[]>(usersResponse, v => users.value = v, [])
    await tryParse<AdminInvitation[]>(invitationsResponse, v => invitations.value = v, [])
    await tryParse<AdminModel[]>(modelsResponse, v => models.value = v, [])
    await tryParse<ProviderKeyEntry[]>(providerKeysResponse, v => providerKeys.value = v, [])

    if (titleGenResponse.ok) {
      const titleGenData = await readPayload<{ policy: TitleGenerationPolicy; catalog: CatalogModel[] }>(titleGenResponse)
      if (titleGenData) {
        titleGenPolicy.value = { ...titleGenData.policy }
        originalTitleGenPolicy.value = { ...titleGenData.policy }
        catalog.value = titleGenData.catalog ?? []
      }
    } else {
      hasError = true
    }

    if (modelPresetsResponse.ok) {
      const modelPresetsData = await readPayload<{ presets: AdminModelPreset[]; catalog: CatalogModel[] }>(modelPresetsResponse)
      if (modelPresetsData) {
        modelPresets.value = modelPresetsData.presets.map(p => ({ ...p }))
        if (modelPresetsData.catalog && catalog.value.length === 0) {
          catalog.value = modelPresetsData.catalog
        }
      }
    } else {
      hasError = true
    }

    if (webSearchResponse.ok) {
      const webSearchData = await readPayload<WebSearchConfig>(webSearchResponse)
      if (webSearchData) {
        webSearchConfig.value = { enabled: webSearchData.enabled, configured: webSearchData.configured }
        originalWebSearchConfig.value = { enabled: webSearchData.enabled, configured: webSearchData.configured }
      }
    } else {
      hasError = true
    }

    if (hasError) {
      toast(t("admin.shared.loadError"))
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      toast(t("admin.shared.loadError"))
    } else {
      toast(
        error instanceof Error ? error.message : t("admin.shared.loadError"),
      )
    }
  } finally {
    clearTimeout(timeoutId)
    isLoading.value = false
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

	// ---- E. Prompts & Agents ----


const promptOverrides = ref<Record<"base" | "title", PromptOverrideInfo>>({
  base: { key: "base", prompt: "", source: "embedded" },
  title: { key: "title", prompt: "", source: "embedded" },
});
const originalPromptOverrides = ref<Record<"base" | "title", PromptOverrideInfo>>({
  base: { key: "base", prompt: "", source: "embedded" },
  title: { key: "title", prompt: "", source: "embedded" },
});
const isSavingPrompt = ref(false);
const isResettingPrompt = ref(false);
const resetPromptKey = ref<"base" | "title" | null>(null);

function hasPromptChanges(key: "base" | "title"): boolean {
  return promptOverrides.value[key].prompt !== originalPromptOverrides.value[key].prompt;
}

const agents = ref<AdminAgent[]>([]);
const agentDialogOpen = ref(false);
const agentDialogMode = ref<"create" | "edit">("create");
const agentForm = ref<{ id: string; builtinId: string; name: string; description: string; icon: string; systemPrompt: string }>({
  id: "", builtinId: "", name: "", description: "", icon: "", systemPrompt: "",
});
const isSavingAgent = ref(false);
const deleteAgentTarget = ref<AdminAgent | null>(null);
const isDeletingAgent = ref(false);

const PROMPT_TAG_KEYS = ["{username}", "{datetime}", "{language}"] as const;

async function loadPromptsAndAgents(): Promise<void> {
  try {
    const [promptsResponse, agentsResponse] = await Promise.all([
      apiFetch("/api/admin/prompt-overrides"),
      apiFetch("/api/admin/agents"),
    ]);
    await assertOk(promptsResponse, t("admin.shared.loadError"));
    await assertOk(agentsResponse, t("admin.shared.loadError"));
    const promptsData = await readPayload<Record<string, PromptOverrideInfo>>(promptsResponse);
    if (promptsData) {
      for (const key of ["base", "title"] as const) {
        const entry = promptsData[key] ?? { key, prompt: "", source: "embedded" };
        promptOverrides.value[key] = { ...entry };
        originalPromptOverrides.value[key] = { ...entry };
      }
    }
    agents.value = (await readPayload<AdminAgent[]>(agentsResponse)) ?? [];
  } catch {
    // Non-fatal: the section simply stays empty.
  }
}

function insertPromptTag(key: "base" | "title", tag: string, event?: MouseEvent): void {
  // Chips are buttons inside a form-less card; prevent focus loss side effects.
  if (event) event.preventDefault();
  // Insert at cursor of the matching textarea by ref id.
  const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-prompt-key="${key}"]`);
  const current = promptOverrides.value[key];
  if (!el) {
    promptOverrides.value[key] = { ...current, prompt: current.prompt + tag };
    return;
  }
  const start = el.selectionStart ?? current.prompt.length;
  const end = el.selectionEnd ?? start;
  const next = current.prompt.slice(0, start) + tag + current.prompt.slice(end);
  promptOverrides.value[key] = { ...current, prompt: next };
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + tag.length, start + tag.length);
  });
}

async function handleSavePrompt(key: "base" | "title"): Promise<void> {
  if (isSavingPrompt.value) return;
  isSavingPrompt.value = true;
  try {
    const response = await apiFetch(`/api/admin/prompt-overrides/${key}`, {
      method: "PUT",
      body: JSON.stringify({ prompt: promptOverrides.value[key].prompt }),
    });
    await assertOk(response, t("admin.prompts.saveError"));
    const refreshed = await apiFetch("/api/admin/prompt-overrides");
    await assertOk(refreshed, t("admin.shared.loadError"));
    const data = await readPayload<Record<string, PromptOverrideInfo>>(refreshed);
    if (data && data[key]) {
      promptOverrides.value[key] = { ...data[key] };
      originalPromptOverrides.value[key] = { ...data[key] };
    }
    toast(t("admin.prompts.saveSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.prompts.saveError"));
  } finally {
    isSavingPrompt.value = false;
  }
}

async function handleResetPrompt(): Promise<void> {
  const key = resetPromptKey.value;
  if (!key || isResettingPrompt.value) return;
  isResettingPrompt.value = true;
  try {
    const response = await apiFetch(`/api/admin/prompt-overrides/${key}`, { method: "DELETE" });
    await assertOk(response, t("admin.prompts.resetError"));
    const refreshed = await apiFetch("/api/admin/prompt-overrides");
    await assertOk(refreshed, t("admin.shared.loadError"));
    const data = await readPayload<Record<string, PromptOverrideInfo>>(refreshed);
    if (data && data[key]) {
      promptOverrides.value[key] = { ...data[key] };
      originalPromptOverrides.value[key] = { ...data[key] };
    }
    resetPromptKey.value = null;
    toast(t("admin.prompts.resetSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.prompts.resetError"));
  } finally {
    isResettingPrompt.value = false;
  }
}

function agentSourceLabel(source: AdminAgent["source"]): string {
  if (source === "builtin") return t("admin.agents.sourceBuiltin");
  if (source === "override") return t("admin.agents.sourceOverride");
  return t("admin.agents.sourceCustom");
}

function insertAgentTag(tag: string, event?: MouseEvent): void {
  if (event) event.preventDefault();
  const el = document.querySelector<HTMLTextAreaElement>("textarea[data-agent-prompt]");
  if (!el) {
    agentForm.value.systemPrompt += tag;
    return;
  }
  const start = el.selectionStart ?? agentForm.value.systemPrompt.length;
  const end = el.selectionEnd ?? start;
  const next = agentForm.value.systemPrompt.slice(0, start) + tag + agentForm.value.systemPrompt.slice(end);
  agentForm.value.systemPrompt = next;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + tag.length, start + tag.length);
  });
}

function openCreateAgentDialog(builtinId = ""): void {
  agentDialogMode.value = "create";
  agentForm.value = { id: "", builtinId, name: "", description: "", icon: "", systemPrompt: "" };
  agentDialogOpen.value = true;
}

function openEditAgentDialog(agent: AdminAgent): void {
  agentDialogMode.value = "edit";
  agentForm.value = {
    id: agent.id,
    builtinId: agent.builtinId ?? "",
    name: agent.name,
    description: agent.description ?? "",
    icon: agent.icon ?? "",
    systemPrompt: agent.systemPrompt,
  };
  agentDialogOpen.value = true;
}

async function handleSaveAgent(): Promise<void> {
  if (isSavingAgent.value) return;
  isSavingAgent.value = true;
  try {
    const form = agentForm.value;
    const body = JSON.stringify({
      name: form.name,
      description: form.description,
      icon: form.icon,
      systemPrompt: form.systemPrompt,
    });
    let response: Response;
    if (agentDialogMode.value === "create" && form.builtinId) {
      response = await apiFetch("/api/admin/agents", {
        method: "POST",
        body: JSON.stringify({ ...JSON.parse(body), builtinId: form.builtinId }),
      });
    } else if (agentDialogMode.value === "create") {
      response = await apiFetch("/api/admin/agents", { method: "POST", body });
    } else {
      response = await apiFetch(`/api/agents/${encodeURIComponent(form.id)}`, { method: "PUT", body });
    }
    await assertOk(response, t("admin.shared.loadError"));
    agentDialogOpen.value = false;
    await loadPromptsAndAgents();
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.shared.loadError"));
  } finally {
    isSavingAgent.value = false;
  }
}

async function handleDeleteAgentConfirmed(): Promise<void> {
  const target = deleteAgentTarget.value;
  if (!target || isDeletingAgent.value) return;
  isDeletingAgent.value = true;
  try {
    const recordId = target.source === "override" || target.source === "global_custom"
      ? target.id
      : target.id;
    const response = await apiFetch(`/api/admin/agents/${encodeURIComponent(recordId)}`, { method: "DELETE" });
    await assertOk(response, t("admin.shared.loadError"));
    deleteAgentTarget.value = null;
    await loadPromptsAndAgents();
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.shared.loadError"));
  } finally {
    isDeletingAgent.value = false;
  }
}


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

// ---- Web Search config handlers ----

async function handleSaveWebSearch(): Promise<void> {
  if (isSavingWebSearch.value) return;

  isSavingWebSearch.value = true;
  try {
    const response = await apiFetch("/api/admin/web-search-config", {
      method: "PUT",
      body: JSON.stringify({
        apiKey: webSearchApiKey.value,
        enabled: webSearchConfig.value.enabled,
      }),
    });
    await assertOk(response, t("admin.webSearch.saveError"));
    originalWebSearchConfig.value = { ...webSearchConfig.value };
    webSearchApiKey.value = "";
    // Reload to get updated configured status
    const refreshedResponse = await apiFetch("/api/admin/web-search-config");
    if (refreshedResponse.ok) {
      const refreshedData = await readPayload<WebSearchConfig>(refreshedResponse);
      if (refreshedData) {
        webSearchConfig.value = { ...webSearchConfig.value, configured: refreshedData.configured };
        originalWebSearchConfig.value = { ...originalWebSearchConfig.value, configured: refreshedData.configured };
      }
    }
    toast(t("admin.webSearch.saveSuccess"), "success");
  } catch (error) {
    toast(error instanceof Error ? error.message : t("admin.webSearch.saveError"));
  } finally {
    isSavingWebSearch.value = false;
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
  void loadPromptsAndAgents();
});
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
    <div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <!-- Compact header + KPIs -->
      <div class="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold tracking-tight">{{ t('admin.dashboard.title') }}</h1>
          <p class="text-sm text-muted-foreground">{{ t('admin.dashboard.description') }}</p>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Badge variant="secondary" class="font-normal">{{ users.length }} · {{ t('admin.dashboard.users') }}</Badge>
          <Badge variant="secondary" class="font-normal">{{ pendingInvitationsCount }} {{ t('admin.invitations.statusPending') }}</Badge>
          <Badge variant="secondary" class="font-normal">{{ enabledModelsCount }}/{{ models.length }} {{ t('admin.dashboard.models') }}</Badge>
        </div>
      </div>

      <Tabs v-model="activeAdminTab" class="mt-4 gap-0">
        <div class="sticky top-0 z-10 -mx-4 border-b bg-background/80 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:mx-0 sm:rounded-lg sm:border sm:px-1">
          <TabsList class="h-8 w-full justify-start gap-1 bg-muted/60 p-1 sm:w-fit">
            <TabsTrigger value="access" class="gap-1.5 data-[state=active]:bg-background">
              <Users class="size-3.5" />
              <span class="hidden sm:inline">{{ t('admin.dashboard.users') }}</span>
              <span class="sm:hidden">{{ t('admin.dashboard.users') }}</span>
            </TabsTrigger>
            <TabsTrigger value="connections" class="gap-1.5 data-[state=active]:bg-background">
              <Plug2 class="size-3.5" />
              <span class="hidden sm:inline">{{ t('admin.providerKeys.title') }}</span>
              <span class="sm:hidden">Keys</span>
            </TabsTrigger>
            <TabsTrigger value="models" class="gap-1.5 data-[state=active]:bg-background">
              <SlidersHorizontal class="size-3.5" />
              <span class="hidden sm:inline">{{ t('admin.dashboard.models') }}</span>
              <span class="sm:hidden">{{ t('admin.dashboard.models') }}</span>
            </TabsTrigger>
            <TabsTrigger value="behavior" class="gap-1.5 data-[state=active]:bg-background">
              <Sparkles class="size-3.5" />
              <span class="hidden sm:inline">{{ t('admin.prompts.title') }} &amp; {{ t('admin.agents.title') }}</span>
              <span class="sm:hidden">Prompts</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <!-- TAB: Access -->
        <TabsContent value="access" class="space-y-5 pt-5 focus-visible:outline-none">
          <Card>
            <CardHeader class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="space-y-1">
                <CardTitle class="text-base">{{ t('admin.users.title') }}</CardTitle>
                <CardDescription>{{ t('admin.users.description') }}</CardDescription>
              </div>
              <Button size="sm" @click="openInvitationDialog">
                {{ t('admin.invitations.createTitle') }}
              </Button>
            </CardHeader>
            <CardContent class="space-y-6">
              <div class="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead class="w-[42%]">{{ t('admin.users.emailColumn') }}</TableHead>
                      <TableHead class="w-[200px]">{{ t('admin.users.roleColumn') }}</TableHead>
                      <TableHead class="w-[180px] whitespace-nowrap">{{ t('admin.users.createdAtColumn') }}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableEmpty v-if="!isLoading && users.length === 0" :colspan="3">
                      {{ t('admin.users.empty') }}
                    </TableEmpty>
                    <TableRow v-for="user in users" :key="user.id">
                      <TableCell class="font-medium max-w-0 whitespace-normal break-all align-middle" :title="user.email">{{ formatEmail(user.email) }}</TableCell>
                      <TableCell class="align-middle py-1.5">
                        <Select
                          :model-value="user.role"
                          :disabled="updatingUserId === user.id || (user.role === 'admin' && adminCount === 1)"
                          @update:model-value="handleUserRoleChange(user, $event)"
                        >
                          <SelectTrigger size="sm" class="h-8 w-[160px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">{{ t('admin.shared.roleUser') }}</SelectItem>
                            <SelectItem value="admin">{{ t('admin.shared.roleAdmin') }}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell class="whitespace-nowrap text-sm text-muted-foreground align-middle">
                        {{ formatDateTime(user.createdAt) }}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div class="space-y-3">
                <div>
                  <h3 class="text-sm font-medium">{{ t('admin.invitations.existingTitle') }}</h3>
                  <p class="text-xs text-muted-foreground">{{ t('admin.invitations.singleUseDescription') }}</p>
                </div>
                <div class="rounded-md border">
                  <Table class="min-w-[640px]">
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
                        <TableCell class="text-sm">{{ invitation.role === 'admin' ? t('admin.shared.roleAdmin') : t('admin.shared.roleUser') }}</TableCell>
                        <TableCell>
                          <Badge :variant="invitation.usedAt ? 'secondary' : 'default'" class="text-xs">
                            {{ invitation.usedAt ? t('admin.invitations.statusUsed') : t('admin.invitations.statusPending') }}
                          </Badge>
                        </TableCell>
                        <TableCell class="text-sm text-muted-foreground">
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
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- TAB: Connections -->
        <TabsContent value="connections" class="space-y-5 pt-5 focus-visible:outline-none">
          <div class="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader class="pb-3">
                <CardTitle class="text-base">{{ t('admin.providerKeys.title') }}</CardTitle>
                <CardDescription>{{ t('admin.providerKeys.description') }}</CardDescription>
              </CardHeader>
              <CardContent>
                <div class="rounded-md border">
                  <Table class="min-w-[480px]">
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
                              :class="entry.configured ? 'bg-success' : 'bg-muted-foreground/30'"
                            />
                            <span class="text-sm">
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
                          <div class="flex flex-wrap items-center gap-2">
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

            <Card>
              <CardHeader class="pb-3">
                <CardTitle class="text-base">{{ t('admin.webSearch.title') }}</CardTitle>
                <CardDescription>{{ t('admin.webSearch.description') }}</CardDescription>
              </CardHeader>
              <CardContent class="space-y-4">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    class="inline-block size-2 rounded-full"
                    :class="webSearchConfig.configured ? 'bg-success' : 'bg-muted-foreground/30'"
                  />
                  <span class="text-sm">
                    {{ webSearchConfig.configured ? t('admin.webSearch.configured') : t('admin.webSearch.notConfigured') }}
                  </span>
                  <span class="text-muted-foreground">·</span>
                  <span class="text-sm">
                    {{ webSearchConfig.enabled ? t('admin.webSearch.enabled') : t('admin.webSearch.disabled') }}
                  </span>
                </div>

                <div class="space-y-2">
                  <Label for="brave-api-key">{{ t('admin.webSearch.apiKeyLabel') }}</Label>
                  <Input
                    id="brave-api-key"
                    v-model="webSearchApiKey"
                    type="password"
                    :placeholder="t('admin.webSearch.apiKeyPlaceholder')"
                    autocomplete="off"
                  />
                </div>

                <label class="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    class="size-4 accent-primary"
                    v-model="webSearchConfig.enabled"
                  >
                  <span>{{ t('admin.webSearch.enabledLabel') }}</span>
                </label>

                <div class="flex justify-end">
                  <Button
                    size="sm"
                    :disabled="isSavingWebSearch || !webSearchHasChanges"
                    @click="handleSaveWebSearch"
                  >
                    {{ isSavingWebSearch ? t('admin.webSearch.saving') : t('admin.webSearch.saveButton') }}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- TAB: Models -->
        <TabsContent value="models" class="space-y-5 pt-5 focus-visible:outline-none">
          <div class="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader class="pb-3">
                <CardTitle class="text-base">{{ t('admin.titleGeneration.title') }}</CardTitle>
                <CardDescription>{{ t('admin.titleGeneration.description') }}</CardDescription>
              </CardHeader>
              <CardContent class="space-y-4">
                <div class="space-y-2.5">
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
                    size="sm"
                    :disabled="isSavingTitleGen || !titleGenHasChanges"
                    @click="handleSaveTitleGenPolicy"
                  >
                    {{ isSavingTitleGen ? t('admin.titleGeneration.saving') : t('admin.titleGeneration.saveButton') }}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader class="pb-3">
                <CardTitle class="text-base">{{ t('admin.modelPresets.title') }}</CardTitle>
                <CardDescription>{{ t('admin.modelPresets.description') }}</CardDescription>
              </CardHeader>
              <CardContent class="space-y-4">
                <div
                  v-for="preset in modelPresets"
                  :key="preset.presetId"
                  class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
                >
                  <Label class="text-sm font-medium sm:w-32 sm:shrink-0">{{ preset.label }}</Label>
                  <Select
                    :model-value="preset.modelId"
                    @update:model-value="(event: any) => handleModelPresetChange(preset.presetId, String(event))"
                  >
                    <SelectTrigger class="w-full sm:flex-1">
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
                    size="sm"
                    :disabled="isSavingModelPresets"
                    @click="handleSaveModelPresets"
                  >
                    {{ isSavingModelPresets ? t('admin.modelPresets.saving') : t('admin.modelPresets.saveButton') }}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader class="pb-3">
              <CardTitle class="text-base">{{ t('admin.models.title') }}</CardTitle>
              <CardDescription>{{ t('admin.models.description') }}</CardDescription>
            </CardHeader>
            <CardContent>
              <div class="rounded-md border">
                <Table class="min-w-[420px]">
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
        </TabsContent>

        <!-- TAB: Behavior -->
        <TabsContent value="behavior" class="space-y-5 pt-5 focus-visible:outline-none">
          <div class="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader class="pb-3">
                <CardTitle class="text-base">{{ t('admin.prompts.title') }}</CardTitle>
                <CardDescription>{{ t('admin.prompts.description') }}</CardDescription>
              </CardHeader>
              <CardContent class="space-y-6">
                <div
                  v-for="key in (['base', 'title'] as const)"
                  :key="key"
                  class="space-y-2"
                >
                  <div class="flex items-center justify-between gap-2">
                    <Label class="text-sm font-medium">
                      {{ key === 'base' ? t('admin.prompts.baseLabel') : t('admin.prompts.titleLabel') }}
                    </Label>
                    <Badge :variant="promptOverrides[key].source === 'override' ? 'default' : 'secondary'" class="text-xs">
                      {{
                        promptOverrides[key].source === 'override'
                          ? t('admin.prompts.sourceOverride')
                          : t('admin.prompts.sourceEmbedded')
                      }}
                    </Badge>
                  </div>
                  <Textarea
                    v-model="promptOverrides[key].prompt"
                    :data-prompt-key="key"
                    class="min-h-[140px] font-mono text-xs"
                  />
                  <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{{ t('admin.prompts.availableTags') }}:</span>
                    <button
                      v-for="tag in PROMPT_TAG_KEYS"
                      :key="tag"
                      type="button"
                      class="rounded-full border bg-muted px-2 py-0.5 font-mono hover:bg-accent"
                      @click="insertPromptTag(key, tag, $event)"
                    >
                      {{ tag }}
                    </button>
                    <span class="ms-auto">{{ t('admin.prompts.charsUsed', { used: promptOverrides[key].prompt.length, max: 20000 }) }}</span>
                  </div>
                  <div class="flex justify-end gap-2">
                    <Button
                      v-if="promptOverrides[key].source === 'override'"
                      variant="outline"
                      size="sm"
                      @click="resetPromptKey = key"
                    >
                      {{ t('admin.prompts.resetButton') }}
                    </Button>
                    <Button
                      size="sm"
                      :disabled="!hasPromptChanges(key) || isSavingPrompt || promptOverrides[key].prompt.length === 0"
                      @click="handleSavePrompt(key)"
                    >
                      {{ isSavingPrompt ? t('admin.prompts.saving') : t('admin.prompts.saveButton') }}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <CardTitle class="text-base">{{ t('admin.agents.title') }}</CardTitle>
                  <CardDescription>{{ t('admin.agents.description') }}</CardDescription>
                </div>
                <Button size="sm" @click="openCreateAgentDialog()">
                  {{ t('admin.agents.createButton') }}
                </Button>
              </CardHeader>
              <CardContent>
                <div class="rounded-md border">
                  <Table class="min-w-[420px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{{ t('admin.agents.nameLabel') }}</TableHead>
                        <TableHead class="hidden md:table-cell">{{ t('admin.agents.tableDescription') }}</TableHead>
                        <TableHead class="w-[110px]">{{ t('admin.agents.tableOrigin') }}</TableHead>
                        <TableHead class="w-[150px]">{{ t('admin.agents.tableActions') }}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableEmpty v-if="agents.length === 0" :colspan="4">
                        {{ t('admin.shared.loadError') }}
                      </TableEmpty>
                      <TableRow v-for="agent in agents" :key="agent.id + ':' + agent.source">
                        <TableCell>
                          <div class="font-medium text-sm">{{ agent.name }}</div>
                        </TableCell>
                        <TableCell class="hidden max-w-[220px] truncate text-sm md:table-cell">
                          {{ agent.description }}
                        </TableCell>
                        <TableCell>
                          <Badge :variant="agent.source === 'builtin' ? 'secondary' : agent.source === 'override' ? 'default' : 'outline'" class="text-xs">
                            {{ agentSourceLabel(agent.source) }}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div class="flex flex-wrap gap-1.5">
                            <Button
                              v-if="agent.source === 'builtin' || agent.source === 'override' || agent.source === 'global_custom'"
                              variant="outline" size="sm"
                              @click="openEditAgentDialog(agent); agentForm.builtinId = agent.builtinId ?? ''"
                            >
                              {{ t('admin.agents.editAction') }}
                            </Button>
                            <Button
                              v-if="agent.source === 'override'"
                              variant="outline" size="sm"
                              @click="deleteAgentTarget = agent"
                            >
                              {{ t('admin.agents.resetButton') }}
                            </Button>
                            <Button
                              v-if="agent.source === 'global_custom' || agent.source === 'user_custom'"
                              variant="outline" size="sm"
                              @click="deleteAgentTarget = agent"
                            >
                              {{ t('admin.agents.deleteAction') }}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>

    <!-- Dialogs (outside tabs, unchanged logic) -->
    <Dialog v-model:open="agentDialogOpen">
      <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {{ agentDialogMode === 'create' ? t('admin.agents.createTitle') : t('admin.agents.editTitle') }}
          </DialogTitle>
          <DialogDescription v-if="agentDialogMode === 'edit' && agentForm.builtinId">
            {{ t('admin.agents.builtinHint') }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="agent-name">{{ t('admin.agents.nameLabel') }}</Label>
            <Input id="agent-name" v-model="agentForm.name" maxlength="80" />
          </div>
          <div class="space-y-2">
            <Label for="agent-description">{{ t('admin.agents.descriptionLabel') }}</Label>
            <Input id="agent-description" v-model="agentForm.description" maxlength="300" />
          </div>
          <div class="space-y-2">
            <Label for="agent-icon">{{ t('admin.agents.iconLabel') }}</Label>
            <Input id="agent-icon" v-model="agentForm.icon" maxlength="40" placeholder="bot" />
          </div>
          <div class="space-y-2">
            <div class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{{ t('admin.prompts.availableTags') }}:</span>
              <button
                v-for="tag in PROMPT_TAG_KEYS"
                :key="tag"
                type="button"
                class="rounded-full border bg-muted px-2 py-0.5 font-mono hover:bg-accent"
                @click="insertAgentTag(tag, $event)"
              >
                {{ tag }}
              </button>
            </div>
            <Label for="agent-prompt">{{ t('admin.agents.promptLabel') }}</Label>
            <Textarea
              id="agent-prompt"
              v-model="agentForm.systemPrompt"
              data-agent-prompt
              class="min-h-[180px] font-mono text-xs"
              :placeholder="t('admin.agents.promptPlaceholder')"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="agentDialogOpen = false">{{ t('app.cancel') }}</Button>
          <Button :disabled="isSavingAgent || !agentForm.name || !agentForm.systemPrompt" @click="handleSaveAgent">
            {{ isSavingAgent ? t('admin.prompts.saving') : t('admin.prompts.saveButton') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="resetPromptKey !== null" @update:open="(v: boolean) => { if (!v) resetPromptKey = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('admin.prompts.resetButton') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('admin.prompts.resetConfirm') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction @click="resetPromptKey = null">{{ t('app.cancel') }}</AlertDialogAction>
          <AlertDialogAction :disabled="isResettingPrompt" @click="handleResetPrompt()">
            {{ t('admin.prompts.resetButton') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="deleteAgentTarget !== null" @update:open="(v: boolean) => { if (!v) deleteAgentTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ deleteAgentTarget?.source === 'override' ? t('admin.agents.resetButton') : t('admin.agents.deleteAction') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('admin.agents.deleteConfirm') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction @click="deleteAgentTarget = null">{{ t('app.cancel') }}</AlertDialogAction>
          <AlertDialogAction :disabled="isDeletingAgent" @click="handleDeleteAgentConfirmed()">
            {{ deleteAgentTarget?.source === 'override' ? t('admin.agents.resetButton') : t('admin.agents.deleteAction') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

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
