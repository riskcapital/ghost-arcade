/**
 * Custom user-imported effects.
 *
 * Users drop in a `.dmfx.json` file (GhostArcade FX — a small JSON envelope containing
 * the effect's metadata, parameter definitions, and a GLSL shader string), and we
 * register it at runtime alongside the built-in effect catalog.
 *
 * Persistence: localStorage (`ghost-arcade-custom-effects`). Imported effects survive
 * app restarts; there's no cloud sync yet.
 *
 * Runtime integration: `effects.ts::createEffectMaterial` and
 * `effects.ts::updateEffectUniforms` check the custom registry first, falling
 * back to the built-in switch statements only for known types.
 */

import { writable, get, derived, type Writable } from 'svelte/store';
import type { EffectParamDef } from './effectParamDefs';
import { EFFECT_PARAM_DEFS } from './effectParamDefs';
import type { EffectCatalogEntry } from './effectCatalog';
import type { EffectType } from '../types';

// ── File format ──────────────────────────────────────────────────────────

/**
 * `.dmfx.json` schema v1 — the single-file envelope users import.
 *
 * Convention: custom effects should use the standard uniform names
 * (uAmount, uAmount2, uAmount3, uThreshold, uAngle, uCenter, uColor) so the
 * generic param plumbing can wire them without per-effect casework. Extra
 * uniforms are allowed but the runtime will only auto-plumb the standard ones.
 */
export interface DMFXFile {
  /** Format marker — must be exactly 1 for this version. */
  version: 1;
  /** Unique effect identifier (letters/digits/hyphens, must not collide with a built-in type). */
  type: string;
  /** Display name in the picker. */
  label: string;
  /** Category for grouping (use one of the canonical EFFECT_CATALOG categories or 'Custom'). */
  category: string;
  /** One-line pitch; shown in tooltips. */
  description: string;
  /** CSS background string for the thumbnail (e.g. 'linear-gradient(...)'). */
  previewCSS: string;
  /** Optional author credit. */
  author?: string;
  /** Optional schema URL (for editor validation). */
  $schema?: string;
  /** UI parameter definitions — see EffectParamDef. Usually 1–6 params. */
  params: DMFXParam[];
  /** The fragment shader GLSL source. Must declare `uTexture`, `uResolution`, `uTime`,
   *  `varying vec2 vUv` plus any uniforms referenced by `params[].param`. */
  shader: string;
}

export interface DMFXParam {
  /** Uniform name in the shader (e.g. `uAmount`). */
  param: string;
  /** Display label on the slider. */
  name: string;
  /** Widget type. */
  type?: 'slider' | 'color';
  /** For sliders. */
  min?: number;
  /** For sliders. */
  max?: number;
  /** For sliders. */
  step?: number;
  /** For sliders: scalar default. For colors: [r,g,b,a]. */
  default: number | [number, number, number] | [number, number, number, number];
}

// ── Runtime registry ─────────────────────────────────────────────────────

/** A fully registered custom effect — what the runtime actually holds. */
export interface CustomEffect {
  type: string;
  label: string;
  category: string;
  description: string;
  previewCSS: string;
  author?: string;
  params: EffectParamDef[];
  shader: string;
  /** Flattened default uniform values keyed by uniform name, ready for THREE.ShaderMaterial. */
  defaults: Record<string, number | [number, number, number] | [number, number, number, number]>;
  /** When the user imported this effect. */
  importedAt: number;
}

const LS_KEY = 'ghost-arcade-custom-effects';

function readFromStorage(): CustomEffect[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCustomEffect);
  } catch {
    return [];
  }
}

function isCustomEffect(x: unknown): x is CustomEffect {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.type === 'string' &&
    typeof o.label === 'string' &&
    typeof o.category === 'string' &&
    typeof o.shader === 'string' &&
    Array.isArray(o.params)
  );
}

function writeToStorage(effects: CustomEffect[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(effects));
  } catch (e) {
    console.warn('[customEffects] localStorage write failed:', e);
  }
}

/** The live list of imported custom effects. */
export const customEffects: Writable<CustomEffect[]> = writable(readFromStorage());

customEffects.subscribe(writeToStorage);

