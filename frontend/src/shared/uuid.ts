/**
 * Generates a UUID v4.
 *
 * `crypto.randomUUID()` requires a secure context (HTTPS). On HTTP pages
 * (e.g. connecting to a local device on the same network), it throws
 * `TypeError: crypto.randomUUID is not a function`. This function provides
 * a transparent fallback using `crypto.getRandomValues()` or, as a last
 * resort, `Math.random()`.
 */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for non-secure contexts (HTTP).
  // crypto.getRandomValues() is available in most environments even
  // without a secure context, unlike crypto.randomUUID().
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version 4 bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant bits (10xx)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort fallback (unlikely, but defensive).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
