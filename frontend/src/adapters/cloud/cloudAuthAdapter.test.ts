import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("cloudAuthAdapter", () => {
  const originalFetch = globalThis.fetch;
  const originalSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const originalSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    const store: Record<string, string> = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          for (const key of Object.keys(store)) {
            delete store[key];
          }
        },
      },
      writable: true,
      configurable: true,
    });
    import.meta.env.VITE_SUPABASE_URL = "https://project.supabase.co";
    import.meta.env.VITE_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
    import.meta.env.VITE_SUPABASE_URL = originalSupabaseUrl;
    import.meta.env.VITE_SUPABASE_ANON_KEY = originalSupabaseAnonKey;
  });

  it("downgrades stored sessions to user until the server confirms the role", async () => {
    const payload = btoa(
      JSON.stringify({
        sub: "user-1",
        email: "admin@example.com",
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    localStorage.setItem("supabase-access-token", `header.${payload}.sig`);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "user-1",
            email: "admin@example.com",
            user_metadata: { role: "admin" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    const { cloudAuthAdapter } = await import("./cloudAuthAdapter");
    const session = await cloudAuthAdapter.getSession();

    expect(session).toEqual({
      accessToken: `header.${payload}.sig`,
      user: {
        id: "user-1",
        email: "admin@example.com",
        role: "user",
      },
    });
  });

  it("does not fall back to the locally decoded session when validation requests fail", async () => {
    const payload = btoa(
      JSON.stringify({
        sub: "user-2",
        email: "user@example.com",
        role: "admin",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    localStorage.setItem("supabase-access-token", `header.${payload}.sig`);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const { cloudAuthAdapter } = await import("./cloudAuthAdapter");
    const session = await cloudAuthAdapter.getSession();

    expect(session).toBeNull();
  });
});
