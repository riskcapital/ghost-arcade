import { derived, writable, type Readable } from 'svelte/store';
import en from './messages/en';
import ko from './messages/ko';

export type AppLocale = 'en' | 'ko';
export type TranslationValues = Record<string, string | number>;
export type TranslateOptions = { values?: TranslationValues };
export type Translate = (key: string, options?: TranslateOptions) => string;

export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_STORAGE_KEY = 'ghost-arcade_locale';
export const SUPPORTED_LOCALES: ReadonlyArray<{ id: AppLocale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ko', label: '한국어' },
];

const catalogs = { en, ko } as const;
type MessageNode = string | { readonly [key: string]: MessageNode };

export function normalizeLocale(value: string | null | undefined): AppLocale {
  const language = value?.trim().toLowerCase().replace('_', '-');
  return language === 'ko' || language?.startsWith('ko-') ? 'ko' : DEFAULT_LOCALE;
}

export function detectInitialLocale(): AppLocale {
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved) return normalizeLocale(saved);
    } catch {
      // Storage can be blocked by browser privacy settings.
    }
  }

  if (typeof navigator !== 'undefined') {
    return normalizeLocale(navigator.language);
  }

  return DEFAULT_LOCALE;
}

function resolveMessage(locale: AppLocale, key: string): string | undefined {
  let node: MessageNode = catalogs[locale];
  for (const segment of key.split('.')) {
    if (typeof node === 'string' || !(segment in node)) return undefined;
    node = node[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

function formatMessage(message: string, values: TranslationValues = {}): string {
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder,
  );
}

export function translate(locale: AppLocale, key: string, options?: TranslateOptions): string {
  const message = resolveMessage(locale, key) ?? resolveMessage(DEFAULT_LOCALE, key) ?? key;
  return formatMessage(message, options?.values);
}

const localeStore = writable<AppLocale>(detectInitialLocale());
export const activeLocale: Readable<AppLocale> = { subscribe: localeStore.subscribe };
export const t: Readable<Translate> = derived(
  localeStore,
  (locale) =>
    (key: string, options?: TranslateOptions): string =>
      translate(locale, key, options),
);

function syncLocaleMetadata(value: AppLocale): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, value);
    } catch {
      // Locale switching must still work when storage is unavailable.
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
  }
}

syncLocaleMetadata(detectInitialLocale());

export function setLocale(value: AppLocale): void {
  localeStore.set(value);
  syncLocaleMetadata(value);
}
