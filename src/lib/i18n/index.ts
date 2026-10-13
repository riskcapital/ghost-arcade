/**
 * Interface translation.
 *
 * The interface is written in English. A language pack is a dictionary from
 * the English text to its translation, and this module swaps the text in the
 * page: text nodes, tooltips, placeholders and screen-reader labels. Nothing
 * runs while the language is English.
 *
 * Text with changing parts is matched as a pattern: "Layers: 4" looks up
 * "Layers: {0}", and "Selected: Wall" matches the pack's "Selected: {0}".
 * Anything a pack does not cover stays in English.
 *
 * Mark content that must never be translated (names the user typed, file
 * names) with translate="no".
 */
import { writable, get } from 'svelte/store';
import './translated.css';

export interface UiLanguage { code: string; name: string; english: string; beta?: boolean }

export const UI_LANGUAGES: UiLanguage[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'es', name: 'Español', english: 'Spanish', beta: true },
  { code: 'de', name: 'Deutsch', english: 'German', beta: true },
  { code: 'fr', name: 'Français', english: 'French', beta: true },
  { code: 'pt-BR', name: 'Português (Brasil)', english: 'Portuguese (Brazil)', beta: true },
  { code: 'it', name: 'Italiano', english: 'Italian', beta: true },
  { code: 'ja', name: '日本語', english: 'Japanese', beta: true },
];

const STORAGE_KEY = 'ghostarcade-language';
const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'data-help'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'CANVAS', 'SVG', 'NOSCRIPT']);
// Names the user typed or files they loaded: shown as they are.
const USER_CONTENT = ['layer-name', 'clip-name', 'preset-name', 'item-name', 'source-name', 'screen-name', 'slice-name', 'file-name', 'media-name', 'project-name', 'device-name'];

function excluded(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.getAttribute('translate') === 'no' || (el as HTMLElement).isContentEditable) return true;
  const classes = el.classList;
  for (const name of USER_CONTENT) if (classes.contains(name)) return true;
  return false;
}

export function normalizeLanguage(value: unknown): string {
  return UI_LANGUAGES.some((l) => l.code === value) ? (value as string) : 'en';
}

let initial = 'en';
try { initial = normalizeLanguage(localStorage.getItem(STORAGE_KEY)); } catch { /* optional storage */ }

/** The interface language. Saved with this computer's settings. */
export const uiLanguage = writable<string>(initial);

export function resetLanguageToEnglish(): void {
  uiLanguage.set('en');
}

// ─── Dictionary lookup ───────────────────────────────────────────────────

type Pack = Record<string, string>;
interface Pattern { regex: RegExp; out: string }

const packs = import.meta.glob<{ default: Pack }>('./locales/*.json');
let dictionary: Pack = {};
let patterns: Pattern[] = [];
let cache = new Map<string, string | null>();
const CACHE_LIMIT = 6000;

const NUMBER = /\d+(?:[.,:]\d+)*/g;
const HAS_LETTER = /[A-Za-z]/;

function fill(template: string, parts: string[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, index) => parts[Number(index)] ?? whole);
}

/** Exposed for tests. Returns null when the pack has nothing for this text. */
export function translateText(source: string, pack: Pack = dictionary, packPatterns: Pattern[] = patterns): string | null {
  const exact = pack[source];
  if (exact !== undefined) return exact;
  // Numbers become placeholders: "Layers: 4" → "Layers: {0}".
  const numbers: string[] = [];
  const numbered = source.replace(NUMBER, (n) => `{${numbers.push(n) - 1}}`);
  if (numbers.length) {
    const hit = pack[numbered];
    if (hit !== undefined) return fill(hit, numbers);
  }
  if (source.length <= 160) {
    for (const pattern of packPatterns) {
      const match = pattern.regex.exec(source);
      if (match) return fill(pattern.out, match.slice(1));
    }
  }
  return null;
}

