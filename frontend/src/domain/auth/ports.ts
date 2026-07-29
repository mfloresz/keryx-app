import type { AuthSession } from "./types";

export interface AuthAdapter {
  getSession(): Promise<AuthSession | null>;
  login(email: string, password: string): Promise<AuthSession>;
  logout(): Promise<void>;
  getAuthorizationHeaders(): Promise<Record<string, string>>;
  updateProfile(data: { name?: string; avatar?: File; removeAvatar?: boolean }): Promise<AuthSession>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}
