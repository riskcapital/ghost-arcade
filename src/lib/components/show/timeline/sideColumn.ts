/**
 * The Timeline's side column: Inspector, Media and Perform tabs beside the
 * lanes. One explicit state with one transition function (`sideStep`), so
 * the column can never be "on the Media tab but closed and Perform-wide".
 *
 *   open    the column shows (closed: the lanes get the width back)
 *   tab     which tab shows while it is open
 *   widths  the column's width for the Inspector / Media tabs ('panel') and
 *           for Perform (wider: the cue list and the pads), each 300–720
 *
 * A view preference of this computer (local storage), never the project's.
 */
import { derived, get, writable, type Readable } from 'svelte/store';

export type SideTab = 'inspector' | 'media' | 'perform';
export const SIDE_TABS: readonly SideTab[] = ['inspector', 'media', 'perform'];

export const SIDE_MIN_WIDTH = 300;
export const SIDE_MAX_WIDTH = 720;
export const SIDE_PANEL_WIDTH = 336;
export const SIDE_PERFORM_WIDTH = 600;

export interface SideState {
  open: boolean;
  tab: SideTab;
  widths: { panel: number; perform: number };
}

export type SideEvent =
  /** A tab was clicked (opens the column on it). */
  | { kind: 'show'; tab: SideTab }
  /** The toolbar's Perform button: Perform opens, or closes when it already shows. */
  | { kind: 'toggle'; tab: SideTab }
  /** × on the column. */
  | { kind: 'close' }
  /** A block, section, marker… was selected: the Inspector shows it, unless Perform is open (the show runs there). */
  | { kind: 'selected' }
  /** A row was clicked to drop media on it: the Media tab. */
  | { kind: 'rowTarget' }
  /** The column's edge was dragged. */
  | { kind: 'resize'; width: number };

export const DEFAULT_SIDE: SideState = { open: true, tab: 'inspector', widths: { panel: SIDE_PANEL_WIDTH, perform: SIDE_PERFORM_WIDTH } };

export function clampSideWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDE_PANEL_WIDTH;
  return Math.round(Math.max(SIDE_MIN_WIDTH, Math.min(SIDE_MAX_WIDTH, w)));
}

/** Which width a tab uses. */
export function widthKey(tab: SideTab): 'panel' | 'perform' {
  return tab === 'perform' ? 'perform' : 'panel';
}

/** The column's width now (0 when closed). */
export function sideWidth(s: SideState): number {
  return s.open ? s.widths[widthKey(s.tab)] : 0;
}

export function sideStep(s: SideState, e: SideEvent): SideState {
  switch (e.kind) {
    case 'show':
      return s.open && s.tab === e.tab ? s : { ...s, open: true, tab: e.tab };
    case 'toggle':
      return s.open && s.tab === e.tab ? { ...s, open: false } : { ...s, open: true, tab: e.tab };
    case 'close':
      return s.open ? { ...s, open: false } : s;
    case 'selected':
      if (s.open && s.tab === 'perform') return s;
      return s.open && s.tab === 'inspector' ? s : { ...s, open: true, tab: 'inspector' };
    case 'rowTarget':
      return s.open && s.tab === 'media' ? s : { ...s, open: true, tab: 'media' };
    case 'resize': {
      const key = widthKey(s.tab);
      const w = clampSideWidth(e.width);
      return s.widths[key] === w ? s : { ...s, widths: { ...s.widths, [key]: w } };
    }
  }
}

// ── Saved on this computer ──────────────────────────────────────────────

export const SIDE_KEY = 'ga.timeline.side';

export function parseSide(raw: string | null): SideState {
  try {
    const v = raw ? JSON.parse(raw) as Partial<SideState> : null;
    if (!v || typeof v !== 'object') return DEFAULT_SIDE;
    const tab = SIDE_TABS.includes(v.tab as SideTab) ? v.tab as SideTab : DEFAULT_SIDE.tab;
    return {
      open: typeof v.open === 'boolean' ? v.open : DEFAULT_SIDE.open,
      tab,
      widths: {
        panel: clampSideWidth(Number(v.widths?.panel ?? SIDE_PANEL_WIDTH)),
        perform: clampSideWidth(Number(v.widths?.perform ?? SIDE_PERFORM_WIDTH)),
      },
    };
  } catch {
    return DEFAULT_SIDE;
  }
}

function load(): SideState {
  try { return parseSide(typeof localStorage !== 'undefined' ? localStorage.getItem(SIDE_KEY) : null); } catch { return DEFAULT_SIDE; }
}

const state = writable<SideState>(load());

/** The side column's state (read only; change it with `sideColumn.send`). */
export const sideColumn = {
  subscribe: state.subscribe,
  send(e: SideEvent): void {
    const prev = get(state);
    const next = sideStep(prev, e);
    if (next === prev) return;
    state.set(next);
    // A drag sends many resizes; the saved copy only needs the last.
    if (e.kind === 'resize') scheduleSave(next);
    else save(next);
  },
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(s: SideState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(s); }, 250);
}
function save(s: SideState): void {
  try { localStorage.setItem(SIDE_KEY, JSON.stringify(s)); } catch { /* private window */ }
}

/** The Perform tab is showing. */
export const performShown: Readable<boolean> = derived(state, (s) => s.open && s.tab === 'perform');
/** The Media tab is showing. */
export const mediaTabShown: Readable<boolean> = derived(state, (s) => s.open && s.tab === 'media');
