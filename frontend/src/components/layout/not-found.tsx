import { Link } from "@tanstack/react-router";

import { buttonVariants } from "#/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-heading text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className={buttonVariants()}>
        Back to chat
      </Link>
    </div>
  );
}
