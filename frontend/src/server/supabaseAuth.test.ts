import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthContext } from "./supabaseAuth.js";

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  sign: (data: ArrayBuffer) => Promise<ArrayBuffer>,
): Promise<string> {
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const data = new TextEncoder().encode(signingInput);
  const signature = await sign(data.buffer.slice(0));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

describe("supabaseAuth", () => {
  const originalFetch = globalThis.fetch;
  const originalJwksUrl = process.env.SUPABASE_JWKS_URL;
  const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalSupabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalViteSupabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const originalViteSupabasePublishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SUPABASE_JWKS_URL = "";
    process.env.SUPABASE_JWT_SECRET = "";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_ANON_KEY = "";
    process.env.SUPABASE_PUBLISHABLE_KEY = "";
    process.env.VITE_SUPABASE_ANON_KEY = "";
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.SUPABASE_JWKS_URL = originalJwksUrl;
    process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
    process.env.SUPABASE_URL = originalSupabaseUrl;
    process.env.SUPABASE_ANON_KEY = originalSupabaseAnonKey;
    process.env.SUPABASE_PUBLISHABLE_KEY = originalSupabasePublishableKey;
    process.env.VITE_SUPABASE_ANON_KEY = originalViteSupabaseAnonKey;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
      originalViteSupabasePublishableKey;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseServiceRoleKey;
  });

  it("verifies HS256 tokens against an oct key from JWKS", async () => {
    const secret = "super-secret-value";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", key);
    const kid = "shared-secret-key";

    process.env.SUPABASE_JWKS_URL = "https://example.test/jwks";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "HS256" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const token = await createJwt(
      { alg: "HS256", typ: "JWT", kid },
      { sub: "user-1", email: "user@example.com" },
      async (data) => await crypto.subtle.sign("HMAC", key, data),
    );

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toEqual({
      userId: "user-1",
      email: "user@example.com",
    });
  });

  it("verifies RS256 tokens against an RSA key from JWKS", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = "rsa-key";

    process.env.SUPABASE_JWKS_URL = "https://example.test/jwks";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const token = await createJwt(
      { alg: "RS256", typ: "JWT", kid },
      { sub: "user-2", email: "rsa@example.com" },
      async (data) =>
        await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, data),
    );

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toEqual({
      userId: "user-2",
      email: "rsa@example.com",
    });
  });

  it("verifies ES256 tokens against an EC key from JWKS", async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = "ec-key";

    process.env.SUPABASE_JWKS_URL = "https://example.test/jwks";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ keys: [{ ...jwk, kid, alg: "ES256", crv: "P-256" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const token = await createJwt(
      { alg: "ES256", typ: "JWT", kid },
      { sub: "user-3", email: "ecdsa@example.com" },
      async (data) =>
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          data,
        ),
    );

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toEqual({
      userId: "user-3",
      email: "ecdsa@example.com",
    });
  });

  it("falls back to Supabase Auth user lookup when local verification fails", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_JWKS_URL = "https://example.test/jwks";

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "supabase-user", email: "cloud@example.com" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );

    const token = [
      base64UrlEncode(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: "missing" }),
      ),
      base64UrlEncode(
        JSON.stringify({ sub: "ignored", email: "ignored@example.com" }),
      ),
      "invalid-signature",
    ].join(".");

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toEqual({
      userId: "supabase-user",
      email: "cloud@example.com",
    });
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "https://project.supabase.co/auth/v1/user",
      {
        headers: {
          apikey: "anon-key",
          Authorization: `Bearer ${token}`,
        },
      },
    );
  });

  it("does not use the Supabase service role key for auth fallback", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("not found", { status: 404 }));

    const token = [
      base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" })),
      base64UrlEncode(
        JSON.stringify({ sub: "forged-user", email: "forged@example.com" }),
      ),
      "invalid-signature",
    ].join(".");

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });

  it("rejects bearer tokens when neither local nor Supabase Auth verification succeeds", async () => {
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));

    const token = [
      base64UrlEncode(JSON.stringify({ alg: "none", typ: "JWT" })),
      base64UrlEncode(
        JSON.stringify({ sub: "forged-user", email: "forged@example.com" }),
      ),
      "invalid-signature",
    ].join(".");

    const auth = await getAuthContext(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(auth).toBeNull();
  });
});
