import type { AuthAdapter } from "@/domain/auth/ports";

export const staticAuthAdapter: AuthAdapter = {
  async getSession() {
    return {
      user: {
        id: "local-user",
        email: null,
        role: "local",
      },
      accessToken: null,
    };
  },

  async login() {
    return {
      user: {
        id: "local-user",
        email: null,
        role: "local",
      },
      accessToken: null,
    };
  },

  async logout() {
    return;
  },

  async getAuthorizationHeaders() {
    return {};
  },
};
