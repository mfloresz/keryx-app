/**
 * Route prefetching
 *
 * vue-router 4.6.x does not expose a built-in prefetch option, so we trigger
 * the dynamic imports of lazy route components ourselves. This downloads the
 * /chat/:id chunk (plus its markdown/code-block dependencies) during browser
 * idle time, making the first click on a previous chat feel instant instead
 * of stalling on JavaScript. Already-resolved chunks resolve immediately, so
 * calling this at any point is safe.
 */

import type { Router } from "vue-router";

let prefetchStarted = false;

function isLazyComponent(
  component: unknown,
): component is () => Promise<unknown> {
  return typeof component === "function";
}

/**
 * Fires the dynamic import of every lazy-loaded route component.
 * Idempotent: only runs once per page session; subsequent calls are no-ops.
 */
export async function prefetchRoutes(router: Router): Promise<void> {
  if (prefetchStarted) return;
  prefetchStarted = true;

  const loaders = router
    .getRoutes()
    .map((route) => route.components?.default)
    .filter(isLazyComponent);

  await Promise.allSettled(loaders.map((load) => load()));
}

/**
 * Runs the prefetch during browser idle time so it never competes with the
 * initial render. Falls back to a plain timeout when the browser lacks
 * requestIdleCallback or never goes idle (continuous interaction).
 */
export function schedulePrefetch(router: Router, timeoutMs = 4000): void {
  const run = () => {
    prefetchRoutes(router).catch(() => {
      // Prefetching is best-effort — a failed import must not surface.
    });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: timeoutMs });
  } else {
    window.setTimeout(run, timeoutMs);
  }
}
