/**
 * Cue list: the theatre-style GO list that runs a show unattended.
 *
 * WHAT A CUE IS
 * -------------
 * A numbered step with a list of ACTIONS (recall a mapping preset or a
 * snapshot, launch a VJ clip or column, blackout, set a macro / layer / any
 * control path to a value over a fade time, drive the show timeline or the
 * projectors) and a FOLLOW that says what happens after it fires:
 *
 *   mode 'go'    wait for the operator's GO
 *   mode 'auto'  fire the follow target by itself after `wait` seconds or
 *                beats (beats convert at the tempo when the cue fires)
 *
 *   target 'next' the cue below it   'jump' a named cue
 *          'loop' the first cue      'end'  nothing (the list stops)
 *
 * With mode 'go' the target decides which cue is standing by, so a 'jump'
 * or 'loop' also works on a manual list.
 *
 * THE ENGINE OWNS TIME, THE EXECUTOR OWNS SIDE EFFECTS
 * ----------------------------------------------------
 * This module never imports the project store, the VJ launcher or the
 * router. App start registers an executor (cueExecutor.ts) that knows how
 * to recall a preset or write a value; tests register a recorder. The clock
 * is injectable too, so a 20-minute show can be proven with fake timers.
 *
 * Firing is always synchronous and follows are always a timer, even a zero
 * wait, so a loop of zero-wait cues cannot recurse or lock the UI.
 *
 * MARKERS
 * -------
 * Markers sit on the show timeline and name a cue. When the timeline plays
 * (or chases timecode) across a marker, that cue fires exactly as if GO had
 * been pressed on it. A jump or a seek does not fire the markers it skipped.
 * Cues can also carry a timecode time of their own, which fires them when a
 * chased timecode clock crosses it.
 */

import { writable, get } from 'svelte/store';
import { generateUUID } from '../utils/uuid';

// ─── Types ───────────────────────────────────────────────────────────────

export type CueDeck = 'A' | 'B';
export type CueTimelineOp = 'play' | 'pause' | 'stop' | 'seek';
export type ProjectorCommand = 'power-on' | 'power-off' | 'shutter-close' | 'shutter-open' | 'input';

export type CueAction =
  | { id: string; kind: 'preset'; compositionId: string }
  | { id: string; kind: 'snapshot'; slot: number }
  | { id: string; kind: 'vjClip'; deck: CueDeck; layer: number; column: number }
  | { id: string; kind: 'vjColumn'; deck: CueDeck; column: number }
  | { id: string; kind: 'vjStopAll' }
  | { id: string; kind: 'blackout'; on: boolean }
  | { id: string; kind: 'macro'; macro: number; value: number; fade: number }
  | { id: string; kind: 'layerOpacity'; layerId: string; value: number; fade: number }
  | { id: string; kind: 'param'; path: string; value: number; fade: number; from: number | null }
  | { id: string; kind: 'timeline'; op: CueTimelineOp; seconds: number }
  | { id: string; kind: 'projector'; projectorId: string; command: ProjectorCommand; input: string };

export type CueActionKind = CueAction['kind'];

export interface CueFollow {
  mode: 'go' | 'auto';
  wait: number;
  unit: 'seconds' | 'beats';
  target: 'next' | 'jump' | 'loop' | 'end';
  jumpTo: string | null;
}

export interface Cue {
  id: string;
  /** Display number, free text so "1", "1.5" and "A" all work. */
  number: string;
  name: string;
  actions: CueAction[];
  follow: CueFollow;
  /** Show-clock seconds at which a chased timecode fires this cue. */
  timecode: number | null;
}

export interface CueMarker {
  id: string;
  /** Show timeline seconds. */
  time: number;
  cueId: string | null;
  label: string;
}

export type CueFireSource = 'go' | 'back' | 'follow' | 'marker' | 'timecode' | 'schedule' | 'remote' | 'manual';

export interface CueFireRecord {
  cueId: string;
  number: string;
  source: CueFireSource;
  /** Engine clock, ms. */
  at: number;
}

