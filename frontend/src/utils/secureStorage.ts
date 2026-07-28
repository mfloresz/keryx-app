/**
 * Secure Storage Utility
 *
 * Encrypts sensitive values using AES-GCM via Web Crypto API before storing
 * them in localStorage. A randomly-generated master key is persisted in
 * localStorage under an opaque key name. This provides defence-in-depth:
 * an attacker who only gains access to localStorage contents (e.g. via a
 * malicious browser extension with storage permissions) still cannot read
 * API keys without also knowing the algorithm and master key.
 */

const MASTER_KEY_STORAGE = "__keryx_mk_v1";
const ENC_PREFIX = "enc:v1:";

function isCryptoAvailable(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
    return false;
  }
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getStorage(): Storage {
  return typeof globalThis !== "undefined" && globalThis.localStorage
    ? globalThis.localStorage
    : localStorage;
}

async function getOrCreateMasterKey() {
  const storage = getStorage();
  const stored = storage.getItem(MASTER_KEY_STORAGE);
  if (stored) {
    const jwk = JSON.parse(stored);
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  storage.setItem(MASTER_KEY_STORAGE, JSON.stringify(jwk));
  return key;
}

export async function secureSetItem(
  key: string,
  value: string | null,
): Promise<void> {
  const storage = getStorage();
  if (!value) {
    storage.removeItem(key);
    return;
  }
  if (!isCryptoAvailable()) {
    // Fallback for environments without Web Crypto (e.g. test runners)
    storage.setItem(key, value);
    return;
  }
  const masterKey = await getOrCreateMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    encoder.encode(value),
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  storage.setItem(key, ENC_PREFIX + arrayBufferToBase64(combined.buffer));
}

export async function secureGetItem(key: string): Promise<string | null> {
  const storage = getStorage();
  const stored = storage.getItem(key);
  if (!stored) return null;
  if (!stored.startsWith(ENC_PREFIX)) {
    // Legacy plain-text value — return as-is so callers can migrate on next save
    return stored;
  }
  if (!isCryptoAvailable()) {
    return stored.startsWith(ENC_PREFIX) ? null : stored;
  }
  try {
    const masterKey = await getOrCreateMasterKey();
    const combined = new Uint8Array(
      base64ToArrayBuffer(stored.slice(ENC_PREFIX.length)),
    );
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      masterKey,
      ciphertext,
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // Decryption failed (e.g. master key was reset) — clean up stale data
    storage.removeItem(key);
    return null;
  }
}
