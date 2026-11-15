/**
 * The Timeline's rows in folding sections, top to bottom: Audio, Groups,
 * Layers (layersSection.ts), Stage & FX, Control. Each has a 24 px header
 * with a fold; a folded section shows a one-line summary instead of its rows.
 *
 * Rows appear when used: Presets, Looks, Screen FX, Effects, LEDs and the
 * camera show once they have something on them, once "+ Row" asked for one
 * this session, or with "Show every row" pinned. Sections with no rows are
 * hidden, except Audio and Layers. What shows is derived, never stored; the
 * folds are a view preference of this computer, kept per project (the
 * oldest dropped first), and nothing here goes into the project or undo.
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import { project } from '../../../stores/layers';
import { distinct } from './timelineSlices';

export const SECTION_HEADER_HEIGHT = 24;

export type FoldSection = 'audio' | 'groups' | 'stage' | 'control';
export const FOLD_SECTIONS: readonly FoldSection[] = ['audio', 'groups', 'stage', 'control'];

/** Folded sections (true: folded). */
export type SectionFolds = Readonly<Record<FoldSection, boolean>>;
export const NO_FOLDS: SectionFolds = { audio: false, groups: false, stage: false, control: false };

export type FoldEvent =
  | { kind: 'toggle'; id: FoldSection }
  | { kind: 'open'; id: FoldSection }
  | { kind: 'fold'; id: FoldSection };

export function foldStep(f: SectionFolds, e: FoldEvent): SectionFolds {
  const next = e.kind === 'toggle' ? !f[e.id] : e.kind === 'fold';
  return f[e.id] === next ? f : { ...f, [e.id]: next };
}

// ── Rows that appear when used ───────────────────────────────────────────

/** The rows "+ Row" can add. */
export type RowKind = 'audio' | 'ableton' | 'group' | 'layerOnPiece' | 'presets' | 'looks' | 'screenfx' | 'effects' | 'leds' | 'camera' | 'line';

/** The special rows that hide while empty. */
export type SpecialRow = 'presets' | 'looks' | 'screenfx' | 'effects' | 'leds' | 'camera';

export interface RowCounts {
  presets: number;
  looks: number;
  /** Lines under the Looks row (they keep it showing). */
  looksLines: number;
  screenfx: number;
  effects: number;
  /** LED controllers and ranges set up (their rows). */
  ledRows: number;
  camera: number;
  groupRows: number;
  /** Stage-wide control lines (the Control section). */
  controlLines: number;
}

export interface RowPresence {
  presets: boolean;
  looks: boolean;
  screenfx: boolean;
  effects: boolean;
  leds: boolean;
  camera: boolean;
  /** The Stage & FX section shows (any of the rows above). */
  stage: boolean;
  groups: boolean;
  control: boolean;
}

/** Which rows and sections show. Pure: everything it needs is passed in. */
export function rowPresence(c: RowCounts, asked: ReadonlySet<SpecialRow | 'control' | 'groups'>, showEvery: boolean): RowPresence {
  const on = (n: number, kind: SpecialRow | 'control' | 'groups') => showEvery || n > 0 || asked.has(kind);
  const presets = on(c.presets, 'presets');
  const looks = on(c.looks + c.looksLines, 'looks');
  const screenfx = on(c.screenfx, 'screenfx');
  const effects = on(c.effects, 'effects');
  // LED rows exist only for set-up controllers: nothing to show without one.
  const leds = c.ledRows > 0;
  const camera = on(c.camera, 'camera');
  return {
    presets, looks, screenfx, effects, leds, camera,
    stage: presets || looks || screenfx || effects || leds || camera,
    // A group row only exists once made; the header waits for one (or Show every row).
    groups: c.groupRows > 0 || (showEvery && asked.has('groups')),
    control: on(c.controlLines, 'control'),
  };
}

/** One line saying what a folded Stage & FX section holds. */
export function stageSummary(p: RowPresence, names: Record<SpecialRow, string>): string {
  return (['presets', 'looks', 'screenfx', 'effects', 'leds', 'camera'] as const).filter((k) => p[k]).map((k) => names[k]).join(', ');
}

// ── Session and saved state ──────────────────────────────────────────────

/** Rows "+ Row" asked for this session (shown while still empty). */
export const askedRows = writable<ReadonlySet<SpecialRow | 'control' | 'groups'>>(new Set());

export function askForRow(kind: SpecialRow | 'control' | 'groups'): void {
  askedRows.update((s) => (s.has(kind) ? s : new Set([...s, kind])));
}

export const SHOW_EVERY_KEY = 'ga.timeline.showEveryRow';
function loadShowEvery(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_EVERY_KEY) === '1'; } catch { return false; }
}
const showEvery = writable<boolean>(loadShowEvery());
/** "Show every row" (the pin in the corner cell): the full grid, empty rows too. */
export const showEveryRow = { subscribe: showEvery.subscribe };
export function setShowEveryRow(on: boolean): void {
  showEvery.set(on);
  try { localStorage.setItem(SHOW_EVERY_KEY, on ? '1' : '0'); } catch { /* private window */ }
}

export const FOLDS_KEY = 'ga.timeline.sectionFolds';
export const FOLDS_CAP = 64;
export type FoldChoices = Array<[projectId: string, folds: SectionFolds]>;

function cleanFolds(raw: unknown): SectionFolds | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return { audio: r.audio === true, groups: r.groups === true, stage: r.stage === true, control: r.control === true };
}

/** The list with `projectId`'s folds last (most recent), at most `cap` long. */
export function rememberFolds(list: FoldChoices, projectId: string, folds: SectionFolds, cap = FOLDS_CAP): FoldChoices {
  const next = list.filter(([id]) => id !== projectId);
  next.push([projectId, folds]);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function parseFoldChoices(raw: string | null): FoldChoices {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const out: FoldChoices = [];
    for (const e of parsed) {
      if (!Array.isArray(e) || typeof e[0] !== 'string') continue;
      const f = cleanFolds(e[1]);
      if (f) out.push([e[0], f]);
    }
    return out.slice(-FOLDS_CAP);
  } catch {
    return [];
  }
}

function readChoices(): FoldChoices {
  try { return parseFoldChoices(typeof localStorage !== 'undefined' ? localStorage.getItem(FOLDS_KEY) : null); } catch { return []; }
}

const projectId = distinct(derived(project, (p) => (p as { id?: string }).id ?? ''));
const folds = writable<SectionFolds>(NO_FOLDS);
projectId.subscribe((id) => {
  const found = id ? readChoices().find(([pid]) => pid === id) : undefined;
  folds.set(found ? found[1] : NO_FOLDS);
});

/** This project's folded sections. */
export const sectionFolds: Readable<SectionFolds> = { subscribe: folds.subscribe };

export function sendFold(e: FoldEvent): void {
  const prev = get(folds);
  const next = foldStep(prev, e);
  if (next === prev) return;
  folds.set(next);
  const id = get(projectId);
  if (!id) return;
  try { localStorage.setItem(FOLDS_KEY, JSON.stringify(rememberFolds(readChoices(), id, next))); } catch { /* private window */ }
}
