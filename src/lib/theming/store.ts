// Active theme store. Owns the document-level CSS variable write so
// every component just references `var(--*)`; swapping the active
// theme is one writable.set() away.
//
// Tokens land on :root as `--ga-*` properties so they don't clash with
// component-local --custom-property names. A `data-theme` attribute is
// also set on <html> so theme-conditional CSS (Arcade's CRT layer,
// etc.) can target it via [data-theme="arcade"].

import { writable, get } from 'svelte/store';
import { THEMES, DEFAULT_THEME_ID, findTheme } from './themes';
import type { Theme, ThemeTokens } from './types';

// v2: retro (Arcade) became the default — the key bump re-defaults
// everyone once; picking a theme afterwards still persists normally.
const STORAGE_KEY = 'ga-active-theme-v2';

/** snake-case → kebab-case for CSS variable names. `fontUi` → `font-ui`. */
function tokenToVar(key: string): string {
  return '--ga-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
}

/** Push every token from a theme into :root as a CSS variable. Also
 *  applies the legacy bridge so unmigrated components re-skin, and
 *  pumps the optional extraCss into a tagged <style> so swapping
 *  themes doesn't leak the previous theme's overlay styles. */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.tokens) as [keyof ThemeTokens, string | undefined][]) {
    if (value !== undefined) root.style.setProperty(tokenToVar(key), value);
  }
  // Legacy bridge — write through to the pre-token CSS variable names
  // so every existing component (panels, modals, fields) automatically
  // re-skins to the new theme's surface ladder without per-file edits.
  if (theme.legacyVars) {
    for (const [name, value] of Object.entries(theme.legacyVars)) {
      root.style.setProperty(name, value);
    }
  }
  root.setAttribute('data-theme', theme.id);

  // extraCss handler — single tagged <style> we own outright.
  let extraStyle = document.getElementById('ga-theme-extra') as HTMLStyleElement | null;
  if (theme.extraCss) {
    if (!extraStyle) {
      extraStyle = document.createElement('style');
      extraStyle.id = 'ga-theme-extra';
      document.head.appendChild(extraStyle);
    }
    extraStyle.textContent = theme.extraCss;
  } else if (extraStyle) {
    extraStyle.textContent = '';
  }
}

function loadFromStorage(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && THEMES.some(t => t.id === id)) return id;
  } catch { /* ignore */ }
  return DEFAULT_THEME_ID;
}

function createThemeStore() {
  const { subscribe, set } = writable<string>(loadFromStorage());

  // Apply on first read so SSR / hot reload land in the right theme.
  applyTheme(findTheme(get({ subscribe })));

  return {
    subscribe,
    /** Switch themes by id. Persists to localStorage so the choice
     *  survives reloads. Falls back to Studio when the id is unknown. */
    set(id: string) {
      const theme = findTheme(id);
      set(theme.id);
      applyTheme(theme);
      try { localStorage.setItem(STORAGE_KEY, theme.id); } catch { /* private mode */ }
    },
    /** Re-apply the currently active theme — useful after the document
     *  re-renders something that wipes :root (rare, but possible with
     *  print stylesheets / external plugins). */
    refresh() {
      applyTheme(findTheme(get({ subscribe })));
    },
  };
}

export const activeThemeId = createThemeStore();

/** Convenience accessor so components can `themes.list()` without
 *  importing from the registry module directly. */
export const themes = {
  list: (): Theme[] => THEMES,
  find: findTheme,
};
