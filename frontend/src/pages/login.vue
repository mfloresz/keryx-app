<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { APP_NAME } from "@/app/config";
import AuthShell from "@/components/auth/AuthShell.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthAdapter } from "@/services/runtime";
import { useAuthStore } from "@/stores/auth";

const { t } = useI18n();
const router = useRouter();
const auth = await getAuthAdapter();
const authStore = useAuthStore();

const needsSetup = ref(false);
const email = ref("");
const name = ref("");
const password = ref("");
const confirmPassword = ref("");
const isSubmitting = ref(false);
const error = ref("");
const fieldErrors = ref<{
  email?: string;
  password?: string;
  confirmPassword?: string;
}>({});

onMounted(async () => {
  needsSetup.value = await auth.getSetupStatus();
});

function validate(): boolean {
  fieldErrors.value = {};

  const trimmed = email.value.trim();
  if (!trimmed) {
    fieldErrors.value.email = t("auth.validation.emailRequired");
    return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    fieldErrors.value.email = t("auth.validation.emailInvalid");
    return false;
  }

  if (!password.value) {
    fieldErrors.value.password = t("auth.validation.passwordRequired");
    return false;
  }

  if (needsSetup.value) {
    if (password.value.length < 8) {
      fieldErrors.value.password = t("auth.setup.passwordMinLength");
      return false;
    }
    if (password.value !== confirmPassword.value) {
      fieldErrors.value.confirmPassword = t("auth.setup.passwordsDoNotMatch");
      return false;
    }
  }

  return true;
}

async function handleSubmit() {
  if (isSubmitting.value) {
    return;
  }

  if (!validate()) {
    return;
  }

  isSubmitting.value = true;
  error.value = "";
  fieldErrors.value = {};

  try {
    const session = needsSetup.value
      ? await auth.register(email.value.trim(), password.value, name.value.trim())
      : await auth.login(email.value.trim(), password.value);
    authStore.setSession(session);
    await router.push("/");
  } catch (err) {
    error.value = err instanceof Error
      ? err.message
      : t(needsSetup.value ? "auth.setup.error" : "auth.login.error");
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <AuthShell :image-alt="t('auth.login.heroAlt')" image-src="/auth/login-hero.webp">
    <div class="space-y-7 overflow-hidden">
      <div class="space-y-2 text-center md:text-left">
        <p class="text-xs font-semibold uppercase tracking-[0.32em] text-muted-foreground">
          Keryx
        </p>
        <h1 class="text-3xl font-semibold tracking-tight">
          {{ needsSetup ? t('auth.setup.title') : t('auth.login.welcome') }}
        </h1>
        <p class="text-sm text-muted-foreground">
          {{ needsSetup ? t('auth.setup.subtitle', { appName: APP_NAME }) : t('auth.login.subtitle', { appName: APP_NAME }) }}
        </p>
      </div>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="email">{{ t('auth.login.email') }}</Label>
          <Input
            id="email"
            v-model.trim="email"
            type="email"
            autocomplete="email"
            :disabled="isSubmitting"
            :aria-invalid="fieldErrors.email ? 'true' : undefined"
            :aria-describedby="fieldErrors.email ? 'email-error' : undefined"
            required
            minlength="1"
          />
          <p
            v-if="fieldErrors.email"
            id="email-error"
            class="break-words text-sm text-destructive"
          >
            {{ fieldErrors.email }}
          </p>
        </div>

        <div v-if="needsSetup" class="space-y-2">
          <Label for="name">{{ t('auth.setup.name') }}</Label>
          <Input
            id="name"
            v-model.trim="name"
            type="text"
            autocomplete="name"
            :disabled="isSubmitting"
          />
        </div>

        <div class="space-y-2">
          <Label for="password">{{ t('auth.login.password') }}</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            :autocomplete="needsSetup ? 'new-password' : 'current-password'"
            :disabled="isSubmitting"
            :aria-invalid="fieldErrors.password ? 'true' : undefined"
            :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
            required
            :minlength="needsSetup ? 8 : 1"
            @keydown.enter="handleSubmit"
          />
          <p
            v-if="fieldErrors.password"
            id="password-error"
            class="break-words text-sm text-destructive"
          >
            {{ fieldErrors.password }}
          </p>
        </div>

        <div v-if="needsSetup" class="space-y-2">
          <Label for="confirm-password">{{ t('auth.setup.confirmPassword') }}</Label>
          <Input
            id="confirm-password"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            :disabled="isSubmitting"
            :aria-invalid="fieldErrors.confirmPassword ? 'true' : undefined"
            :aria-describedby="fieldErrors.confirmPassword ? 'confirm-password-error' : undefined"
            required
            minlength="8"
            @keydown.enter="handleSubmit"
          />
          <p
            v-if="fieldErrors.confirmPassword"
            id="confirm-password-error"
            class="break-words text-sm text-destructive"
          >
            {{ fieldErrors.confirmPassword }}
          </p>
        </div>

        <p
          v-if="error"
          role="alert"
          class="break-words text-sm text-destructive"
        >
          {{ error }}
        </p>

        <Button class="w-full" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting
            ? (needsSetup ? t('auth.setup.creatingAccount') : t('auth.login.signingIn'))
            : (needsSetup ? t('auth.setup.button') : t('auth.login.button')) }}
        </Button>

        <p
          v-if="!needsSetup"
          class="text-center text-xs text-muted-foreground md:text-left"
        >
          {{ t('auth.login.invitationOnly') }}
        </p>
      </div>
    </div>
  </AuthShell>
</template>
