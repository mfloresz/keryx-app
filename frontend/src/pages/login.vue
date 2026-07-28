<script setup lang="ts">
import { ref } from "vue";
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

const email = ref("");
const password = ref("");
const isSubmitting = ref(false);
const error = ref("");
const fieldErrors = ref<{ email?: string; password?: string }>({});

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
    const session = await auth.login(email.value.trim(), password.value);
    authStore.setSession(session);
    await router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.login.error");
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
        <h1 class="text-3xl font-semibold tracking-tight">{{ t('auth.login.welcome') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ t('auth.login.subtitle', { appName: APP_NAME }) }}
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

        <div class="space-y-2">
          <Label for="password">{{ t('auth.login.password') }}</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="isSubmitting"
            :aria-invalid="fieldErrors.password ? 'true' : undefined"
            :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
            required
            minlength="1"
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

        <p
          v-if="error"
          role="alert"
          class="break-words text-sm text-destructive"
        >
          {{ error }}
        </p>

        <Button class="w-full" :disabled="isSubmitting" @click="handleSubmit">
          {{ isSubmitting ? t('auth.login.signingIn') : t('auth.login.button') }}
        </Button>

        <p class="text-center text-xs text-muted-foreground md:text-left">
          {{ t('auth.login.invitationOnly') }}
        </p>
      </div>
    </div>
  </AuthShell>
</template>