export interface PendingFollow {
  fromCueId: string;
  targetCueId: string | null;
  /** Engine clock ms at which the follow fires. */
  firesAt: number;
  totalMs: number;
}

export interface CueListState {
  cues: Cue[];
  markers: CueMarker[];
  /** Last cue that fired. */
  currentCueId: string | null;
  /** Cue that GO fires next. */
  standbyCueId: string | null;
  /** Row the editor is showing. */
  selectedCueId: string | null;
  pendingFollow: PendingFollow | null;
  /** True from a GO until Stop or the end of the list. */
  active: boolean;
  /** Most recent fires, newest last, capped. */
  history: CueFireRecord[];
}

export type CueValueTarget =
  | { kind: 'macro'; macro: number }
  | { kind: 'layerOpacity'; layerId: string }
  | { kind: 'param'; path: string };

/** Side effects. Registered by the app (cueExecutor.ts) or by a test. */
export interface CueExecutor {
  recallPreset(compositionId: string): void;
  /** 1-based slot. */
  recallSnapshot(slot: number): void;
  /** 0-based layer and column. */
  triggerClip(deck: CueDeck, layer: number, column: number): void;
  triggerColumn(deck: CueDeck, column: number): void;
  stopAllClips(): void;
  setBlackout(on: boolean): void;
  readValue(target: CueValueTarget): number | null;
  writeValue(target: CueValueTarget, value: number): void;
  timeline(op: CueTimelineOp, seconds: number): void;
  projector(projectorId: string, command: ProjectorCommand, input: string): unknown;
  /** Current tempo, for waits counted in beats. */
  bpm(): number;
}

export interface CueClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realClock: CueClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export const CUE_HISTORY_LIMIT = 50;
/** Shortest follow delay: a loop of zero-wait cues still yields to the UI. */
export const CUE_MIN_FOLLOW_MS = 10;
const FADE_STEP_MS = 33;

// ─── Defaults and normalisation ──────────────────────────────────────────

export function defaultFollow(): CueFollow {
  return { mode: 'go', wait: 0, unit: 'seconds', target: 'next', jumpTo: null };
}

export function createCueAction(kind: CueActionKind): CueAction {
  const id = generateUUID();
  switch (kind) {
    case 'preset': return { id, kind, compositionId: '' };
    case 'snapshot': return { id, kind, slot: 1 };
    case 'vjClip': return { id, kind, deck: 'A', layer: 0, column: 0 };
    case 'vjColumn': return { id, kind, deck: 'A', column: 0 };
    case 'vjStopAll': return { id, kind };
    case 'blackout': return { id, kind, on: true };
    case 'macro': return { id, kind, macro: 1, value: 1, fade: 0 };
    case 'layerOpacity': return { id, kind, layerId: '', value: 1, fade: 0 };
    case 'param': return { id, kind, path: '', value: 1, fade: 0, from: null };
    case 'timeline': return { id, kind, op: 'play', seconds: 0 };
    case 'projector': return { id, kind, projectorId: '*', command: 'power-on', input: '' };
  }
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function deck(v: unknown): CueDeck {
  return v === 'B' ? 'B' : 'A';
}

export function normalizeCueAction(raw: unknown): CueAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : generateUUID();
  switch (r.kind) {
    case 'preset': return { id, kind: 'preset', compositionId: str(r.compositionId) };
    case 'snapshot': return { id, kind: 'snapshot', slot: Math.round(num(r.slot, 1, 1, 16)) };
    case 'vjClip': return { id, kind: 'vjClip', deck: deck(r.deck), layer: Math.round(num(r.layer, 0, 0, 63)), column: Math.round(num(r.column, 0, 0, 255)) };
    case 'vjColumn': return { id, kind: 'vjColumn', deck: deck(r.deck), column: Math.round(num(r.column, 0, 0, 255)) };
    case 'vjStopAll': return { id, kind: 'vjStopAll' };
    case 'blackout': return { id, kind: 'blackout', on: r.on !== false };
    case 'macro': return { id, kind: 'macro', macro: Math.round(num(r.macro, 1, 1, 8)), value: num(r.value, 1, 0, 1), fade: num(r.fade, 0, 0, 3600) };
    case 'layerOpacity': return { id, kind: 'layerOpacity', layerId: str(r.layerId), value: num(r.value, 1, 0, 1), fade: num(r.fade, 0, 0, 3600) };
    case 'param': {
      const from = r.from === null || r.from === undefined || r.from === '' ? null : num(r.from, 0);
      return { id, kind: 'param', path: str(r.path).trim(), value: num(r.value, 1), fade: num(r.fade, 0, 0, 3600), from };
    }
    case 'timeline': {
      const op = r.op === 'pause' || r.op === 'stop' || r.op === 'seek' ? r.op : 'play';
      return { id, kind: 'timeline', op, seconds: num(r.seconds, 0, 0) };
    }
    case 'projector': {
      const commands: ProjectorCommand[] = ['power-on', 'power-off', 'shutter-close', 'shutter-open', 'input'];
      const command = commands.includes(r.command as ProjectorCommand) ? (r.command as ProjectorCommand) : 'power-on';
      return { id, kind: 'projector', projectorId: str(r.projectorId, '*') || '*', command, input: str(r.input) };
    }
    default:
      return null;
  }
}

