import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'svelte/store';
import en from './messages/en';
import ko from './messages/ko';
import {
  activeLocale,
  DEFAULT_LOCALE,
  detectInitialLocale,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  setLocale,
  SUPPORTED_LOCALES,
  t,
  translate,
} from './index';

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];

  return Object.entries(value)
    .flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.svelte', '.ts'].includes(extname(entry.name)) ? [path] : [];
  });
}

function referencedMessageKeys(): string[] {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const keys = new Set<string>();
  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\$t\(\s*['"]([^'"]+)['"]/g)) {
      keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

describe('localization catalogs', () => {
  it('keeps English and Korean message keys in parity', () => {
    expect(leafPaths(ko)).toEqual(leafPaths(en));
  });

  it('supports only the declared application locales', () => {
    expect(SUPPORTED_LOCALES.map(({ id }) => id)).toEqual(['en', 'ko']);
  });

  it('defines every statically referenced message key', () => {
    const defined = new Set(leafPaths(en));
    const missing = referencedMessageKeys().filter((key) => !defined.has(key));
    expect(missing).toEqual([]);
  });

  it('uses ICU single-brace interpolation syntax', () => {
    expect(JSON.stringify(en)).not.toMatch(/\{\{/);
    expect(JSON.stringify(ko)).not.toMatch(/\{\{/);
  });
});

describe('normalizeLocale', () => {
  it.each([
    ['ko', 'ko'],
    ['ko-KR', 'ko'],
    ['KO_kr', 'ko'],
    ['korean', DEFAULT_LOCALE],
    ['en', DEFAULT_LOCALE],
    ['ja-JP', DEFAULT_LOCALE],
    [null, DEFAULT_LOCALE],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});

describe('detectInitialLocale', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers the persisted locale over the browser locale', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === LOCALE_STORAGE_KEY ? 'en' : null),
      setItem: vi.fn(),
    });
    vi.stubGlobal('navigator', { language: 'ko-KR' });

    expect(detectInitialLocale()).toBe('en');
  });

  it('uses the browser locale when no preference is saved', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
    });
    vi.stubGlobal('navigator', { language: 'ko-KR' });

    expect(detectInitialLocale()).toBe('ko');
  });

  it('uses the browser locale when storage access is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    vi.stubGlobal('navigator', { language: 'ko-KR' });

    expect(detectInitialLocale()).toBe('ko');
  });
});

describe('locale switching', () => {
  afterEach(() => {
    setLocale(DEFAULT_LOCALE);
    vi.unstubAllGlobals();
  });

  it('switches messages immediately and persists the selected locale', async () => {
    const setItem = vi.fn();
    const documentElement = { lang: '' };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    vi.stubGlobal('document', { documentElement });

    setLocale('ko');

    expect(get(activeLocale)).toBe('ko');
    expect(get(t)('settings.title')).toBe('설정');
    await vi.waitFor(() => {
      expect(documentElement.lang).toBe('ko');
      expect(setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'ko');
    });
  });

  it('interpolates values and returns the key for unknown messages', () => {
    expect(translate('ko', 'vj.grid.deck', { values: { deck: 'A' } })).toBe('DECK A');
    expect(translate('ko', 'missing.translation.key')).toBe('missing.translation.key');
  });

  it('still switches locale when persistence is blocked', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });

    expect(() => setLocale('ko')).not.toThrow();
    expect(get(activeLocale)).toBe('ko');
  });
});
