<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { APP_NAME } from "@/app/config";
import AuthShell from "@/components/auth/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthAdapter } from "@/services/runtime";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const auth = await getAuthAdapter();

const token = computed(() => String(route.params.token || ""));
const invitation = ref<null | {
  valid: boolean;
  email?: string;
  role?: string;
  modelIds?: string[];
}>(null);
const password = ref("");
const confirmPassword = ref("");
const error = ref("");
const success = ref("");
const isSubmitting = ref(false);
const isLoading = ref(false);
const loadError = ref("");

// Per-field validation errors for aria-invalid bindings
const fieldErrors = ref<{ password?: string; confirmPassword?: string }>({});

// Clear field-level errors as the user starts typing
watch(password, () => {
  if (fieldErrors.value.password) {
    fieldErrors.value = { ...fieldErrors.value, password: undefined };
  }
});
watch(confirmPassword, () => {
  if (fieldErrors.value.confirmPassword) {
    fieldErrors.value = { ...fieldErrors.value, confirmPassword: undefined };
  }
});

// Abort controller management
let currentController: AbortController | null = null;

async function loadInvitation() {
  error.value = "";
  loadError.value = "";
  success.value = "";
  invitation.value = null;
  isLoading.value = true;

  // Abort any in-flight request before starting a new one
  if (currentController) {
    currentController.abort();
  }

  const controller = new AbortController();
  currentController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("/api/invitations/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.value }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(
        typeof payload?.message === "string"
          ? payload.message
          : t("auth.invite.loadError"),
      );
    }

    invitation.value = await response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      loadError.value = t("auth.invite.requestTimedOut");
    } else {
      loadError.value =
        err instanceof Error ? err.message : t("auth.invite.loadError");
    }
  } finally {
    clearTimeout(timeoutId);
    if (currentController === controller) {
      currentController = null;
    }
    isLoading.value = false;
  }
}

onUnmounted(() => {
  if (currentController) {
    currentController.abort();
    currentController = null;
  }
});

watch(
  token,
  () => {
    void loadInvitation();
  },
  { immediate: true },
);

async function handleAccept() {
  if (isSubmitting.value) {
    return;
  }

  fieldErrors.value = {};
  error.value = "";
  success.value = "";

  // Empty field checks before touching password rules
  if (!password.value.trim()) {
    fieldErrors.value = { password: "required" };
    error.value = t("auth.invite.passwordRequired");
    return;
  }

  if (!confirmPassword.value.trim()) {
    fieldErrors.value = { confirmPassword: "required" };
    error.value = t("auth.invite.confirmPasswordRequired");
    return;
  }

  if (password.value.length < 8) {
    fieldErrors.value = { password: "minlength" };
    error.value = t("auth.invite.passwordMinLength");
    return;
  }

  if (password.value !== confirmPassword.value) {
    fieldErrors.value = { confirmPassword: "mismatch" };
    error.value = t("auth.invite.passwordsDoNotMatch");
    return;
  }

  isSubmitting.value = true;
  error.value = "";
  success.value = "";

  try {
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.value, password: password.value }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof payload?.message === "string"
          ? payload.message
          : t("auth.invite.error"),
      );
    }

    if (invitation.value?.email) {
      await auth.login(invitation.value.email, password.value);
    }
    success.value = t("auth.invite.success");
    await router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.invite.error");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <AuthShell
    :image-alt="t('auth.login.heroAlt')"
    image-src="/auth/login-hero.png"
  >
    <div class="space-y-7 overflow-hidden">
      <div class="space-y-2 text-center md:text-left">
        <p
          class="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground"
        >
          Keryx
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          {{ t("auth.invite.title") }}
        </h1>
        <p class="text-sm text-muted-foreground">
          {{ t("auth.invite.subtitle", { appName: APP_NAME }) }}
        </p>
      </div>

      <div class="space-y-4 overflow-hidden">
        <!-- 7. Loading skeleton / shimmer -->
        <div
          v-if="isLoading"
          class="space-y-4"
          aria-label="Loading invitation"
          role="status"
        >
          <div class="h-28 animate-pulse rounded-2xl bg-muted/40" />
          <div class="h-10 animate-pulse rounded-lg bg-muted/40" />
          <div class="h-10 animate-pulse rounded-lg bg-muted/40" />
          <div class="h-10 animate-pulse rounded-lg bg-muted/40" />
          <span class="sr-only">{{ t("auth.invite.loadingInvitation") }}</span>
        </div>

        <!-- 9. Validate API failure (network error / timeout) -->
        <template v-else-if="loadError">
          <p class="break-words text-sm text-destructive" role="alert">
            {{ loadError }}
          </p>
          <Button
            variant="outline"
            class="w-full"
            @click="router.push('/login')"
          >
            {{ t("auth.invite.backToLogin") }}
          </Button>
        </template>

        <!-- Valid invitation – show form -->
        <template v-else-if="invitation?.valid">
          <!-- 5. break-words on info card -->
          <div
            class="break-words rounded-2xl border bg-muted/40 p-4 text-sm leading-6"
          >
            <p>
              <strong>{{ t("auth.invite.emailLabel") }}:</strong>
              {{ invitation.email }}
            </p>
            <p>
              <strong>{{ t("auth.invite.roleLabel") }}:</strong>
              {{ invitation.role }}
            </p>
            <p>
              <strong>{{ t("auth.invite.singleUseLabel") }}:</strong>
              {{ t("auth.invite.singleUseValue") }}
            </p>
          </div>

          <div class="space-y-2">
            <Label for="password">{{
              t("auth.invite.password")
            }}</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.password || undefined"
            />
          </div>

          <div class="space-y-2">
            <Label for="confirm-password">{{
              t("auth.invite.confirmPassword")
            }}</Label>
            <Input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              :disabled="isSubmitting"
              :aria-invalid="!!fieldErrors.confirmPassword || undefined"
              @keydown.enter="handleAccept"
            />
          </div>

          <!-- 1. role="alert", 5. break-words -->
          <p v-if="error" class="break-words text-sm text-destructive" role="alert">
            {{ error }}
          </p>
          <p v-if="success" class="break-words text-sm text-green-600" role="alert">
            {{ success }}
          </p>

          <Button
            class="w-full"
            :disabled="isSubmitting"
            @click="handleAccept"
          >
            {{
              isSubmitting
                ? t("auth.invite.creatingAccount")
                : t("auth.invite.createAccount")
            }}
          </Button>
        </template>

        <!-- Invalid / expired invitation -->
        <template v-else-if="invitation">
          <p class="break-words text-sm text-destructive" role="alert">
            {{ t("auth.invite.invalidInvitation") }}
          </p>
          <Button
            variant="outline"
            class="w-full"
            @click="router.push('/login')"
          >
            {{ t("auth.invite.backToLogin") }}
          </Button>
        </template>
      </div>
    </div>
  </AuthShell>
</template>