export function normalizeFollow(raw: unknown): CueFollow {
  const d = defaultFollow();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const target = r.target === 'jump' || r.target === 'loop' || r.target === 'end' ? r.target : 'next';
  return {
    mode: r.mode === 'auto' ? 'auto' : 'go',
    wait: num(r.wait, 0, 0, 86400),
    unit: r.unit === 'beats' ? 'beats' : 'seconds',
    target,
    jumpTo: typeof r.jumpTo === 'string' && r.jumpTo ? r.jumpTo : null,
  };
}

export function normalizeCue(raw: unknown, index: number): Cue | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actions = Array.isArray(r.actions)
    ? r.actions.map(normalizeCueAction).filter((a): a is CueAction => a !== null)
    : [];
  const tc = r.timecode === null || r.timecode === undefined ? null : num(r.timecode, NaN, 0);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateUUID(),
    number: typeof r.number === 'string' && r.number.trim() ? r.number.trim() : String(index + 1),
    name: str(r.name),
    actions,
    follow: normalizeFollow(r.follow),
    timecode: tc === null || !Number.isFinite(tc) ? null : tc,
  };
}

export function normalizeMarker(raw: unknown): CueMarker | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const time = Number(r.time);
  if (!Number.isFinite(time) || time < 0) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateUUID(),
    time,
    cueId: typeof r.cueId === 'string' && r.cueId ? r.cueId : null,
    label: str(r.label),
  };
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────

/** The cue a follow (or the standby after a GO) points at, or null. */
export function resolveFollowTarget(cues: Cue[], cue: Cue): Cue | null {
  const f = cue.follow;
  if (f.target === 'end') return null;
  if (f.target === 'loop') return cues[0] ?? null;
  if (f.target === 'jump') return cues.find((c) => c.id === f.jumpTo) ?? null;
  const i = cues.findIndex((c) => c.id === cue.id);
  return i >= 0 ? cues[i + 1] ?? null : null;
}

/** Follow wait in ms at a tempo. Beats with no usable tempo count as 120 bpm. */
export function followWaitMs(follow: CueFollow, bpm: number): number {
  if (follow.unit === 'beats') {
    const tempo = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
    return (follow.wait * 60000) / tempo;
  }
  return follow.wait * 1000;
}

/**
 * Times crossed by a clock moving from `prev` to `curr`, as half-open
 * (prev, curr]. A backwards move crosses nothing. With `wrapAt` (a looping
 * timeline's length), a move that went backwards is a wrap and crosses
 * (prev, wrapAt] and [0, curr].
 */
