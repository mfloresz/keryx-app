import type { UserRole } from "@/lib/auth/types";

type Entitlements = {
  maxMessagesPerHour: number;
};

export const entitlementsByRole: Record<UserRole, Entitlements> = {
  admin: {
    maxMessagesPerHour: 200,
  },
  user: {
    maxMessagesPerHour: 50,
  },
};
