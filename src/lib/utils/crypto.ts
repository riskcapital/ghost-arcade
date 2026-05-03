/**
 * Simple AES-GCM encryption for API keys stored in localStorage.
 * Uses Web Crypto API with a device-derived key.
 *
 * Encrypted values are stored as "enc:v1:<base64>" to distinguish from plaintext.
 */

const ENC_PREFIX = 'enc:v1:';
const KEY_MATERIAL_STORAGE = 'ill-key-material';

/** Get or create a persistent random key material (stored in localStorage). */
function getKeyMaterial(): Uint8Array {
  try {
    const existing = localStorage.getItem(KEY_MATERIAL_STORAGE);
    if (existing) {
      return Uint8Array.from(atob(existing), c => c.charCodeAt(0));
    }
  } catch {
    // ignore parse errors
  }
  // Generate new random key material
  const material = crypto.getRandomValues(new Uint8Array(32));
  try {
    localStorage.setItem(KEY_MATERIAL_STORAGE, btoa(String.fromCharCode(...material)));
  } catch {
    // localStorage unavailable
  }
  return material;
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const material = getKeyMaterial();
  // Copy into a plain ArrayBuffer-backed Uint8Array — WebCrypto rejects
  // SharedArrayBuffer-backed views under stricter lib.dom.d.ts typings.
  const keyBytes = new Uint8Array(material.byteLength);
  keyBytes.set(material);
  cachedKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedKey;
}

/** Encrypt a plaintext string. Returns "enc:v1:<base64>" */
export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  try {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    // Combine IV + ciphertext into one buffer
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return ENC_PREFIX + btoa(String.fromCharCode(...combined));
  } catch {
    // If encryption fails, return plaintext (graceful degradation)
    return plaintext;
  }
}

/** Decrypt a value. Handles both encrypted ("enc:v1:...") and plain strings. */
export async function decryptValue(value: string): Promise<string> {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const key = await getKey();
    const combined = Uint8Array.from(atob(value.slice(ENC_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    // If decryption fails (e.g., key material changed), return empty
    return '';
  }
}

/** Check if a value is already encrypted */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
