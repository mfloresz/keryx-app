import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AdminConsole } from "#/components/admin/admin-console";
import { useI18n } from "#/i18n";
import { useAuth } from "#/stores/auth";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { session } = useAuth();

  const isAdmin = session?.user.role === "admin";

  React.useEffect(() => {
    if (!isAdmin) {
      void navigate({ to: "/" });
    }
  }, [isAdmin, navigate]);

  if (!isAdmin) return null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {t("admin.dashboard.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("admin.dashboard.description")}
        </p>

        <div className="mt-6">
          <AdminConsole />
        </div>
      </div>
    </div>
  );
}
