/**
 * A sound clip's visuals: a stack of layers that comes in when the clip
 * plays and goes when it stops. Any clip has one: the studio's own session
 * clips (`SessionClip.stack`) and Ableton Live's clips (kept by the studio,
 * `liveStacks`, by track and clip name).
 *
 * A layer is either one of the studio's curated audio shaders (a VX voice
 * that follows a sound), or anything from the library: a video, an image, a
 * shader, a JS or p5 sketch (the timeline's clip media, `ShowClipMedia`).
 * Each layer has its blend, opacity, settings and effects; the stack has its
 * own blend and opacity over the rest of the picture, effects over the whole
 * stack, and optionally its own mood (the palette and finish its voices take).
 *
 * Rendering: studioPlugin.ts expands a playing stack into its own mix.
 * Validation follows session.ts: anything out of range is clamped or dropped.
 */
import { BLEND_MODE_ORDER, type BlendMode, type Effect, type ShowClipMedia } from '../types';
import { normalizeClipMedia } from '../stores/showTimeline';
import { normalizeFinish, type StudioFinish } from './studioFinish';
import type { ClipVisual } from './session';

/** Layers in one stack (each is rendered every frame while it plays). */
export const MAX_STACK_ITEMS = 8;
/** Effects on one layer or one stack: the native pass chain's limit. */
export const MAX_STACK_EFFECTS = 16;

export interface StackVoice {
  /** A VX shader in public/ISF, e.g. "VX-Barcode.fs". */
  file: string;
  /** The sound it follows (a VoiceSourceId, or "live:<track>" for a Live track). */
  follow: string;
  /** Only its subject draws (transparent background). */
  clear?: boolean;
}

export interface StackItem {
  id: string;
  name: string;
  /** One of the two: a curated audio shader, or library media. */
  voice?: StackVoice;
  media?: ShowClipMedia;
  blend: BlendMode;
  opacity: number;
  /** Shader settings by input name (voices and library shaders). */
  params: Record<string, number>;
  effects: Effect[];
}

export interface StackMood {
  /** The palette its voices take their colors from (studioPalettes.ts); the studio's when missing. */
  palette?: string;
  /** Glow, trails, grade, grain over the stack; none when missing. */
  finish?: StudioFinish;
}

export interface ClipStack {
  items: StackItem[];
  /** How the stack blends over what is below it. */
  blend: BlendMode;
  opacity: number;
  /** Effects over the whole stack. */
  effects: Effect[];
  mood?: StackMood;
}

const BLENDS = new Set<string>(BLEND_MODE_ORDER);
const VOICE_FILE = /^VX-[A-Za-z0-9_-]+\.fs$/;
const clamp01 = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const blend = (v: unknown, fallback: BlendMode): BlendMode => (typeof v === 'string' && BLENDS.has(v) ? (v as BlendMode) : fallback);

export const emptyStack = (): ClipStack => ({ items: [], blend: 'screen', opacity: 1, effects: [] });

export function normalizeEffects(raw: unknown): Effect[] {
  if (!Array.isArray(raw)) return [];
  const out: Effect[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const fx = e as Partial<Effect>;
    if (typeof fx.id !== 'string' || typeof fx.type !== 'string') continue;
    out.push(JSON.parse(JSON.stringify({ ...fx, enabled: fx.enabled !== false, params: fx.params && typeof fx.params === 'object' ? fx.params : {} })) as Effect);
    if (out.length >= MAX_STACK_EFFECTS) break;
  }
  return out;
}

function normalizeParams(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function normalizeStackItem(raw: unknown): StackItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  let voice: StackVoice | undefined;
  let media: ShowClipMedia | undefined;
  const v = r.voice as Record<string, unknown> | undefined;
  if (v && typeof v.file === 'string' && VOICE_FILE.test(v.file)) {
    voice = { file: v.file, follow: typeof v.follow === 'string' && v.follow ? v.follow : 'all', ...(v.clear === true ? { clear: true } : {}) };
  } else {
    const m = normalizeClipMedia(r.media);
    if (!m || m.kind === 'layer') return null;
    media = m;
  }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : voice ? voice.file.replace(/^VX-|\.fs$/g, '') : media!.name;
  return {
    id: r.id,
    name,
    ...(voice ? { voice } : { media }),
    blend: blend(r.blend, 'normal'),
    opacity: clamp01(r.opacity, 1),
    params: normalizeParams(r.params),
    effects: normalizeEffects(r.effects),
  };
}

export function normalizeStack(raw: unknown): ClipStack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const items: StackItem[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const item = normalizeStackItem(it);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
    if (items.length >= MAX_STACK_ITEMS) break;
  }
  const m = r.mood as Record<string, unknown> | undefined;
  const mood: StackMood = {};
  if (m && typeof m.palette === 'string' && m.palette) mood.palette = m.palette;
  if (m && m.finish && typeof m.finish === 'object') mood.finish = normalizeFinish(m.finish);
  return {
    items,
    blend: blend(r.blend, 'screen'),
    opacity: clamp01(r.opacity, 1),
    effects: normalizeEffects(r.effects),
    ...(mood.palette || mood.finish ? { mood } : {}),
  };
}

/** The one visual a clip could have before stacks, as a stack of that one voice. */
export function stackFromVisual(visual: ClipVisual, id: string): ClipStack {
  return {
    items: [{ id, name: visual.file.replace(/^VX-|\.fs$/g, ''), voice: { file: visual.file, follow: visual.source }, blend: 'normal', opacity: 1, params: {}, effects: [] }],
    blend: blend(visual.blend, 'screen'),
    opacity: clamp01(visual.level, 1),
    effects: [],
  };
}

/** A stack with nothing to show counts as none. */
export const hasVisuals = (stack: ClipStack | undefined | null): stack is ClipStack => !!stack && stack.items.length > 0;

/** A new layer of a curated audio shader. */
export const voiceItem = (id: string, file: string, follow: string): StackItem => ({
  id, name: file.replace(/^VX-|\.fs$/g, ''), voice: { file, follow }, blend: 'normal', opacity: 1, params: {}, effects: [],
});

/** A new layer of library media (a Media Library drag, a picked shader, video or sketch). */
export function mediaItem(id: string, media: ShowClipMedia): StackItem | null {
  const m = normalizeClipMedia(media);
  if (!m || m.kind === 'layer') return null;
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(m.shaderValues ?? {})) if (typeof v === 'number') params[k] = v;
  return { id, name: m.name, media: m, blend: 'normal', opacity: 1, params, effects: [] };
}

// ── Ableton Live clips ──────────────────────────────────────────────────

/** Live clips' stacks are kept by track and clip name, so they follow a clip moved to another slot. */
export const liveClipKey = (trackName: string, clipName: string) => `${trackName}::${clipName}`;
/** A clip with no name (or one of several with the same name) is kept by its slot. */
export const liveSlotKey = (trackName: string, slot: number) => `${trackName}#${slot}`;

/**
 * The key a Live clip's stack is kept under: its name on its track, unless
 * the name is empty or another clip on the track has it too, then its slot.
 */
export function liveStackKey(trackName: string, slot: number, clipNames: Array<string | null | undefined>): string {
  const name = (clipNames[slot] ?? '').trim();
  if (name && clipNames.filter((n) => (n ?? '').trim() === name).length === 1) return liveClipKey(trackName, name);
  return liveSlotKey(trackName, slot);
}

export function normalizeLiveStacks(raw: unknown): Record<string, ClipStack> {
  const out: Record<string, ClipStack> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const stack = normalizeStack(v);
    if (stack && hasVisuals(stack)) out[k] = stack;
  }
  return out;
}