export function crossedTimes<T>(items: T[], timeOf: (item: T) => number | null, prev: number, curr: number, wrapAt: number | null = null): T[] {
  const hit = (t: number) => t > prev && t <= curr;
  if (curr >= prev) return items.filter((it) => { const t = timeOf(it); return t !== null && hit(t); });
  if (wrapAt === null || wrapAt <= 0) return [];
  return items.filter((it) => {
    const t = timeOf(it);
    return t !== null && ((t > prev && t <= wrapAt) || (t >= 0 && t <= curr));
  }).sort((a, b) => {
    // Tail of the old lap first, then the head of the new one.
    const ta = timeOf(a)!;
    const tb = timeOf(b)!;
    const ka = ta > prev ? ta - wrapAt : ta;
    const kb = tb > prev ? tb - wrapAt : tb;
    return ka - kb;
  });
}

export function valueTargetKey(t: CueValueTarget): string {
  if (t.kind === 'macro') return `macro:${t.macro}`;
  if (t.kind === 'layerOpacity') return `layer:${t.layerId}:opacity`;
  return `param:${t.path}`;
}

// ─── Engine ──────────────────────────────────────────────────────────────

function initialState(): CueListState {
  return {
    cues: [],
    markers: [],
    currentCueId: null,
    standbyCueId: null,
    selectedCueId: null,
    pendingFollow: null,
    active: false,
    history: [],
  };
}

interface Fade {
  target: CueValueTarget;
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
}

export interface CueListSnapshot {
  version: number;
  cues: Cue[];
  markers: CueMarker[];
}

export type CueFireListener = (record: CueFireRecord, cue: Cue) => void;

export class CueEngine {
  private readonly store = writable<CueListState>(initialState());
  readonly subscribe = this.store.subscribe;
  private executor: CueExecutor | null = null;
  private clock: CueClock = realClock;
  private followTimer: unknown = null;
  private fadeTimer: unknown = null;
  private readonly fades = new Map<string, Fade>();
  /** Last value the engine wrote per control path, the start of the next
   *  fade on a path whose live value cannot be read back. */
  private readonly lastWritten = new Map<string, number>();
  private readonly listeners = new Set<CueFireListener>();

  setExecutor(executor: CueExecutor | null): void {
    this.executor = executor;
  }

  setClock(clock: CueClock | null): void {
    this.cancelFollow();
    this.cancelFades();
    this.clock = clock ?? realClock;
  }

  now(): number {
    return this.clock.now();
  }

