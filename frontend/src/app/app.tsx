import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { AppFontProvider } from "#/composables/use-app-font";
import { ThemeProvider } from "#/composables/use-theme";
import { I18nProvider } from "#/i18n";
import { router } from "#/router";
import { AgentsProvider } from "#/stores/agents";
import { ArtifactProvider } from "#/stores/artifact";
import { AuthProvider } from "#/stores/auth";
import { ChatProvider } from "#/stores/chat";
import { ProjectsProvider } from "#/stores/projects";
import { Toaster } from "#/components/ui/sonner";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <AppFontProvider>
          <AuthProvider>
            <ArtifactProvider>
            <AgentsProvider>
              <ChatProvider>
                <ProjectsProvider>
                  <RouterProvider router={router} />
                  <Toaster rich-colors position="top-right" closeButton />
                </ProjectsProvider>
              </ChatProvider>
            </AgentsProvider>
            </ArtifactProvider>
          </AuthProvider>
          </AppFontProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
