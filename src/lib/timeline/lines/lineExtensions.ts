/**
 * Extension points for control lines: new things a line can drive (a
 * parameter scope) and new things a line can follow (a line source),
 * registered at runtime. Later work plugs in here instead of building a
 * second automation system: a Music Studio voice's parameters as line
 * targets, a studio signal or an interactive touch as a source.
 *
 * ── A scope ─────────────────────────────────────────────────────────────
 *
 *   const off = registerParamScope({
 *     scope: 'studio.voice',                  // namespaced: '<area>.<thing>'
 *     label: 'Studio voices',
 *     targets: () => voices.map((v) => ({ id: v.id, label: v.name })),
 *     params: (id) => [{ key: 'voice:cutoff', label: 'Cutoff', group: 'Filter',
 *                        min: 0, max: 1, step: 0.01, default: 0.5, kind: 'continuous' }],
 *     read: (id, key) => storedValue(id, key),    // the resting value (optional)
 *     apply: (values) => {                        // show time (optional)
 *       for (const [id, rec] of values ?? []) setVoiceParams(id, rec);
 *     },
 *   });
 *   // A line on it:  { target: { scope: 'studio.voice', id: 'lead' }, key: 'voice:cutoff', … }
 *   off();                                       // unregister
 *
 * A target is (scope, id); `id` is optional for a scope with one target.
 * Show-time values are never written to the project: `apply` gets the
 * scope's values (by target id, '' for none) whenever they change: while
 * the Timeline plays, on every seek and scrub, and for each frame of an
 * offline render; `null` when no line drives the scope any more. They can
 * also be read at any time with `lineScopeValues` (lineRuntime.ts).
 * Lines on a scope show under the Timeline's Stage row and its ⌇+ lists the
 * scope's targets, unless the scope draws its own rows (`rows: 'own'`, as
 * the sound rows do).
 *
 * ── A line source ───────────────────────────────────────────────────────
 *
 *   registerLineSource({
 *     kind: 'studio.signal', label: 'Studio voice level',
 *     choices: () => voices.map((v) => ({ id: v.id, label: `${v.name} level`, source: { voice: v.id } })),
 *     sample: (t, source) => offlineLevel(source.voice, t),  // 0..1 at show time t
 *     // or, for something only known live:
 *     // live: (source) => currentLevel(source.voice),
 *   });
 *   // A line following it:  follow: { source: { kind: 'studio.signal', voice: 'lead' }, depth: 0.5 }
 *
 * `sample(t)` must be deterministic in t (scrub = play = export). A source
 * with only `live` is live-only: it adds nothing to an offline render (record
 * it into the line's points to keep it), and the line's Smooth setting runs
 * on it as on a MIDI CC. Return null when the source has no value.
 *
 * ── Saved files ─────────────────────────────────────────────────────────
 *
 * A line's target and follow source are saved as they are. A file opened
 * by a build that does not know a scope or source (or before the feature
 * that registers it has started) keeps them untouched through load and
 * save; such a line drives nothing and is not drawn.
 *
 * Built-in scopes (layer, stage, led, block, look) are not registered here.
 * The sound rows' scope ('sound') and the Beat LFO source ('beat') run on
 * this mechanism (timelineLines.ts, lineEvaluator.ts).
 */
import type { LineContext, OverrideRecord } from './lineEvaluator';
import type { ParamEntry } from './paramRegistry';

/** A registered scope's name: namespaced, '<area>.<thing>'. */
export type ExtScope = `${string}.${string}`;

/** A target in a registered scope. */
export interface ExtParamTarget {
  scope: ExtScope;
  id?: string;
}

/** A registered source, as a line saves it: its kind plus its own settings (plain JSON). */
export interface ExtFollowSource {
  kind: `${string}.${string}`;
  [setting: string]: unknown;
}

export interface ParamScopeDef {
  /** The scope's name. Use '<area>.<thing>' (e.g. 'studio.voice'). */
  scope: string;
  /** Shown in the ⌇+ picker ("Studio voices: Lead"). */
  label: string;
  /** What the scope offers right now (for the picker). Omitted: one target without an id. */
  targets?(): Array<{ id: string; label: string }>;
  /** The parameters of one target (the registry's entries). */
  params(id: string | undefined): ParamEntry[];
  /** The stored (resting) value of a parameter, when it has one. */
  read?(id: string | undefined, key: string): number | boolean | undefined;
  /** Show time: the lines' values for this scope changed (null: none now). */
  apply?(values: ReadonlyMap<string, OverrideRecord> | null): void;
  /** Where the scope's lines are drawn: under the Stage row (default) or its own rows. */
  rows?: 'stage' | 'own';
}