/**
 * Mirror the custom list into the shared `EFFECT_PARAM_DEFS` record so the VJ
 * and Mapper slider panels (which look up params by `effect.type`) show the
 * right controls for imported effects without needing to know the custom
 * registry exists. Panels re-read this map on every layer update, so a direct
 * mutation is enough.
 */
let previousTypes: string[] = [];
customEffects.subscribe(($list) => {
  for (const oldType of previousTypes) {
    if (!$list.find((e) => e.type === oldType)) {
      delete EFFECT_PARAM_DEFS[oldType];
    }
  }
  for (const ce of $list) {
    EFFECT_PARAM_DEFS[ce.type] = ce.params;
  }
  previousTypes = $list.map((e) => e.type);
});

/** Catalog entries for custom effects, ready to merge into EFFECT_CATALOG. */
export const customCatalogEntries = derived(customEffects, ($list) =>
  $list.map<EffectCatalogEntry>((ce) => ({
    type: ce.type as unknown as EffectType,
    label: ce.label,
    category: ce.category,
    description: ce.description,
    previewCSS: ce.previewCSS,
    tier: 'demo',
  })),
);

// ── CRUD ─────────────────────────────────────────────────────────────────

export function getCustomEffect(type: string): CustomEffect | undefined {
  return get(customEffects).find((e) => e.type === type);
}

export function getCustomEffectShader(type: string): string | undefined {
  return getCustomEffect(type)?.shader;
}

export function addCustomEffect(effect: CustomEffect): void {
  customEffects.update((list) => {
    const filtered = list.filter((e) => e.type !== effect.type);
    return [...filtered, effect];
  });
}

export function removeCustomEffect(type: string): void {
  customEffects.update((list) => list.filter((e) => e.type !== type));
}

export function clearCustomEffects(): void {
  customEffects.set([]);
}

// ── Import / validation ──────────────────────────────────────────────────

export interface ImportResult {
  ok: boolean;
  effect?: CustomEffect;
  error?: string;
}

const TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/;

/** The built-in effect types (populated at startup by registerBuiltinTypes). */
let builtinTypes: Set<string> = new Set();

export function registerBuiltinTypes(types: readonly string[]): void {
  builtinTypes = new Set(types);
}

/**
 * Parse + validate a `.dmfx.json` string. Does not execute the shader —
 * compile-time validation happens the first time the effect is applied to a layer.
 */
