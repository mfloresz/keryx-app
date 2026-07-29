export interface AuthUser {
  id: string;
  email: string | null;
  name: string;
  role: "local" | "user" | "admin";
  avatarUrl?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  accessToken?: string | null;
}
