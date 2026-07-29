import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { AuthSession } from "@/domain/auth/types";
import { getAuthAdapter } from "@/services/runtime";

export const useAuthStore = defineStore("auth", () => {
  const session = ref<AuthSession | null>(null);
  const isLoading = ref(false);

  const user = computed(() => session.value?.user ?? null);
  const userName = computed(() => user.value?.name ?? "");
  const userEmail = computed(() => user.value?.email ?? "");
  const avatarUrl = computed(() => user.value?.avatarUrl ?? null);

  async function loadSession() {
    isLoading.value = true;
    try {
      const auth = await getAuthAdapter();
      session.value = await auth.getSession();
    } finally {
      isLoading.value = false;
    }
  }

  function setSession(nextSession: AuthSession | null) {
    session.value = nextSession;
  }

  async function updateProfile(data: { name?: string; avatar?: File; removeAvatar?: boolean }) {
    const auth = await getAuthAdapter();
    const updatedSession = await auth.updateProfile(data);
    session.value = updatedSession;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const auth = await getAuthAdapter();
    await auth.changePassword(currentPassword, newPassword);
  }

  async function logout() {
    const auth = await getAuthAdapter();
    await auth.logout();
    session.value = null;
  }

  return {
    session,
    isLoading,
    user,
    userName,
    userEmail,
    avatarUrl,
    loadSession,
    setSession,
    updateProfile,
    changePassword,
    logout,
  };
});
