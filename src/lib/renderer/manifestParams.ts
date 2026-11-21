/**
 * Layer controls an instrument publishes in the render core's instrument
 * manifest (`param_defs`), turned into the panel's `ParamControl`s. Generic:
 * any instrument the core lists with definitions gets a panel, with no
 * per-instrument UI code.
 */
import { writable, get } from 'svelte/store';
import type { ParamControl } from './gpuShaderTypes';
import { deriveDefaults } from './gpuShaderTypes';

/** Controls by instrument id, from the running core's manifest. */
export const nativeGraphParamDefs = writable<Record<string, ParamControl[]>>({});

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** One manifest entry's definitions as panel controls; malformed ones are skipped. */
export function paramControlsFromManifest(defs: unknown): ParamControl[] {
  if (!Array.isArray(defs)) return [];
  const out: ParamControl[] = [];
  for (const raw of defs) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const key = str(d.key);
    const label = str(d.label) || key;
    if (!key) continue;
    const group = str(d.group) || undefined;
    const common = { key, label, group, resets: d.resets === true || undefined, button: d.button === true || undefined };
    switch (d.kind) {
      case 'slider': {
        const min = num(d.min, 0);
        const max = num(d.max, 1);
        if (!(max > min)) continue;
        out.push({ ...common, kind: 'slider', min, max, step: num(d.step, (max - min) / 100), default: Math.min(max, Math.max(min, num(d.default, min))) });
        break;
      }
      case 'toggle':
        out.push({ ...common, kind: 'toggle', default: d.default === true });
        break;
      case 'select': {
        const options = Array.isArray(d.options)
          ? d.options
            .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as any).value === 'string')
            .map((o) => ({ value: String(o.value), label: str(o.label) || String(o.value) }))
          : [];
        if (!options.length) continue;
        const def = str(d.default);
        out.push({ ...common, kind: 'select', options, default: options.some((o) => o.value === def) ? def : options[0].value });
        break;
      }
      case 'color': {
        const c = Array.isArray(d.default) ? d.default : [];
        const ch = (i: number) => Math.min(255, Math.max(0, num(c[i], 255)));
        out.push({ ...common, kind: 'color', default: [ch(0), ch(1), ch(2)] });
        break;
      }
      case 'media-source':
        out.push({
          ...common,
          kind: 'media-source',
          sources: ['file'],
          accept: str(d.accept) || undefined,
        });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Store every manifest entry's controls (called when the core starts). */
export function setNativeGraphParamDefsFromManifest(manifest: unknown): void {
  const next: Record<string, ParamControl[]> = {};
  if (Array.isArray(manifest)) {
    for (const entry of manifest) {
      const id = str((entry as any)?.id);
      const controls = paramControlsFromManifest((entry as any)?.param_defs);
      if (id && controls.length) next[id] = controls;
    }
  }
  nativeGraphParamDefs.set(next);
}

export function manifestParamControls(id: string): ParamControl[] {
  return get(nativeGraphParamDefs)[id] ?? [];
}

/** A new layer's params: every control's default. */
export function manifestParamDefaults(id: string): Record<string, any> {
  return deriveDefaults(manifestParamControls(id));
}

/** A cloud instrument's scan file, as the core reports it per layer. */
export type CloudLoadState = { state: 'loading' } | { state: 'ready'; points: number; isDefault?: boolean } | { state: 'failed'; reason: string };

export const nativeCloudLoadStates = writable<Record<string, CloudLoadState>>({});

let lastCloudLoadsKey = '';

/** From the core status (`audio_visual_cloud_loads`: layer id -> "loading" |
 *  "ready:<points>" | "failed:<reason>"). Writes only when something changed. */
export function setNativeCloudLoadStates(raw: unknown): void {
  const entries = raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>) : [];
  const key = JSON.stringify(entries);
  if (key === lastCloudLoadsKey) return;
  lastCloudLoadsKey = key;
  const next: Record<string, CloudLoadState> = {};
  for (const [layerId, value] of entries) {
    const text = String(value ?? '');
    if (text === 'loading') next[layerId] = { state: 'loading' };
    else if (text.startsWith('ready:')) {
      const [points, tag] = text.slice(6).split(':');
      next[layerId] = { state: 'ready', points: Number(points) || 0, ...(tag === 'default' ? { isDefault: true } : {}) };
    }
    else if (text.startsWith('failed:')) next[layerId] = { state: 'failed', reason: text.slice(7) };
  }
  nativeCloudLoadStates.set(next);
}