export function buildPatterns(pack: Pack): Pattern[] {
  const out: Pattern[] = [];
  for (const [source, translation] of Object.entries(pack)) {
    if (!source.includes('{0}')) continue;
    // A pattern needs real words around its gaps, or it would match anything.
    if (source.replace(/\{\d+\}/g, '').replace(/[^A-Za-z]/g, '').length < 3) continue;
    const body = source.split(/\{\d+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
    out.push({ regex: new RegExp(`^${body}$`), out: translation });
  }
  return out;
}

function lookup(text: string): string | null {
  const key = text.trim().replace(/\s+/g, ' ');
  if (key.length < 2 || !HAS_LETTER.test(key)) return null;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = translateText(key);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, hit);
  }
  if (hit === null) return null;
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  return lead + hit + trail;
}

// ─── Page swapping ───────────────────────────────────────────────────────

interface Swapped { source: string; out: string }
const textState = new WeakMap<Text, Swapped>();
const attrState = new WeakMap<Element, Record<string, Swapped>>();
let observer: MutationObserver | null = null;
let active = false;

function skipped(element: Element | null): boolean {
  for (let el = element; el; el = el.parentElement) if (excluded(el)) return true;
  return false;
}

function swapText(node: Text): void {
  const current = node.data;
  const state = textState.get(node);
  if (state && current === state.out) return;
  const out = lookup(current);
  if (out === null || out === current) {
    if (state) textState.delete(node);
    return;
  }
  textState.set(node, { source: current, out });
  node.data = out;
}

function swapAttributes(element: Element): void {
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const states = attrState.get(element);
    const state = states?.[name];
    if (state && current === state.out) continue;
    const out = lookup(current);
    if (out === null || out === current) continue;
    attrState.set(element, { ...(states ?? {}), [name]: { source: current, out } });
    element.setAttribute(name, out);
  }
}

function swapTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped(root.parentElement)) swapText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || skipped(root as Element)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return excluded(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  swapAttributes(root as Element);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) swapText(node as Text);
    else swapAttributes(node as Element);
  }
}

function restoreTree(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node: Node | null = root; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const state = textState.get(node as Text);
      if (state && (node as Text).data === state.out) (node as Text).data = state.source;
      textState.delete(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const states = attrState.get(node as Element);
      if (!states) continue;
      for (const [name, state] of Object.entries(states)) {
        if ((node as Element).getAttribute(name) === state.out) (node as Element).setAttribute(name, state.source);
      }
      attrState.delete(node as Element);
    }
  }
}

function observe(): void {
  observer ??= new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        if (!skipped(record.target.parentElement)) swapText(record.target as Text);
      } else if (record.type === 'attributes') {
        if (!skipped(record.target as Element)) swapAttributes(record.target as Element);
      } else {
        for (const added of record.addedNodes) swapTree(added);
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
}

async function apply(code: string): Promise<void> {
  if (typeof document === 'undefined') return;
  observer?.disconnect();
  if (active) restoreTree(document.body);
  active = false;
  dictionary = {};
  patterns = [];
  cache = new Map();
  document.documentElement.lang = code;
  if (code === 'en') return;
  const load = packs[`./locales/${code}.json`];
  if (!load) return;
  try {
    const pack = (await load()).default;
    // The user may have switched again while the pack was loading.
    if (get(uiLanguage) !== code) return;
    dictionary = pack;
    patterns = buildPatterns(pack);
  } catch (error) {
    console.warn('[Language] could not load', code, error);
    return;
  }
  active = true;
  swapTree(document.body);
  observe();
}

/** Only the main editor window starts this; output windows carry no text. */
export function startTranslation(): () => void {
  const stop = uiLanguage.subscribe((value) => {
    const code = normalizeLanguage(value);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* session preference still works */ }
    void apply(code);
  });
  // The way back for anyone who picked a language they cannot read:
  // Ctrl/Cmd + Shift + E returns the interface to English.
  const onKey = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'e' || get(uiLanguage) === 'en') return;
    event.preventDefault();
    event.stopPropagation();
    resetLanguageToEnglish();
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey, true);
  return () => {
    stop();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey, true);
    observer?.disconnect();
    if (active && typeof document !== 'undefined') restoreTree(document.body);
    active = false;
  };
}
