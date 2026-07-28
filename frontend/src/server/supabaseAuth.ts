interface AuthContext {
  userId: string;
  email?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  sub?: string;
  email?: string;
}

interface SupabaseAuthUser {
  id?: string;
  email?: string;
}

interface JwkKey extends Record<string, unknown> {
  alg?: string;
  crv?: string;
  kid?: string;
  kty?: string;
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(value: string): T {
  const json = new TextDecoder().decode(base64UrlToBytes(value));
  return JSON.parse(json) as T;
}

function parseJwt(token: string) {
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  if (!headerPart || !payloadPart || !signaturePart) {
    throw new Error("Invalid token");
  }

  return {
    headerPart,
    payloadPart,
    signaturePart,
    header: decodeBase64UrlJson<JwtHeader>(headerPart),
    payload: decodeBase64UrlJson<JwtPayload>(payloadPart),
    signingInput: `${headerPart}.${payloadPart}`,
  };
}

function getHashName(alg?: string): "SHA-256" | "SHA-384" | "SHA-512" {
  switch (alg) {
    case "HS384":
    case "RS384":
    case "PS384":
    case "ES384":
      return "SHA-384";
    case "HS512":
    case "RS512":
    case "PS512":
    case "ES512":
      return "SHA-512";
    default:
      return "SHA-256";
  }
}

function getJwkAlgorithms(header: JwtHeader, jwk: JwkKey) {
  const alg = header.alg || jwk.alg;
  const hash = getHashName(alg);

  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return {
        importAlgorithm: { name: "HMAC", hash },
        verifyAlgorithm: "HMAC" as const,
      };
    case "PS256":
    case "PS384":
    case "PS512":
      return {
        importAlgorithm: { name: "RSA-PSS", hash },
        verifyAlgorithm: {
          name: "RSA-PSS",
          saltLength: Number.parseInt(hash.slice(4), 10) / 8,
        },
      };
    case "ES256":
    case "ES384":
    case "ES512":
      return {
        importAlgorithm: { name: "ECDSA", namedCurve: jwk.crv || "P-256" },
        verifyAlgorithm: { name: "ECDSA", hash },
      };
    case "EdDSA":
      if (jwk.crv === "Ed25519") {
        return {
          importAlgorithm: "Ed25519",
          verifyAlgorithm: "Ed25519",
        };
      }
      break;
    case "RS256":
    case "RS384":
    case "RS512":
    default:
      if (jwk.kty === "oct") {
        return {
          importAlgorithm: { name: "HMAC", hash },
          verifyAlgorithm: "HMAC" as const,
        };
      }
      if (jwk.kty === "EC") {
        return {
          importAlgorithm: { name: "ECDSA", namedCurve: jwk.crv || "P-256" },
          verifyAlgorithm: { name: "ECDSA", hash },
        };
      }
      if (jwk.kty === "OKP" && jwk.crv === "Ed25519") {
        return {
          importAlgorithm: "Ed25519",
          verifyAlgorithm: "Ed25519",
        };
      }
      return {
        importAlgorithm: { name: "RSASSA-PKCS1-v1_5", hash },
        verifyAlgorithm: "RSASSA-PKCS1-v1_5" as const,
      };
  }

  throw new Error(`Unsupported JWT algorithm: ${alg || "unknown"}`);
}

function createAuthContext(payload: JwtPayload): AuthContext {
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Invalid token payload");
  }

  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

function getSupabaseUrl(): string {
  return (process.env.SUPABASE_URL || "").replace(/\/$/, "");
}

function getSupabaseAuthApiKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ""
  );
}

async function verifyWithSupabaseAuth(
  token: string,
): Promise<AuthContext | null> {
  const baseUrl = getSupabaseUrl();
  const apiKey = getSupabaseAuthApiKey();
  if (!baseUrl || !apiKey) {
    return null;
  }

  const response = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    return null;
  }

  const user = (await response.json()) as SupabaseAuthUser;
  if (typeof user.id !== "string" || !user.id) {
    return null;
  }

  return {
    userId: user.id,
    email: typeof user.email === "string" ? user.email : undefined,
  };
}

async function verifyHs256(
  token: string,
  secret: string,
): Promise<AuthContext> {
  const { payload, signaturePart, signingInput } = parseJwt(token);

  const subtle = crypto.subtle as any;
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = base64UrlToBytes(signaturePart);
  const valid = await subtle.verify(
    "HMAC",
    key,
    new Uint8Array(signature).buffer,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return createAuthContext(payload);
}

async function verifyWithJwks(
  token: string,
  jwksUrl: string,
): Promise<AuthContext> {
  const { header, payload, signaturePart, signingInput } = parseJwt(token);
  const jwksResponse = await fetch(jwksUrl);
  if (!jwksResponse.ok) {
    throw new Error("Unable to fetch Supabase JWKS");
  }

  const jwks = (await jwksResponse.json()) as {
    keys?: JwkKey[];
  };
  const jwk =
    jwks.keys?.find((key) => header.kid && key.kid === header.kid) ||
    (!header.kid && jwks.keys?.length === 1 ? jwks.keys[0] : undefined) ||
    jwks.keys?.find((key) => key.alg && key.alg === header.alg);
  if (!jwk) {
    throw new Error("Matching Supabase key not found");
  }

  const subtle = crypto.subtle as any;
  const { importAlgorithm, verifyAlgorithm } = getJwkAlgorithms(header, jwk);
  const key = await subtle.importKey("jwk", jwk, importAlgorithm, false, [
    "verify",
  ]);
  const signature = base64UrlToBytes(signaturePart);
  const valid = await subtle.verify(
    verifyAlgorithm,
    key,
    new Uint8Array(signature).buffer,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return createAuthContext(payload);
}

export async function getAuthContext(
  request: Request,
): Promise<AuthContext | null> {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const secret = process.env.SUPABASE_JWT_SECRET || "";
  if (secret) {
    try {
      return await verifyHs256(token, secret);
    } catch {
      return await verifyWithSupabaseAuth(token);
    }
  }

  const jwksUrl =
    process.env.SUPABASE_JWKS_URL ||
    (process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
      : "");
  if (jwksUrl) {
    try {
      return await verifyWithJwks(token, jwksUrl);
    } catch {
      return await verifyWithSupabaseAuth(token);
    }
  }

  return await verifyWithSupabaseAuth(token);
}