  onFire(listener: CueFireListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get state(): CueListState {
    return get(this.store);
  }

  // ── Editing ──────────────────────────────────────────────────────────

  addCue(init: Partial<Omit<Cue, 'id'>> = {}, afterId?: string | null): string {
    const id = generateUUID();
    this.store.update((s) => {
      const at = afterId ? s.cues.findIndex((c) => c.id === afterId) + 1 : s.cues.length;
      const index = at > 0 ? at : afterId ? s.cues.length : at;
      const cue: Cue = {
        id,
        number: init.number ?? nextCueNumber(s.cues, index),
        name: init.name ?? '',
        actions: init.actions ?? [],
        follow: init.follow ?? defaultFollow(),
        timecode: init.timecode ?? null,
      };
      const cues = [...s.cues.slice(0, index), cue, ...s.cues.slice(index)];
      return {
        ...s,
        cues,
        selectedCueId: id,
        standbyCueId: s.standbyCueId ?? (s.currentCueId ? null : cues[0].id),
      };
    });
    // A cue added below the last one that fired becomes its 'next'.
    const current = this.state.currentCueId;
    if (current) this.refreshStandbyAfterEdit(current);
    return id;
  }

  updateCue(id: string, patch: Partial<Omit<Cue, 'id'>>): void {
    this.store.update((s) => ({
      ...s,
      cues: s.cues.map((c) => (c.id === id ? { ...c, ...patch, follow: patch.follow ? normalizeFollow(patch.follow) : c.follow } : c)),
    }));
    this.refreshStandbyAfterEdit(id);
  }

  updateFollow(id: string, patch: Partial<CueFollow>): void {
    const cue = this.state.cues.find((c) => c.id === id);
    if (!cue) return;
    this.updateCue(id, { follow: { ...cue.follow, ...patch } });
  }

  removeCue(id: string): void {
    const s0 = this.state;
    if (s0.pendingFollow && (s0.pendingFollow.fromCueId === id || s0.pendingFollow.targetCueId === id)) this.cancelFollow();
    this.store.update((s) => {
      const index = s.cues.findIndex((c) => c.id === id);
      if (index < 0) return s;
      const cues = s.cues.filter((c) => c.id !== id).map((c) =>
        c.follow.jumpTo === id ? { ...c, follow: { ...c.follow, jumpTo: null, target: 'next' as const } } : c,
      );
      const neighbour = cues[index] ?? cues[index - 1] ?? null;
      return {
        ...s,
        cues,
        markers: s.markers.map((m) => (m.cueId === id ? { ...m, cueId: null } : m)),
        currentCueId: s.currentCueId === id ? null : s.currentCueId,
        standbyCueId: s.standbyCueId === id ? neighbour?.id ?? null : s.standbyCueId,
        selectedCueId: s.selectedCueId === id ? neighbour?.id ?? null : s.selectedCueId,
      };
    });
  }

  moveCue(id: string, toIndex: number): void {
    this.store.update((s) => {
      const from = s.cues.findIndex((c) => c.id === id);
      if (from < 0) return s;
      const cues = [...s.cues];
      const [cue] = cues.splice(from, 1);
      cues.splice(Math.max(0, Math.min(cues.length, toIndex)), 0, cue);
      return { ...s, cues };
    });
  }

  addAction(cueId: string, kind: CueActionKind): string {
    const action = createCueAction(kind);
    this.store.update((s) => ({
      ...s,
      cues: s.cues.map((c) => (c.id === cueId ? { ...c, actions: [...c.actions, action] } : c)),
    }));
    return action.id;
  }

  updateAction(cueId: string, actionId: string, patch: Record<string, unknown>): void {
    this.store.update((s) => ({
      ...s,
      cues: s.cues.map((c) => {
        if (c.id !== cueId) return c;
        return {
          ...c,
          actions: c.actions.map((a) => {
            if (a.id !== actionId) return a;
            return normalizeCueAction({ ...a, ...patch, id: a.id, kind: patch.kind ?? a.kind }) ?? a;
          }),
        };
      }),
    }));
  }

  removeAction(cueId: string, actionId: string): void {
    this.store.update((s) => ({
      ...s,
      cues: s.cues.map((c) => (c.id === cueId ? { ...c, actions: c.actions.filter((a) => a.id !== actionId) } : c)),
    }));
  }

  select(cueId: string | null): void {
    this.store.update((s) => ({ ...s, selectedCueId: cueId }));
  }

  /** Put a cue on standby: the next GO fires it. Cancels a pending follow,
   *  because the operator has just said what comes next. */
  setStandby(cueId: string | null): void {
    this.cancelFollow();
    this.store.update((s) => ({ ...s, standbyCueId: cueId, selectedCueId: cueId ?? s.selectedCueId }));
  }

  addMarker(time: number, cueId: string | null = null, label = ''): string {
    const id = generateUUID();
    const marker: CueMarker = { id, time: Math.max(0, Number(time) || 0), cueId, label };
    this.store.update((s) => ({ ...s, markers: [...s.markers, marker].sort((a, b) => a.time - b.time) }));
    return id;
  }

  updateMarker(id: string, patch: Partial<Omit<CueMarker, 'id'>>): void {
    this.store.update((s) => ({
      ...s,
      markers: s.markers
        .map((m) => (m.id === id ? normalizeMarker({ ...m, ...patch, id }) ?? m : m))
        .sort((a, b) => a.time - b.time),
    }));
  }

  removeMarker(id: string): void {
    this.store.update((s) => ({ ...s, markers: s.markers.filter((m) => m.id !== id) }));
  }

  // ── Transport ────────────────────────────────────────────────────────

  /** Fire the standby cue (the first cue when nothing is standing by and
   *  nothing has fired yet). */
  go(source: CueFireSource = 'go'): string | null {
    const s = this.state;
    let target = s.cues.find((c) => c.id === s.standbyCueId) ?? null;
    if (!target && !s.currentCueId) target = s.cues[0] ?? null;
    if (!target) return null;
    this.fire(target.id, source);
    return target.id;
  }

  /** Step back: fire the cue above the current one. */
  back(): string | null {
    const s = this.state;
    const i = s.cues.findIndex((c) => c.id === s.currentCueId);
    const target = i > 0 ? s.cues[i - 1] : i < 0 ? null : s.cues[0];
    if (!target) return null;
    this.fire(target.id, 'back');
    return target.id;
  }

  /** Halt the list: no follow fires, running fades freeze where they are,
   *  and a free-running show timeline pauses. Standby is kept, so GO
   *  carries on from where the show stopped. */
  stop(): void {
    this.cancelFollow();
    this.cancelFades();
    const wasActive = this.state.active;
    this.store.update((s) => ({ ...s, active: false, pendingFollow: null }));
    if (wasActive) this.safely(() => this.executor?.timeline('pause', 0));
  }

  /** Stop, and stand by on the first cue with nothing current. */
  reset(): void {
    this.stop();
    this.store.update((s) => ({ ...s, currentCueId: null, standbyCueId: s.cues[0]?.id ?? null }));
  }

  /**
   * Fire one cue now: run its actions, make it current, put its follow
   * target on standby and start its auto-follow if it has one.
   */
  fire(cueId: string, source: CueFireSource = 'manual'): boolean {
    const s = this.state;
    const cue = s.cues.find((c) => c.id === cueId);
    if (!cue) return false;
    this.cancelFollow();
    const next = resolveFollowTarget(s.cues, cue);
    const record: CueFireRecord = { cueId: cue.id, number: cue.number, source, at: this.clock.now() };
    const history = [...s.history, record].slice(-CUE_HISTORY_LIMIT);
    this.store.set({
      ...s,
      currentCueId: cue.id,
      standbyCueId: next?.id ?? null,
      selectedCueId: s.selectedCueId,
      active: true,
      pendingFollow: null,
      history,
    });
    for (const action of cue.actions) this.runAction(action);
    for (const listener of this.listeners) this.safely(() => listener(record, cue));
    // An action may have fired another cue (a projector hook, a marker at
    // the timeline's start). Only schedule if this cue is still current.
    if (this.state.currentCueId !== cue.id || this.followTimer !== null) return true;
    if (cue.follow.mode === 'auto') {
      const waitMs = followWaitMs(cue.follow, this.executor?.bpm() ?? 120);
      this.scheduleFollow(cue.id, next?.id ?? null, waitMs);
    } else if (!next) {
      this.store.update((x) => ({ ...x, active: false }));
    }
    return true;
  }

  /** Ms until the pending follow fires, or null. */
  remainingMs(): number | null {
    const p = this.state.pendingFollow;
    return p ? Math.max(0, p.firesAt - this.clock.now()) : null;
  }

  // ── Clock-driven firing ─────────────────────────────────────────────

  /** Timeline playhead advanced: fire every marker it crossed, in order. */
  timelineAdvanced(prev: number, curr: number, wrapAt: number | null = null): string[] {
    const s = this.state;
    const crossed = crossedTimes(s.markers, (m) => (m.cueId ? m.time : null), prev, curr, wrapAt);
    const fired: string[] = [];
    for (const m of crossed) {
      if (m.cueId && this.fire(m.cueId, 'marker')) fired.push(m.cueId);
    }
    return fired;
  }

  /** Chased timecode advanced: fire every cue whose timecode it crossed. */
  timecodeAdvanced(prev: number, curr: number): string[] {
    const s = this.state;
    const crossed = crossedTimes(s.cues, (c) => c.timecode, prev, curr).sort((a, b) => a.timecode! - b.timecode!);
    const fired: string[] = [];
    for (const c of crossed) if (this.fire(c.id, 'timecode')) fired.push(c.id);
    return fired;
  }

  // ── Persistence ──────────────────────────────────────────────────────

  serialize(): CueListSnapshot {
    const s = this.state;
    return {
      version: 1,
      cues: JSON.parse(JSON.stringify(s.cues)),
      markers: s.markers.map((m) => ({ ...m })),
    };
  }

  hydrate(payload: unknown): void {
    this.cancelFollow();
    this.cancelFades();
    this.lastWritten.clear();
    if (!payload || typeof payload !== 'object') {
      this.store.set(initialState());
      return;
    }
    const p = payload as Record<string, unknown>;
    const cues = (Array.isArray(p.cues) ? p.cues : [])
      .map((c, i) => normalizeCue(c, i))
      .filter((c): c is Cue => c !== null);
    const ids = new Set(cues.map((c) => c.id));
    for (const c of cues) {
      if (c.follow.jumpTo && !ids.has(c.follow.jumpTo)) c.follow = { ...c.follow, jumpTo: null, target: c.follow.target === 'jump' ? 'next' : c.follow.target };
    }
    const markers = (Array.isArray(p.markers) ? p.markers : [])
      .map(normalizeMarker)
      .filter((m): m is CueMarker => m !== null)
      .map((m) => (m.cueId && !ids.has(m.cueId) ? { ...m, cueId: null } : m))
      .sort((a, b) => a.time - b.time);
    this.store.set({
      ...initialState(),
      cues,
      markers,
      standbyCueId: cues[0]?.id ?? null,
      selectedCueId: cues[0]?.id ?? null,
    });
  }

  /** Test seam: back to empty with the real clock and no executor. */
  _resetForTest(): void {
    this.cancelFollow();
    this.cancelFades();
    this.lastWritten.clear();
    this.listeners.clear();
    this.executor = null;
    this.clock = realClock;
    this.store.set(initialState());
  }

  // ── Internals ────────────────────────────────────────────────────────

  private refreshStandbyAfterEdit(id: string): void {
    // Editing the current cue's follow changes what should be standing by.
    const s = this.state;
    if (s.currentCueId !== id || s.pendingFollow) return;
    const cue = s.cues.find((c) => c.id === id);
    if (!cue) return;
    const next = resolveFollowTarget(s.cues, cue);
    this.store.update((x) => ({ ...x, standbyCueId: next?.id ?? null }));
  }

  private scheduleFollow(fromCueId: string, targetCueId: string | null, waitMs: number): void {
    const delay = Math.max(CUE_MIN_FOLLOW_MS, waitMs);
    const firesAt = this.clock.now() + delay;
    this.store.update((s) => ({ ...s, pendingFollow: { fromCueId, targetCueId, firesAt, totalMs: delay } }));
    this.followTimer = this.clock.setTimeout(() => {
      this.followTimer = null;
      const s = this.state;
      if (!s.pendingFollow || s.pendingFollow.fromCueId !== fromCueId) return;
      this.store.update((x) => ({ ...x, pendingFollow: null }));
      if (targetCueId && s.cues.some((c) => c.id === targetCueId)) {
        this.fire(targetCueId, 'follow');
      } else {
        this.store.update((x) => ({ ...x, active: false }));
      }
    }, delay);
  }

  private cancelFollow(): void {
    if (this.followTimer !== null) this.clock.clearTimeout(this.followTimer);
    this.followTimer = null;
    if (get(this.store).pendingFollow) this.store.update((s) => ({ ...s, pendingFollow: null }));
  }

  private safely(fn: () => unknown): void {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).catch === 'function') {
        (r as Promise<unknown>).catch((err) => console.warn('[CueList] action failed:', err));
      }
    } catch (err) {
      console.warn('[CueList] action failed:', err);
    }
  }

  private runAction(action: CueAction): void {
    const ex = this.executor;
    if (!ex) return;
    switch (action.kind) {
      case 'preset':
        if (action.compositionId) this.safely(() => ex.recallPreset(action.compositionId));
        break;
      case 'snapshot':
        this.safely(() => ex.recallSnapshot(action.slot));
        break;
      case 'vjClip':
        this.safely(() => ex.triggerClip(action.deck, action.layer, action.column));
        break;
      case 'vjColumn':
        this.safely(() => ex.triggerColumn(action.deck, action.column));
        break;
      case 'vjStopAll':
        this.safely(() => ex.stopAllClips());
        break;
      case 'blackout':
        this.safely(() => ex.setBlackout(action.on));
        break;
      case 'macro':
        this.startFade({ kind: 'macro', macro: action.macro }, action.value, action.fade, null);
        break;
      case 'layerOpacity':
        if (action.layerId) this.startFade({ kind: 'layerOpacity', layerId: action.layerId }, action.value, action.fade, null);
        break;
      case 'param':
        if (action.path) this.startFade({ kind: 'param', path: action.path }, action.value, action.fade, action.from);
        break;
      case 'timeline':
        this.safely(() => ex.timeline(action.op, action.seconds));
        break;
      case 'projector':
        this.safely(() => ex.projector(action.projectorId, action.command, action.input));
        break;
    }
  }

  private write(target: CueValueTarget, value: number): void {
    this.lastWritten.set(valueTargetKey(target), value);
    this.safely(() => this.executor?.writeValue(target, value));
  }

  private startFade(target: CueValueTarget, to: number, seconds: number, explicitFrom: number | null): void {
    const key = valueTargetKey(target);
    this.fades.delete(key);
    const durationMs = Math.max(0, seconds * 1000);
    let from: number | null = explicitFrom;
    if (from === null) {
      try {
        from = this.executor?.readValue(target) ?? null;
      } catch {
        from = null;
      }
    }
    if (from === null) from = this.lastWritten.get(key) ?? null;
    if (durationMs <= 0 || from === null || !Number.isFinite(from)) {
      this.write(target, to);
      return;
    }
    this.fades.set(key, { target, from, to, startMs: this.clock.now(), durationMs });
    this.write(target, from);
    if (this.fadeTimer === null) this.fadeTimer = this.clock.setInterval(() => this.stepFades(), FADE_STEP_MS);
  }

  private stepFades(): void {
    const now = this.clock.now();
    for (const [key, f] of [...this.fades]) {
      const t = Math.min(1, (now - f.startMs) / f.durationMs);
      this.write(f.target, f.from + (f.to - f.from) * t);
      if (t >= 1) this.fades.delete(key);
    }
    if (this.fades.size === 0) this.cancelFades();
  }

  private cancelFades(): void {
    this.fades.clear();
    if (this.fadeTimer !== null) this.clock.clearInterval(this.fadeTimer);
    this.fadeTimer = null;
  }

  /** Test/inspection: keys of fades still running. */
  activeFadeKeys(): string[] {
    return [...this.fades.keys()];
  }
}

/** Next free whole number after the cue before `index`. */
export function nextCueNumber(cues: Cue[], index: number): string {
  const before = cues[index - 1];
  const after = cues[index];
  const b = before ? parseFloat(before.number) : 0;
  const a = after ? parseFloat(after.number) : NaN;
  const base = Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(a)) return String(Math.floor(base) + 1);
  if (Math.floor(base) + 1 < a) return String(Math.floor(base) + 1);
  // Squeeze in between: 1 and 2 give 1.5.
  const mid = (base + a) / 2;
  return String(Math.round(mid * 1000) / 1000);
}

export const cueList = new CueEngine();

export function cueLabel(cue: Cue | null | undefined): string {
  if (!cue) return '';
  return cue.name ? `${cue.number}  ${cue.name}` : `Cue ${cue.number}`;
}
