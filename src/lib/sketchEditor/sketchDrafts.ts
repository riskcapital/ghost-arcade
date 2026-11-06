/**
 * Unsaved sketch edits, kept on this computer until they are saved or let go.
 *
 * The editor writes the files as typed before every moment the code runs
 * (each live preview, the check before saving). If that code takes the app
 * down, or the app is closed some other way, the next time the same sketch
 * opens its edits come back instead of being lost. A draft belongs to the
 * files it was typed over: once those change (a save from somewhere else),
 * it no longer applies and is dropped.
 */

const PREFIX = 'ghost-arcade-sketch-draft:';
/** Bigger drafts are not kept; local storage is small and shared with the app. */
const MAX_DRAFT_CHARS = 2 * 1024 * 1024;

export interface SketchDraft {
  /** The saved files the edits were typed over (see draftBase). */
  base: string;
  texts: Record<string, string>;
  savedAt: number;
}

/** What a draft was typed over: the saved texts, in a stable form. */
export function draftBase(texts: Record<string, string>): string {
  return JSON.stringify(Object.entries(texts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keeps the edits to the sketch `id`; quietly does nothing when they cannot be kept. */
export function keepSketchDraft(id: string, saved: Record<string, string>, texts: Record<string, string>): void {
  const store = storage();
  if (!store || !id) return;
  const draft: SketchDraft = { base: draftBase(saved), texts, savedAt: Date.now() };
  const json = JSON.stringify(draft);
  try {
    if (json.length > MAX_DRAFT_CHARS) store.removeItem(PREFIX + id);
    else store.setItem(PREFIX + id, json);
  } catch {
    /* storage full or unavailable: the draft just isn't kept */
  }
}

/**
 * The edits kept for the sketch `id`, when they were typed over the files it
 * holds now and differ from them; otherwise null (and a stale draft goes).
 */
export function readSketchDraft(id: string, saved: Record<string, string>): Record<string, string> | null {
  const store = storage();
  if (!store || !id) return null;
  let draft: SketchDraft | null = null;
  try {
    const raw = store.getItem(PREFIX + id);
    draft = raw ? JSON.parse(raw) as SketchDraft : null;
  } catch {
    draft = null;
  }
  if (!draft || typeof draft.texts !== 'object' || draft.texts === null) return null;
  const texts: Record<string, string> = {};
  for (const [path, text] of Object.entries(draft.texts)) {
    if (path in saved && typeof text === 'string') texts[path] = text;
  }
  const changed = Object.keys(texts).some((path) => texts[path] !== saved[path]);
  if (draft.base !== draftBase(saved) || !changed) {
    dropSketchDraft(id);
    return null;
  }
  return { ...saved, ...texts };
}

export function dropSketchDraft(id: string): void {
  const store = storage();
  if (!store || !id) return;
  try {
    store.removeItem(PREFIX + id);
  } catch {
    /* nothing to drop */
  }
}
