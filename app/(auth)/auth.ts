import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refreshUserSession } from "@/lib/db/queries";
import type { AuthUser, Session, UserRole, UserType } from "@/lib/auth/types";

type SessionCookieUser = Omit<AuthUser, "type">;

const SESSION_COOKIE = "keryx_session";
const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;

type StoredSession = {
  token: string;
  user: SessionCookieUser;
};

function encodeSession(session: StoredSession) {
  return encodeURIComponent(JSON.stringify(session));
}

function decodeSession(value: string): StoredSession | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as StoredSession;

    if (!parsed?.token || !parsed?.user?.id || !parsed?.user?.email) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function createSession(session: StoredSession) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_WEEK_SECONDS,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function auth(): Promise<Session | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  const parsed = decodeSession(raw);

  if (!parsed) {
    return null;
  }

  const refreshed = await refreshUserSession(parsed.token);

  if (!refreshed) {
    return null;
  }

  return {
    user: {
      ...refreshed.user,
      type: "regular",
    },
  };
}

export async function requireAuth() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return session;
}

export async function requireRole(role: UserRole) {
  const session = await requireAuth();

  if (session.user.role !== role) {
    redirect("/");
  }

  return session;
}

export async function signOut({ redirectTo }: { redirectTo?: string } = {}) {
  await clearSession();

  if (redirectTo) {
    redirect(redirectTo);
  }
}

export type { AuthUser, Session, UserRole, UserType };