export function parseDMFX(json: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }

  if (!doc || typeof doc !== 'object') {
    return { ok: false, error: 'Top-level value must be an object.' };
  }
  const d = doc as Record<string, unknown>;

  if (d.version !== 1) {
    return { ok: false, error: `Unsupported version: ${d.version}. Expected 1.` };
  }

  if (typeof d.type !== 'string' || !TYPE_PATTERN.test(d.type)) {
    return {
      ok: false,
      error:
        '`type` must be a string starting with a letter, 2–64 chars, letters/digits/hyphens/underscores only.',
    };
  }

  if (builtinTypes.has(d.type)) {
    return {
      ok: false,
      error: `\`type\` "${d.type}" collides with a built-in effect. Pick a different name.`,
    };
  }

  for (const field of ['label', 'category', 'description', 'previewCSS', 'shader']) {
    if (typeof d[field] !== 'string' || !(d[field] as string).length) {
      return { ok: false, error: `Field \`${field}\` must be a non-empty string.` };
    }
  }

  if (!Array.isArray(d.params)) {
    return { ok: false, error: '`params` must be an array.' };
  }

  const paramDefs: EffectParamDef[] = [];
  const defaults: Record<string, number | [number, number, number] | [number, number, number, number]> = {};

  for (let i = 0; i < (d.params as unknown[]).length; i++) {
    const raw = (d.params as unknown[])[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `params[${i}] must be an object.` };
    }
    const p = raw as Record<string, unknown>;
    if (typeof p.param !== 'string' || !p.param.length) {
      return { ok: false, error: `params[${i}].param must be a non-empty string (the uniform name).` };
    }
    if (typeof p.name !== 'string' || !p.name.length) {
      return { ok: false, error: `params[${i}].name must be a non-empty string (the slider label).` };
    }

    const type = p.type === 'color' ? 'color' : 'slider';
    if (type === 'color') {
      if (!Array.isArray(p.default) || (p.default.length !== 3 && p.default.length !== 4)) {
        return { ok: false, error: `params[${i}].default must be [r,g,b] or [r,g,b,a] for a color.` };
      }
      defaults[p.param] = p.default as [number, number, number] | [number, number, number, number];
      paramDefs.push({
        name: p.name,
        param: p.param,
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        type: 'color',
      });
    } else {
      if (typeof p.default !== 'number') {
        return { ok: false, error: `params[${i}].default must be a number for a slider.` };
      }
      const min = typeof p.min === 'number' ? p.min : 0;
      const max = typeof p.max === 'number' ? p.max : 1;
      const step = typeof p.step === 'number' ? p.step : 0.01;
      if (max <= min) {
        return { ok: false, error: `params[${i}]: max (${max}) must be greater than min (${min}).` };
      }
      defaults[p.param] = p.default;
      paramDefs.push({ name: p.name, param: p.param, min, max, step, default: p.default });
    }
  }

  // Cheap shader sanity checks — compile-time validation happens in Three.js.
  const shader = d.shader as string;
  if (!/void\s+main\s*\(/.test(shader)) {
    return { ok: false, error: 'Shader must contain `void main() { … }`.' };
  }
  if (!/gl_FragColor\s*=/.test(shader)) {
    return { ok: false, error: 'Shader must write to `gl_FragColor`.' };
  }
  if (!/varying\s+vec2\s+vUv/.test(shader)) {
    return { ok: false, error: 'Shader must declare `varying vec2 vUv;` (match the standard effect vertex shader).' };
  }
  if (!/uniform\s+sampler2D\s+uTexture/.test(shader)) {
    return { ok: false, error: 'Shader must declare `uniform sampler2D uTexture;` (the incoming layer).' };
  }

  const effect: CustomEffect = {
    type: d.type as string,
    label: d.label as string,
    category: d.category as string,
    description: d.description as string,
    previewCSS: d.previewCSS as string,
    author: typeof d.author === 'string' ? d.author : undefined,
    params: paramDefs,
    shader,
    defaults,
    importedAt: Date.now(),
  };

  return { ok: true, effect };
}

/** Read a File from a <input type="file"> and import it. */
export async function importDMFXFromFile(file: File): Promise<ImportResult> {
  if (file.size > 512 * 1024) {
    return { ok: false, error: 'File is larger than 512 KB — probably not a valid .dmfx.json.' };
  }
  try {
    const text = await file.text();
    const result = parseDMFX(text);
    if (result.ok && result.effect) {
      addCustomEffect(result.effect);
    }
    return result;
  } catch (e) {
    return { ok: false, error: `Failed to read file: ${(e as Error).message}` };
  }
}

/** Download a JSON template the user can edit. */
export function downloadTemplate(): void {
  const template: DMFXFile = {
    $schema: 'https://ghostarcade.live/schemas/effect-v1.json',
    version: 1,
    type: 'my-custom-effect',
    label: 'My Custom Effect',
    category: 'Stylize',
    description: 'What this effect does, in one sentence.',
    author: 'Your Name',
    previewCSS: 'linear-gradient(45deg, #f0f, #0ff)',
    params: [
      { param: 'uAmount', name: 'Intensity', type: 'slider', min: 0, max: 1, default: 0.5, step: 0.01 },
      { param: 'uColor', name: 'Tint', type: 'color', default: [1, 0.5, 0.2, 1] },
    ],
    shader: [
      'precision highp float;',
      'uniform sampler2D uTexture;',
      'uniform vec2 uResolution;',
      'uniform float uTime;',
      'uniform float uAmount;',
      'uniform vec3 uColor;',
      'varying vec2 vUv;',
      '',
      'void main() {',
      '  vec4 src = texture2D(uTexture, vUv);',
      '  // Example: tint the image by uColor weighted by uAmount.',
      '  vec3 tinted = mix(src.rgb, src.rgb * uColor, uAmount);',
      '  gl_FragColor = vec4(clamp(tinted, 0.0, 1.0), src.a);',
      '}',
      '',
    ].join('\n'),
  };

  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-custom-effect.dmfx.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
