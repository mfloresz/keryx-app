import { defineStore } from "pinia";
import { ref } from "vue";
import type { AuthSession } from "@/domain/auth/types";
import { getAuthAdapter } from "@/services/runtime";

export const useAuthStore = defineStore("auth", () => {
  const session = ref<AuthSession | null>(null);
  const isLoading = ref(false);

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

  async function logout() {
    const auth = await getAuthAdapter();
    await auth.logout();
    session.value = null;
  }

  return {
    session,
    isLoading,
    loadSession,
    setSession,
    logout,
  };
});