export interface LineSourceDef<S extends { kind: string } = any> {
  /** Saved in the line as `follow.source.kind`. Use '<area>.<thing>'. */
  kind: string;
  /** Shown in the line's "follows" menu. */
  label: string;
  /** Entries for the "follows" menu, each a source with its own settings. Omitted: one entry. */
  choices?(): Array<{ id: string; label: string; source?: Record<string, unknown> }>;
  /** The source at show time `t`, 0..1, or null. Deterministic in t. `smooth`: the line's smoothing (s), a hint. */
  sample?(t: number, source: S, ctx: LineContext, smooth: number): number | null;
  /** The source now, 0..1, or null (live-only sources). */
  live?(source: S, ctx: LineContext): number | null;
}

const RESERVED_SCOPES = new Set(['layer', 'stage', 'led', 'block', 'look']);

// Registered again under the same name, the newest wins; unregistering it
// brings back the one before (a test or a later feature can stand in for a
// built-in and step aside again).
const scopeStacks = new Map<string, ParamScopeDef[]>();
const sourceStacks = new Map<string, LineSourceDef[]>();
const scopes = new Map<string, ParamScopeDef>();
const sources = new Map<string, LineSourceDef>();
const listeners = new Set<() => void>();

function push<T>(stacks: Map<string, T[]>, current: Map<string, T>, name: string, def: T): () => void {
  const stack = stacks.get(name) ?? [];
  stack.push(def);
  stacks.set(name, stack);
  current.set(name, def);
  changed();
  return () => {
    const list = stacks.get(name);
    const at = list ? list.lastIndexOf(def) : -1;
    if (!list || at < 0) return;
    list.splice(at, 1);
    if (list.length) current.set(name, list[list.length - 1]);
    else {
      stacks.delete(name);
      current.delete(name);
    }
    changed();
  };
}

function changed(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { console.warn('[lines] extension listener failed:', err); }
  }
}

/** Register a parameter scope. Returns its unregister. Registered again, the newest wins until it is unregistered. */
export function registerParamScope(def: ParamScopeDef): () => void {
  if (!def || typeof def.scope !== 'string' || !def.scope || RESERVED_SCOPES.has(def.scope)) {
    throw new Error(`registerParamScope: '${def?.scope}' is not a scope that can be registered`);
  }
  return push(scopeStacks, scopes, def.scope, def);
}

/** Register a line source. Returns its unregister. Registered again, the newest wins until it is unregistered. */
export function registerLineSource<S extends { kind: string }>(def: LineSourceDef<S>): () => void {
  if (!def || typeof def.kind !== 'string' || !def.kind || (!def.sample && !def.live)) {
    throw new Error(`registerLineSource: '${def?.kind}' needs a kind and sample() or live()`);
  }
  return push(sourceStacks, sources, def.kind, def as LineSourceDef);
}

export function paramScope(scope: string): ParamScopeDef | undefined {
  return scopes.get(scope);
}

export function lineSource(kind: string): LineSourceDef | undefined {
  return sources.get(kind);
}

export function paramScopes(): ParamScopeDef[] {
  return [...scopes.values()];
}

export function lineSources(): LineSourceDef[] {
  return [...sources.values()];
}

/** A source that has a value only live (nothing during an export). */
export function isLiveOnlyExtSource(kind: string): boolean {
  const def = sources.get(kind);
  return !!def && !def.sample && !!def.live;
}

/** Called after any register / unregister. Returns its remover. */
export function onLineExtensionsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The Stage row's ⌇+ entries for registered scopes (those drawn under the Stage row). */
export function stageScopeTargets(): Array<{ target: ExtParamTarget; label: string }> {
  const out: Array<{ target: ExtParamTarget; label: string }> = [];
  for (const def of scopes.values()) {
    if (def.rows === 'own') continue;
    let targets: Array<{ id: string; label: string }> | null = null;
    try { targets = def.targets ? def.targets() : null; } catch { targets = []; }
    const scope = def.scope as ExtScope;
    if (!targets) out.push({ target: { scope }, label: def.label });
    else for (const t of targets) out.push({ target: { scope, id: t.id }, label: `${def.label}: ${t.label}` });
  }
  return out;
}

/** A registered scope whose lines show under the Stage row. */
export function isStageScope(scope: string): boolean {
  const def = scopes.get(scope);
  return !!def && def.rows !== 'own';
}
