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

function leafMessages(value: unknown, prefix = ''): Map<string, string> {
  if (typeof value === 'string') return new Map([[prefix, value]]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();

  return new Map(
    Object.entries(value).flatMap(([key, child]) => [...leafMessages(child, prefix ? `${prefix}.${key}` : key)]),
  );
}

function placeholders(message: string): string[] {
  // English metadata descriptions delegate to their source descriptor,
  // while Korean supplies the translated sentence. English plural suffixes
  // also have no Korean grammatical equivalent.
  if (message === '{description}') return [];
  return [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
    .map((match) => match[1])
    .filter((placeholder) => placeholder !== 'suffix')
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
  const catalogRoots = new Set(Object.keys(en));
  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\$t\(\s*['"]([^'"]+)['"]/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(
      /\b(?:labelKey|titleKey|hintKey|ariaKey|descriptionKey|commandKey|nameKey|shortKey)\s*:\s*['"]([^'"]+)['"]/g,
    )) {
      if (match[1].includes('.')) keys.add(match[1]);
    }
    for (const match of source.matchAll(/['"]([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)['"]/g)) {
      if (catalogRoots.has(match[1].split('.')[0])) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

function referencedDynamicPrefixes(): string[] {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const prefixes = new Set<string>();
  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\$t\(\s*`([^`$]*)\$\{/g)) {
      const prefix = match[1].replace(/\.$/, '');
      if (prefix) prefixes.add(prefix);
    }
  }
  return [...prefixes].sort();
}

describe('localization catalogs', () => {
  it('keeps English and Korean message keys in parity', () => {
    expect(leafPaths(ko)).toEqual(leafPaths(en));
  });

  it('keeps English and Korean interpolation placeholders in parity', () => {
    const english = leafMessages(en);
    const korean = leafMessages(ko);
    const mismatches = [...english].flatMap(([key, message]) => {
      const englishPlaceholders = placeholders(message);
      const koreanPlaceholders = placeholders(korean.get(key) ?? '');
      return englishPlaceholders.join('\0') === koreanPlaceholders.join('\0')
        ? []
        : [{ key, en: englishPlaceholders, ko: koreanPlaceholders }];
    });
    expect(mismatches).toEqual([]);
  });

  it('supports only the declared application locales', () => {
    expect(SUPPORTED_LOCALES.map(({ id }) => id)).toEqual(['en', 'ko']);
  });

  it('defines every statically referenced message key', () => {
    const defined = new Set(leafPaths(en));
    const missing = referencedMessageKeys().filter((key) => !defined.has(key));
    expect(missing).toEqual([]);
  });

  it('defines a catalog subtree for every dynamic message prefix', () => {
    const defined = leafPaths(en);
    const missing = referencedDynamicPrefixes().filter(
      (prefix) => !defined.some((key) => key === prefix || key.startsWith(`${prefix}.`)),
    );
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

  it('syncs locale changes from another app window', async () => {
    let storageListener: ((event: StorageEvent) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage') storageListener = listener;
      },
    });
    vi.stubGlobal('localStorage', {
      getItem: () => 'en',
      setItem: vi.fn(),
    });
    const documentElement = { lang: '' };
    vi.stubGlobal('document', { documentElement });
    vi.resetModules();
    const freshI18n = await import('./index');

    storageListener?.({ key: LOCALE_STORAGE_KEY, newValue: 'ko-KR' } as StorageEvent);

    expect(get(freshI18n.activeLocale)).toBe('ko');
    expect(get(freshI18n.t)('screens.inspector.identity.physicalDisplay')).toBe('실제 디스플레이');
    expect(documentElement.lang).toBe('ko');
  });
});
