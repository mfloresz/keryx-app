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
    return {
      accessToken,
      user: {
        id: String(payload.id),
        email: typeof payload.email === "string" ? payload.email : null,
        role: payload.role === "admin" ? "admin" : "user",
      },
    };
  } catch {
    return null;
  }
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

    const session: AuthSession = {
      accessToken: payload.token,
      user: {
        id: String(payload.user?.id ?? payload.id ?? ""),
        email: payload.user?.email ?? email,
        role: payload.user?.role === "admin" ? "admin" : "user",
      },
    };

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
};
