import type { AuthAdapter } from "@/domain/auth/ports";
import type { AuthSession } from "@/domain/auth/types";

const ACCESS_TOKEN_KEY = "keryx-access-token";
const SESSION_CACHE_TTL_MS = 30_000;

let cachedSession: AuthSession | null = null;
let cachedSessionToken: string | null = null;
let cachedSessionAt = 0;

function getLocalStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function clearStoredSession(): void {
  const storage = getLocalStorage();
  storage?.removeItem(ACCESS_TOKEN_KEY);
  cachedSession = null;
  cachedSessionToken = null;
  cachedSessionAt = 0;
}

function readStoredToken(): string | null {
  return getLocalStorage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
}

async function fetchAppSession(accessToken: string): Promise<AuthSession | null> {
  try {
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return userFromPayload(payload, accessToken);
  } catch {
    return null;
  }
}

function userFromPayload(payload: any, accessToken?: string): AuthSession {
  return {
    accessToken,
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
    const token = readStoredToken();
    if (!token) return null;

    const now = Date.now();
    if (cachedSessionToken === token && now - cachedSessionAt < SESSION_CACHE_TTL_MS) {
      return cachedSession;
    }

    const session = await fetchAppSession(token);
    if (session) {
      cachedSession = session;
      cachedSessionToken = token;
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
    if (!response.ok || !payload?.token) {
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : "Unable to sign in";
      throw new Error(message);
    }

    const storage = getLocalStorage();
    storage?.setItem(ACCESS_TOKEN_KEY, payload.token);

    const session = userFromPayload(payload.user, payload.token);

    const verifiedSession = await fetchAppSession(payload.token);
    const finalSession = verifiedSession ?? session;
    cachedSession = finalSession;
    cachedSessionToken = payload.token;
    cachedSessionAt = Date.now();
    return finalSession;
  },

  async logout() {
    clearStoredSession();
  },

  async getAuthorizationHeaders() {
    const token = readStoredToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  },

  async updateProfile(data) {
    const token = readStoredToken();
    if (!token) throw new Error("Not authenticated");

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
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: "Failed to update profile" }));
      throw new Error(err.message);
    }

    const payload = await response.json();
    const session = userFromPayload(payload, token);
    cachedSession = session;
    cachedSessionToken = token;
    cachedSessionAt = Date.now();
    return session;
  },

  async changePassword(currentPassword, newPassword) {
    const token = readStoredToken();
    if (!token) throw new Error("Not authenticated");

    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: "Failed to change password" }));
      throw new Error(err.message);
    }
  },
};
