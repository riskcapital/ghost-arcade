/**
 * The music studio as a plugin.
 *
 * The studio's visuals live in one place: a Music Studio clip in a VJ cell,
 * or a mapping media layer whose content is the Music Studio. Each instance
 * carries its own stack of visual voices (a VX shader, the sound it follows,
 * its look and its level), saved with the clip or the layer. Nothing else
 * on the deck changes when a scene loads.
 *
 * At render time an instance becomes its voices plus one mix: every voice is
 * a hidden shader layer (rendered, never composited by itself), and the
 * instance's own layer shows them screen-blended together, through the same
 * native mix pass the VJ deck uses. The layer keeps everything else it has:
 * its place on the deck or the map, opacity, blend, warp, masks and effects.
 */

import { writable } from 'svelte/store';
import { createLayer, type Layer } from '../types';
import { VOICE_AUTO_INPUT, VOICE_SOURCE_INPUT, VOICE_SOURCES, voiceSourceIndex, type VoiceSourceId } from './visualVoices';
import type { StudioSet } from './studioSets';

export const STUDIO_PLUGIN_ID = 'musicstudio';
export const STUDIO_EFFECT_TYPE = 'music-studio';
/** Voices one instance holds at most. Each is a shader rendered every frame. */
export const MAX_STUDIO_VOICES = 6;

export interface StudioVoice {
  /** A VX shader in public/ISF, e.g. "VX-Barcode.fs". */
  file: string;
  /** The sound it follows. */
  source: VoiceSourceId;
  /** Shows only while its sound plays. */
  auto: boolean;
  /** How much of it shows, 0-1. */
  level: number;
  /** Look inputs, by name. */
  params: Record<string, number>;
}

/** The plugin's fields on an effect source. */
export interface StudioPluginSource {
  effectType: typeof STUDIO_EFFECT_TYPE;
  musicSet?: StudioSet;
  musicSceneId?: string | null;
  musicVoices?: StudioVoice[];
}

type RGB = [number, number, number];

/** Each set's palette: one ink and one accent. Mirrors visualScenes.SET_PALETTES. */
export const STUDIO_PALETTES: Record<StudioSet, { ink: RGB; accent: RGB }> = {
  bath: { ink: [0.72, 0.82, 1.0], accent: [1.0, 0.8, 0.45] },
  berlin: { ink: [0.94, 0.95, 0.97], accent: [1.0, 0.16, 0.1] },
  dub: { ink: [1.0, 0.72, 0.36], accent: [0.25, 0.9, 0.62] },
  analog: { ink: [0.75, 1.0, 0.92], accent: [1.0, 0.45, 0.12] },
};

const SETS: readonly StudioSet[] = ['bath', 'berlin', 'dub', 'analog'];

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

export function isStudioSource(source: unknown): source is StudioPluginSource {
  return !!source && typeof source === 'object' && (source as { effectType?: unknown }).effectType === STUDIO_EFFECT_TYPE;
}

export function normalizeStudioVoice(raw: unknown): StudioVoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Record<keyof StudioVoice, unknown>>;
  const file = typeof r.file === 'string' ? r.file : '';
  // Only shipped VX shaders: the name goes into a fetch path.
  if (!/^VX-[A-Za-z0-9_-]+\.fs$/.test(file)) return null;
  const params: Record<string, number> = {};
  if (r.params && typeof r.params === 'object') {
    for (const [name, value] of Object.entries(r.params as Record<string, unknown>)) {
      const n = Number(value);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && Number.isFinite(n)) params[name] = n;
    }
  }
  return {
    file,
    source: VOICE_SOURCES.some((s) => s.id === r.source) ? (r.source as VoiceSourceId) : 'all',
    auto: r.auto === undefined ? true : r.auto === true,
    level: clamp01(r.level, 1),
    params,
  };
}

/** The plugin's fields, filled in and checked (loading a project, pasting a clip). */
export function normalizeStudioSource(raw: unknown): Required<StudioPluginSource> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioPluginSource>;
  const voices: StudioVoice[] = [];
  for (const v of Array.isArray(r.musicVoices) ? r.musicVoices : []) {
    const voice = normalizeStudioVoice(v);
    if (voice && voices.length < MAX_STUDIO_VOICES) voices.push(voice);
  }
  return {
    effectType: STUDIO_EFFECT_TYPE,
    musicSet: SETS.includes(r.musicSet as StudioSet) ? (r.musicSet as StudioSet) : 'berlin',
    musicSceneId: typeof r.musicSceneId === 'string' ? r.musicSceneId : null,
    musicVoices: voices,
  };
}

/** A scene's voices as plugin voices. */
export function studioVoicesFromScene(voices: readonly { file: string; source: VoiceSourceId; params?: Record<string, number>; level?: number }[]): StudioVoice[] {
  return voices.slice(0, MAX_STUDIO_VOICES).map((v) => ({
    file: v.file,
    source: v.source,
    auto: true,
    level: clamp01(v.level, 1),
    params: { ...(v.params ?? {}) },
  }));
}

