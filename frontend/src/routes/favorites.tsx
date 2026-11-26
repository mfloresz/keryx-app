import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { useI18n } from "#/i18n";
import type { FavoriteMessageEntry } from "#/domain/chat/types";
import { getChatRepository } from "#/services/runtime";

export const Route = createFileRoute("/favorites")({
  component: FavoritesPage,
});

function FavoritesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = React.useState(true);
  const [favorites, setFavorites] = React.useState<FavoriteMessageEntry[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      try {
        const repo = await getChatRepository();
        const data = await repo.listFavorites();
        // The endpoint returns null for an empty list.
        if (!cancelled) setFavorites(data ?? []);
      } catch {
        if (!cancelled) {
          toast.error(t("favorites.failedLoad"));
          setFavorites([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b px-4 py-3">
        <h2 className="truncate font-semibold">{t("favorites.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("favorites.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <output className="text-muted-foreground">{t("app.loading")}</output>
        </div>
      ) : favorites.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-4"
          aria-live="polite"
        >
          <div className="max-w-md space-y-2 text-center">
            <h3 className="text-lg font-medium">{t("favorites.emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("favorites.emptyDescription")}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl space-y-3 p-4">
            {favorites.map((favorite) => (
              <div
                key={`${favorite.chatId}:${favorite.messageId}`}
                className="rounded-xl border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {favorite.chatTitle || t("favorites.untitledChat")}
                    </p>
                    <p className="text-sm leading-6 break-words whitespace-pre-wrap text-foreground">
                      {favorite.messagePreview}
                    </p>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      void navigate({
                        to: "/chat/$id",
                        params: { id: favorite.chatId },
                      })
                    }
                  >
                    {t("favorites.goToChat")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
