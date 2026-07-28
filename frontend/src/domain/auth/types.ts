export interface AuthUser {
  id: string;
  email: string | null;
  role: "local" | "user" | "admin";
}

export interface AuthSession {
  user: AuthUser;
  accessToken?: string | null;
}
