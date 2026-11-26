import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangleIcon } from "lucide-react";

import { Button } from "#/components/ui/button";

export function ErrorBoundary({ error }: ErrorComponentProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangleIcon className="size-8 text-destructive" aria-hidden />
      <h1 className="font-heading text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "Unknown error"}
      </p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}
