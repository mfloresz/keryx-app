import * as React from "react";

import { cn } from "#/lib/utils";

/** Inline placeholder shown when the illustration cannot be loaded. */
const IMAGE_FALLBACK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
)}`;

export interface AuthShellProps {
  /** Alt text for the illustration (kept when the image fails to load). */
  imageAlt: string;
  /** Public URL of the illustration (e.g. "/auth/login-hero.webp"). */
  imageSrc: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Two-column shell shared by the login and invite screens: form on the left,
 * illustration on the right (hidden below md).
 */
export function AuthShell({
  imageAlt,
  imageSrc,
  className,
  children,
}: AuthShellProps) {
  const [imageFailed, setImageFailed] = React.useState(false);

  return (
    <div className="box-border flex h-[100dvh] overflow-hidden bg-muted p-6 sm:p-8 lg:p-10">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <div
          className={cn(
            "grid w-full overflow-hidden rounded-[28px] border border-border/70 bg-background md:aspect-[4/3] md:h-[calc(100dvh-6rem)] md:w-auto md:grid-cols-2",
            className,
          )}
        >
          <div className="flex min-h-0 items-center justify-center px-5 py-6 sm:px-10 sm:py-8 md:aspect-[2/3] md:px-12 md:py-10">
            <div className="w-full max-w-[28rem]">{children}</div>
          </div>

          <div className="relative hidden min-h-0 overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(250,246,239,0.95))] md:flex md:aspect-[2/3]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,250,235,0.96),rgba(240,241,235,0.72)_40%,rgba(225,236,228,0.38)_100%)]" />
            <div className="absolute top-8 left-6 h-24 w-24 rounded-full bg-muted/30 blur-3xl" />
            <div className="absolute top-14 right-8 h-32 w-32 rounded-full bg-muted/25 blur-3xl" />
            <div className="absolute bottom-8 left-10 h-40 w-40 rounded-full bg-border/35 blur-3xl" />

            <div className="relative z-10 flex h-full w-full items-stretch overflow-hidden">
              <img
                alt={imageAlt}
                src={imageFailed ? IMAGE_FALLBACK : imageSrc}
                onError={() => setImageFailed(true)}
                className="h-full w-full object-cover object-center drop-shadow-[0_26px_40px_rgba(87,97,91,0.18)]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
