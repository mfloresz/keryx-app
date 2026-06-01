export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type UserType = "regular";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  type: UserType;
  name?: string | null;
};

export type Session = {
  user: AuthUser;
};
