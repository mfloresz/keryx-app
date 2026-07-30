import type { AuthAdapter } from "@/domain/auth/ports";
import type { AuthSession } from "@/domain/auth/types";

const SESSION_CACHE_TTL_MS = 30_000;

let cachedSession: AuthSession | null = null;
let cachedSessionAt = 0;

function clearStoredSession(): void {
  cachedSession = null;
  cachedSessionAt = 0;
}

// The session lives in an HttpOnly cookie (keryx_session) set by the server
// on login/register. Fetch defaults to credentials: "same-origin", so the
// browser attaches it automatically to our same-origin API calls and no JS
// can read the token.
async function fetchAppSession(): Promise<AuthSession | null> {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return null;
    const payload = await response.json();
    return userFromPayload(payload);
  } catch {
    return null;
  }
}

function userFromPayload(payload: any): AuthSession {
  return {
    accessToken: null,
    user: {
      id: String(payload.id ?? payload.user?.id ?? ""),
      email: typeof payload.email === "string" ? payload.email : (payload.user?.email ?? null),
      name: payload.name ?? payload.user?.name ?? "",
      role: (payload.role ?? payload.user?.role) === "admin" ? "admin" : "user",
      avatarUrl: payload.avatarUrl ?? payload.user?.avatarUrl ?? null,
    },
  };
}

export const apiAuthAdapter: AuthAdapter = {
  async getSession() {
    const now = Date.now();
    if (cachedSession && now - cachedSessionAt < SESSION_CACHE_TTL_MS) {
      return cachedSession;
    }

    const session = await fetchAppSession();
    if (session) {
      cachedSession = session;
      cachedSessionAt = Date.now();
      return session;
    }

    clearStoredSession();
    return null;
  },

  async login(email, password) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : "Unable to sign in";
      throw new Error(message);
    }

    const session = userFromPayload(payload.user);

    const verifiedSession = await fetchAppSession();
    const finalSession = verifiedSession ?? session;
    cachedSession = finalSession;
    cachedSessionAt = Date.now();
    return finalSession;
  },

  async logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best effort: clear local state even if the request fails.
    }
    clearStoredSession();
  },

  async getAuthorizationHeaders() {
    // Authentication is cookie-based; no Authorization header needed.
    return {};
  },

  async updateProfile(data) {
    const formData = new FormData();
    if (data.name !== undefined) {
      formData.append("name", data.name);
    }
    if (data.avatar) {
      formData.append("avatar", data.avatar);
    }
    if (data.removeAvatar) {
      formData.append("removeAvatar", "true");
    }

    const response = await fetch("/api/auth/profile", {
      method: "PATCH",
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: "Failed to update profile" }));
      throw new Error(err.message);
    }

    const payload = await response.json();
    const session = userFromPayload(payload);
    cachedSession = session;
    cachedSessionAt = Date.now();
    return session;
  },

  async changePassword(currentPassword, newPassword) {
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: "Failed to change password" }));
      throw new Error(err.message);
    }
  },
};
