import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AgentCard } from "#/components/agents/agent-card";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useI18n } from "#/i18n";
import { useAgentsStore, type Agent } from "#/stores/agents";

export const Route = createFileRoute("/agents/")({
  component: AgentsPage,
});

function AgentsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { all, mine, shared, isLoading, fetchAgents } = useAgentsStore();

  const [tab, setTab] = React.useState<"all" | "mine" | "shared">("all");
  const [preview, setPreview] = React.useState<Agent | null>(null);

  React.useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const displayed =
    tab === "mine" ? mine : tab === "shared" ? shared : all;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                {t("agents.title")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("agents.subtitle")}
              </p>
            </div>
            <Button
              className="shrink-0 rounded-full px-5"
              onClick={() => void navigate({ to: "/agents/new" })}
            >
              {t("agents.create")}
            </Button>
          </div>

          <div className="mt-6">
            <Tabs
              value={tab}
              onValueChange={(value) =>
                setTab(value as "all" | "mine" | "shared")
              }
            >
              <TabsList className="h-auto gap-2 bg-transparent p-0">
                <TabsTrigger
                  value="all"
                  className="rounded-full bg-muted px-4 py-1.5 text-sm data-active:bg-foreground data-active:text-background data-active:shadow-sm"
                >
                  {t("agents.tabsAll")}
                </TabsTrigger>
                <TabsTrigger
                  value="mine"
                  className="rounded-full bg-muted px-4 py-1.5 text-sm data-active:bg-foreground data-active:text-background data-active:shadow-sm"
                >
                  {t("agents.tabsMine")}
                </TabsTrigger>
                <TabsTrigger
                  value="shared"
                  className="rounded-full bg-muted px-4 py-1.5 text-sm data-active:bg-foreground data-active:text-background data-active:shadow-sm"
                >
                  {t("agents.tabsShared")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {isLoading && all.length === 0 ? (
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-52 animate-pulse rounded-xl border bg-muted/50"
                />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="mt-16 flex flex-col items-center justify-center text-center">
              <div className="max-w-sm space-y-2">
                <h3 className="text-base font-medium">
                  {tab === "all"
                    ? t("agents.emptyTitle")
                    : t("agents.noResults")}
                </h3>
                {tab === "all" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("agents.emptyDescription")}
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => void navigate({ to: "/agents/new" })}
                    >
                      {t("agents.create")}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayed.map((agent) => (
                <AgentCard
                  key={agent.id + ":" + agent.source}
                  agent={agent}
                  onSelect={setPreview}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>
              {preview?.description || t("agents.emptyDescription")}
            </DialogDescription>
          </DialogHeader>
          {preview?.systemPrompt ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
              {preview.systemPrompt}
            </pre>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              {t("app.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!preview) return;
                setPreview(null);
                void navigate({
                  to: "/",
                  search: { agentId: preview.id },
                });
              }}
            >
              {t("agents.preview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
