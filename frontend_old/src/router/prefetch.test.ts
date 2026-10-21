import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Router } from "vue-router";

function makeRouter(routes: Array<{ components?: Record<string, unknown> }>) {
  return {
    getRoutes: vi.fn(() => routes),
  } as unknown as Router;
}

// prefetch.ts keeps a module-level flag so each test needs a fresh instance.
async function freshPrefetch() {
  vi.resetModules();
  return await import("./prefetch");
}

describe("prefetchRoutes", () => {
  it("fires every lazy component getter once", async () => {
    const { prefetchRoutes } = await freshPrefetch();
    const loadA = vi.fn(async () => ({}));
    const loadB = vi.fn(async () => ({}));
    const eager = {};
    const router = makeRouter([
      { components: { default: loadA } },
      { components: { default: eager } },
      { components: { default: loadB } },
      {},
    ]);

    await prefetchRoutes(router);

    expect(loadA).toHaveBeenCalledTimes(1);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it("skips already-resolved (non-function) components", async () => {
    const { prefetchRoutes } = await freshPrefetch();
    const load = vi.fn(async () => ({}));
    const router = makeRouter([
      { components: { default: {} } },
      { components: { default: load } },
    ]);

    await prefetchRoutes(router);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across calls", async () => {
    const { prefetchRoutes } = await freshPrefetch();
    const load = vi.fn(async () => ({}));
    const router = makeRouter([{ components: { default: load } }]);

    await prefetchRoutes(router);
    await prefetchRoutes(router);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("resolves even when a lazy import rejects", async () => {
    const { prefetchRoutes } = await freshPrefetch();
    const load = vi.fn(async () => {
      throw new Error("chunk failed");
    });
    const router = makeRouter([{ components: { default: load } }]);

    await expect(prefetchRoutes(router)).resolves.toBeUndefined();
  });
});

describe("schedulePrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to a timeout without requestIdleCallback", async () => {
    const { schedulePrefetch } = await freshPrefetch();
    const router = makeRouter([]);

    schedulePrefetch(router, 1000);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});
