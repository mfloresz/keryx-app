import type { AuthAdapter } from "@/domain/auth/ports";
import type { AuthSession } from "@/domain/auth/types";

const ACCESS_TOKEN_KEY = "supabase-access-token";
const REFRESH_TOKEN_KEY = "supabase-refresh-token";
const SESSION_CACHE_TTL_MS = 30_000;
const EXPIRY_SKEW_SECONDS = 30;

let cachedSession: AuthSession | null = null;
let cachedSessionToken: string | null = null;
let cachedSessionAt = 0;
let sessionRequest: {
  token: string;
  promise: Promise<AuthSession | null>;
} | null = null;

function getLocalStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function getSupabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL || "";
}

function getSupabaseAnonKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ""
  );
}

interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    ) as JwtPayload;
  } catch {
    return null;
  }
}

function clearStoredSession(): void {
  const storage = getLocalStorage();
  storage?.removeItem(ACCESS_TOKEN_KEY);
  storage?.removeItem(REFRESH_TOKEN_KEY);
  cachedSession = null;
  cachedSessionToken = null;
  cachedSessionAt = 0;
  sessionRequest = null;
}

function isExpired(payload: JwtPayload): boolean {
  if (typeof payload.exp !== "number") {
    return false;
  }
  return payload.exp <= Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

function readStoredSession(): AuthSession | null {
  const token = getLocalStorage()?.getItem(ACCESS_TOKEN_KEY);
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  if (!payload?.sub || isExpired(payload)) {
    if (payload && isExpired(payload)) {
      clearStoredSession();
    }
    return null;
  }

  return {
    accessToken: token,
    user: {
      id: String(payload.sub),
      email: typeof payload.email === "string" ? payload.email : null,
      role: "user",
    },
  };
}

async function requestSupabase(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error("Supabase client environment variables are not configured");
  }

  return await fetch(`${url.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function fetchAppSession(
  accessToken: string,
): Promise<AuthSession | null> {
  try {
    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

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

function createUnverifiedUserSession(
  accessToken: string,
  user: { id: unknown; email?: unknown },
): AuthSession {
  return {
    accessToken,
    user: {
      id: String(user.id),
      email: typeof user.email === "string" ? user.email : null,
      role: "user",
    },
  };
}

export const cloudAuthAdapter: AuthAdapter = {
  async getSession() {
    const stored = readStoredSession();
    if (!stored?.accessToken) {
      return null;
    }

    const accessToken = stored.accessToken;
    const now = Date.now();
    if (
      cachedSessionToken === accessToken &&
      now - cachedSessionAt < SESSION_CACHE_TTL_MS
    ) {
      return cachedSession;
    }

    if (sessionRequest?.token === accessToken) {
      return await sessionRequest.promise;
    }

    const promise = (async () => {
      try {
        const response = await requestSupabase("/auth/v1/user", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          clearStoredSession();
          return null;
        }

        const user = await response.json();
        const appSession = await fetchAppSession(accessToken);
        if (appSession) {
          return appSession;
        }

        return createUnverifiedUserSession(accessToken, user);
      } catch {
        return await fetchAppSession(accessToken);
      }
    })();

    sessionRequest = { token: accessToken, promise };

    try {
      const session = await promise;
      cachedSession = session;
      cachedSessionToken = accessToken;
      cachedSessionAt = Date.now();
      return session;
    } finally {
      if (sessionRequest?.promise === promise) {
        sessionRequest = null;
      }
    }
  },

  async login(email, password) {
    const response = await requestSupabase(
      "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) {
      const message =
        typeof payload?.msg === "string"
          ? payload.msg
          : typeof payload?.error_description === "string"
            ? payload.error_description
            : "Unable to sign in";
      throw new Error(message);
    }

    const storage = getLocalStorage();
    storage?.setItem(ACCESS_TOKEN_KEY, payload.access_token);
    if (typeof payload.refresh_token === "string") {
      storage?.setItem(REFRESH_TOKEN_KEY, payload.refresh_token);
    }

    const session = (await fetchAppSession(payload.access_token)) ?? {
      accessToken: payload.access_token,
      user: {
        id: String(payload.user?.id ?? ""),
        email: payload.user?.email ?? email,
        role: payload.user?.user_metadata?.role === "admin" ? "admin" : "user",
      },
    };

    cachedSession = session;
    cachedSessionToken = payload.access_token;
    cachedSessionAt = Date.now();
    return session;
  },

  async logout() {
    const token = getLocalStorage()?.getItem(ACCESS_TOKEN_KEY);
    clearStoredSession();

    if (!token || !getSupabaseUrl() || !getSupabaseAnonKey()) {
      return;
    }

    try {
      await requestSupabase("/auth/v1/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch {
      return;
    }
  },

  async getAuthorizationHeaders() {
    const stored = readStoredSession();
    const headers: Record<string, string> = {};
    if (stored?.accessToken) {
      headers.Authorization = `Bearer ${stored.accessToken}`;
    }
    return headers;
  },
};
