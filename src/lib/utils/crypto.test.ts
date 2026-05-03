import { describe, it, expect } from 'vitest';
import { encryptValue, decryptValue, isEncrypted } from './crypto';

describe('crypto', () => {
  it('encrypts and decrypts a value roundtrip', async () => {
    const original = 'sk-ant-api03-test-key-12345';
    const encrypted = await encryptValue(original);
    expect(encrypted).not.toBe(original);
    expect(isEncrypted(encrypted)).toBe(true);
    const decrypted = await decryptValue(encrypted);
    expect(decrypted).toBe(original);
  });

  it('returns empty string as-is', async () => {
    expect(await encryptValue('')).toBe('');
    expect(await decryptValue('')).toBe('');
  });

  it('decrypts plaintext (unencrypted) values as-is', async () => {
    const plain = 'my-plain-key';
    expect(await decryptValue(plain)).toBe(plain);
  });

  it('isEncrypted detects prefix', () => {
    expect(isEncrypted('enc:v1:abc123')).toBe(true);
    expect(isEncrypted('plain-key')).toBe(false);
    expect(isEncrypted('')).toBe(false);
  });

  it('produces different ciphertexts for same input (unique IV)', async () => {
    const value = 'test-api-key';
    const enc1 = await encryptValue(value);
    const enc2 = await encryptValue(value);
    expect(enc1).not.toBe(enc2); // Different IVs
    expect(await decryptValue(enc1)).toBe(value);
    expect(await decryptValue(enc2)).toBe(value);
  });
});