/** What a new instance starts with: Berlin's Data scene. The studio loads its own set's scene when it takes over the instance. */
export function defaultStudioSource(): Required<StudioPluginSource> {
  return {
    effectType: STUDIO_EFFECT_TYPE,
    musicSet: 'berlin',
    musicSceneId: 'berlin-bits',
    musicVoices: studioVoicesFromScene([
      { file: 'VX-DataStream.fs', source: 'hats', level: 0.8 },
      { file: 'VX-Barcode.fs', source: 'kick', level: 0.6 },
      { file: 'VX-BitCounter.fs', source: 'bass' },
      { file: 'VX-DataPlot.fs', source: 'lead', level: 0.8 },
    ]),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────

/** What the expansion needs from outside: shader code and this frame's driven inputs. */
export interface StudioRenderInputs {
  /** The voice shader's code, or undefined while it loads. */
  code(file: string): string | undefined;
  /** The driven `vx` inputs for a voice following `source`. */
  driven(source: VoiceSourceId, auto: boolean): Record<string, number>;
}

export function studioVoiceLayerId(host: Layer, index: number): string {
  return `music-voice:${host.id}:${index}`;
}

/** The shader values one voice renders with: its look, the set's palette, what it follows, and this frame's signals. */
export function studioVoiceValues(voice: StudioVoice, set: StudioSet, driven: Record<string, number>): Record<string, unknown> {
  const palette = STUDIO_PALETTES[set] ?? STUDIO_PALETTES.berlin;
  return {
    ...voice.params,
    ink: [...palette.ink, 1],
    accent: [...palette.accent, 1],
    [VOICE_SOURCE_INPUT]: voiceSourceIndex(voice.source),
    [VOICE_AUTO_INPUT]: voice.auto,
    ...driven,
  };
}

/**
 * Every Music Studio layer becomes its voices plus a mix of them. Other
 * layers pass through untouched. `onHosts` hears how many instances this
 * scene holds, so the studio keeps its clock running while any is showing.
 */
export function expandStudioLayers(layers: Layer[], inputs: StudioRenderInputs, onHosts?: (count: number) => void): Layer[] {
  let hosts = 0;
  const out: Layer[] = [];
  for (const layer of layers) {
    const effectSource = layer.source?.effectSource;
    if (!isStudioSource(effectSource)) {
      out.push(layer);
      continue;
    }
    hosts++;
    const studio = normalizeStudioSource(effectSource);
    const rows: Array<{ layerId: string; opacity: number; blendMode: string }> = [];
    studio.musicVoices.forEach((voice, index) => {
      const code = inputs.code(voice.file);
      if (!code) return;
      const id = studioVoiceLayerId(layer, index);
      out.push({
        ...createLayer(id, voice.file.replace(/^VX-|\.fs$/g, ''), 'media'),
        // Rendered for the mix, never composited on its own.
        opacity: 0,
        source: {
          // The file is part of the id so a different shader is a different source.
          id: `${id}:${voice.file}`,
          type: 'shader',
          name: voice.file,
          src: `ISF/${voice.file}`,
          shaderCode: code,
          shaderValues: studioVoiceValues(voice, studio.musicSet, inputs.driven(voice.source, voice.auto)),
        },
      } as Layer);
      rows.push({ layerId: id, opacity: voice.level, blendMode: 'screen' });
    });
    out.push({
      ...layer,
      source: {
        ...layer.source!,
        effectSource: { effectType: 'vj-mix', vjmixRows: rows, vjmixGroups: [] },
      },
    } as Layer);
  }
  onHosts?.(hosts);
  return out;
}

// ── Shared runtime hooks ────────────────────────────────────────────────

/** Bumped every frame while an instance is showing, so the renderer picks up the voices' new signals. */
export const studioVisualTick = writable(0);

/** Bumped when a voice's shader has loaded: its controls can show and the scene resyncs. Panels watch this, not the frame tick. */
export const studioCodeTick = writable(0);

const codeCache = new Map<string, string>();
const loading = new Set<string>();
/** Files that would not load: not asked for again (every scene sync would). */
const missing = new Set<string>();

/** Voice shader code, fetched on first use; the scene resyncs when it arrives. */
export function studioVoiceCode(file: string): string | undefined {
  const cached = codeCache.get(file);
  if (cached !== undefined) return cached;
  if (!loading.has(file) && !missing.has(file) && typeof fetch !== 'undefined' && /^VX-[A-Za-z0-9_-]+\.fs$/.test(file)) {
    loading.add(file);
    fetch(`./ISF/${encodeURIComponent(file)}`)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((code) => {
        codeCache.set(file, code);
        studioCodeTick.update((n) => n + 1);
      })
      .catch((err) => {
        missing.add(file);
        console.warn('[Music Studio] could not load', file, err);
      })
      .finally(() => loading.delete(file));
  }
  return undefined;
}

let driver: StudioRenderInputs['driven'] | null = null;
let liveHosts = 0;

/** The studio runtime supplies the voices' signals. */
export function setStudioDriver(fn: StudioRenderInputs['driven'] | null): void {
  driver = fn;
}

/** Instances in the last rendered scene. */
export function studioHostsLive(): number {
  return liveHosts;
}

/** The renderer's view: shader code from the cache, signals from the runtime (or resting values before it starts). */
export const studioRenderInputs: StudioRenderInputs = {
  code: studioVoiceCode,
  driven: (source, auto) => (driver ? driver(source, auto) : { vxPresence: 1 }),
};

/** Called by the renderer with the number of instances in the scene. */
export function noteStudioHosts(count: number): void {
  liveHosts = count;
}
