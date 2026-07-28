<script setup lang="ts">
import { computed, ref, watch } from "vue";
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

async function loadInvitation() {
  error.value = "";
  success.value = "";
  invitation.value = null;

  const response = await fetch("/api/invitations/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: token.value }),
  });

  invitation.value = await response.json();
}

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

  if (password.value.length < 8) {
    error.value = t("auth.invite.passwordMinLength");
    return;
  }

  if (password.value !== confirmPassword.value) {
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
        typeof payload?.message === "string" ? payload.message : t("auth.invite.error"),
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
  <AuthShell :image-alt="t('auth.login.heroAlt')" image-src="/auth/login-hero.png">
    <div class="space-y-7">
      <div class="space-y-2 text-center md:text-left">
        <p class="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          Keryx
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">{{ t('auth.invite.title') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ t('auth.invite.subtitle', { appName: APP_NAME }) }}
        </p>
      </div>

      <div class="space-y-4">
        <template v-if="invitation?.valid">
          <div class="rounded-2xl border bg-muted/40 p-4 text-sm leading-6">
            <p><strong>{{ t('auth.invite.emailLabel') }}:</strong> {{ invitation.email }}</p>
            <p><strong>{{ t('auth.invite.roleLabel') }}:</strong> {{ invitation.role }}</p>
            <p><strong>{{ t('auth.invite.singleUseLabel') }}:</strong> {{ t('auth.invite.singleUseValue') }}</p>
          </div>

          <div class="space-y-2">
            <Label for="password">{{ t('auth.invite.password') }}</Label>
            <Input id="password" v-model="password" type="password" autocomplete="new-password" />
          </div>

          <div class="space-y-2">
            <Label for="confirm-password">{{ t('auth.invite.confirmPassword') }}</Label>
            <Input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              @keydown.enter="handleAccept"
            />
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
          <p v-if="success" class="text-sm text-green-600">{{ success }}</p>

          <Button class="w-full" :disabled="isSubmitting" @click="handleAccept">
            {{ isSubmitting ? t('auth.invite.creatingAccount') : t('auth.invite.createAccount') }}
          </Button>
        </template>

        <template v-else-if="invitation">
          <p class="text-sm text-destructive">
            {{ t('auth.invite.invalidInvitation') }}
          </p>
          <Button variant="outline" class="w-full" @click="router.push('/login')">
            {{ t('auth.invite.backToLogin') }}
          </Button>
        </template>

        <div v-else class="text-sm text-muted-foreground">
          {{ t('auth.invite.loadingInvitation') }}
        </div>
      </div>
    </div>
  </AuthShell>
</template>
