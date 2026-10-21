import * as React from "react";

import type { AuthSession } from "#/domain/auth/types";
import { getAuthAdapter } from "#/services/runtime";

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  user: AuthSession["user"] | null;
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  loadSession: () => Promise<void>;
  setSession: (session: AuthSession | null) => void;
  updateProfile: (data: {
    name?: string;
    avatar?: File;
    removeAvatar?: boolean;
  }) => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = React.useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const loadSession = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const auth = await getAuthAdapter();
      setSessionState(await auth.getSession());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setSession = React.useCallback((next: AuthSession | null) => {
    setSessionState(next);
  }, []);

  const updateProfile = React.useCallback(
    async (data: {
      name?: string;
      avatar?: File;
      removeAvatar?: boolean;
    }) => {
      const auth = await getAuthAdapter();
      setSessionState(await auth.updateProfile(data));
    },
    [],
  );

  const changePassword = React.useCallback(
    async (currentPassword: string, newPassword: string) => {
      const auth = await getAuthAdapter();
      await auth.changePassword(currentPassword, newPassword);
    },
    [],
  );

  const logout = React.useCallback(async () => {
    const auth = await getAuthAdapter();
    await auth.logout();
    setSessionState(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      user: session?.user ?? null,
      userName: session?.user.name ?? "",
      userEmail: session?.user.email ?? "",
      avatarUrl: session?.user.avatarUrl ?? null,
      loadSession,
      setSession,
      updateProfile,
      changePassword,
      logout,
    }),
    [
      session,
      isLoading,
      loadSession,
      setSession,
      updateProfile,
      changePassword,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
