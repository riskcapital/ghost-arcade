/**
 * The Auto show's built-in content: every entry must resolve (a library
 * shader listed in the manifest, or a shape Look), its starting values and
 * mood presets must be real inputs of that shader inside their ranges, the
 * cast must cover every energy tier in every mood, and nothing may appear
 * twice.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseISF, type ISFInput } from '../../isf/parser';
import { edgeLook } from '../../looks/edgeLookCatalog';
import { LOOK_PALETTES } from '../../looks/edgeLooks';
import { STAGE_EFFECT_CATALOG } from '../../stores/stageEffects';
import { AUTO_SHOW_CATALOG, AUTO_SHOW_SCREEN_FX, autoShowLookPalette, autoShowParams } from './catalogData';
import type { AutoShowContent, AutoShowMood, AutoShowTier } from './catalogTypes';

const TIERS: AutoShowTier[] = ['calm', 'groove', 'drive', 'peak'];
const MOODS: AutoShowMood[] = ['dark', 'warm', 'cool', 'acid', 'mono'];
const ISF_DIR = join(process.cwd(), 'public', 'ISF');
const manifest: Array<{ file: string; enabled?: boolean }> = JSON.parse(readFileSync(join(ISF_DIR, 'manifest.json'), 'utf8')).shaders;

const shaders = AUTO_SHOW_CATALOG.filter((e) => e.kind === 'shader');
const looks = AUTO_SHOW_CATALOG.filter((e) => e.kind === 'look');

function inputsOf(ref: string): ISFInput[] {
  return parseISF(readFileSync(join(ISF_DIR, ref), 'utf8')).metadata.INPUTS;
}

/** Why a value does not fit an input, or null when it does. */
function misfit(input: ISFInput, value: unknown): string | null {
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  switch (input.TYPE) {
    case 'float':
      if (!num(value)) return 'not a number';
      if (input.MIN !== undefined && (value as number) < input.MIN) return `below ${input.MIN}`;
      if (input.MAX !== undefined && (value as number) > input.MAX) return `above ${input.MAX}`;
      return null;
    case 'long':
      if (!num(value) || !Number.isInteger(value)) return 'not a whole number';
      if (input.VALUES && !input.VALUES.includes(value as number)) return `not one of ${input.VALUES.join(', ')}`;
      if (input.MIN !== undefined && (value as number) < input.MIN) return `below ${input.MIN}`;
      if (input.MAX !== undefined && (value as number) > input.MAX) return `above ${input.MAX}`;
      return null;
    case 'bool':
      return typeof value === 'boolean' ? null : 'not a boolean';
    case 'color':
      return Array.isArray(value) && value.length === 4 && value.every((c) => num(c) && c >= 0 && c <= 1) ? null : 'not an RGBA colour in 0..1';
    case 'point2D':
      return Array.isArray(value) && value.length === 2 && value.every(num) ? null : 'not a 2D point';
    default:
      return `inputs of type ${input.TYPE} cannot be set`;
  }
}

function paramSets(entry: AutoShowContent): Array<[string, Record<string, number | boolean | number[]>]> {
  return [['params', entry.params ?? {}], ...(entry.variants ?? []).map((v) => [`${v.mood} preset`, v.params] as [string, typeof v.params])];
}

describe('Auto show catalog', () => {
  it('has a cast of 30–50 entries with unique ids and no repeated content', () => {
    expect(AUTO_SHOW_CATALOG.length).toBeGreaterThanOrEqual(30);
    expect(AUTO_SHOW_CATALOG.length).toBeLessThanOrEqual(50);
    const ids = AUTO_SHOW_CATALOG.map((e) => e.id);
    expect(new Set(ids).size, 'duplicate ids').toBe(ids.length);
    const refs = AUTO_SHOW_CATALOG.map((e) => `${e.kind}:${e.ref}`);
    expect(refs.filter((r, i) => refs.indexOf(r) !== i), 'the same shader or Look listed twice').toEqual([]);
    for (const e of AUTO_SHOW_CATALOG) expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('tags every entry with real tiers, moods, a texture and at least one scale', () => {
    for (const e of AUTO_SHOW_CATALOG) {
      expect(e.tiers.length, e.id).toBeGreaterThan(0);
      expect(e.moods.length, e.id).toBeGreaterThan(0);
      expect(e.scale.length, e.id).toBeGreaterThan(0);
      expect(e.tiers.every((t) => TIERS.includes(t)), e.id).toBe(true);
      expect(e.moods.every((m) => MOODS.includes(m)), e.id).toBe(true);
      expect(new Set(e.tiers).size, e.id).toBe(e.tiers.length);
      expect(new Set(e.moods).size, e.id).toBe(e.moods.length);
      expect(['geometric', 'organic', 'glitch', 'light']).toContain(e.texture);
      expect(e.scale.every((s) => s === 'piece' || s === 'span'), e.id).toBe(true);
      if (e.cost) expect(['low', 'mid', 'high']).toContain(e.cost);
    }
  });

  it('every shader is a library shader listed (and enabled) in the manifest', () => {
    for (const e of shaders) {
      expect(existsSync(join(ISF_DIR, e.ref)), `${e.id}: ${e.ref} is missing`).toBe(true);
      const listed = manifest.find((m) => m.file === e.ref);
      expect(listed, `${e.id}: ${e.ref} is not in the manifest`).toBeTruthy();
      expect(listed?.enabled, `${e.id}: ${e.ref} is disabled`).not.toBe(false);
    }
  });

  it('shader starting values and mood presets are real inputs, in range', () => {
    const bad: string[] = [];
    for (const e of shaders) {
      const inputs = inputsOf(e.ref);
      for (const [where, params] of paramSets(e)) {
        for (const [name, value] of Object.entries(params)) {
          const input = inputs.find((i) => i.NAME === name);
          if (!input) { bad.push(`${e.id} ${where}: ${name} is not an input of ${e.ref}`); continue; }
          const why = misfit(input, value);
          if (why) bad.push(`${e.id} ${where}: ${name} = ${JSON.stringify(value)} is ${why}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every Look exists and picks a real palette', () => {
    for (const e of looks) {
      expect(edgeLook(e.ref), `${e.id}: no Look ${e.ref}`).toBeTruthy();
      expect(e.scale, `${e.id}: a Look dresses each piece`).toEqual(['piece']);
      for (const [where, params] of paramSets(e)) {
        expect(Object.keys(params).every((k) => k === 'palette'), `${e.id} ${where}: a Look only takes a palette`).toBe(true);
        if (params.palette !== undefined) {
          expect(Number.isInteger(params.palette), `${e.id} ${where}`).toBe(true);
          expect(params.palette as number).toBeGreaterThanOrEqual(0);
          expect(params.palette as number).toBeLessThan(LOOK_PALETTES.length);
        }
      }
      for (const mood of e.moods) expect(LOOK_PALETTES.map((p) => p.id)).toContain(autoShowLookPalette(e, mood));
    }
  });

  it('mood presets only name moods the entry is tagged with, once each', () => {
    for (const e of AUTO_SHOW_CATALOG) {
      const moods = (e.variants ?? []).map((v) => v.mood);
      expect(new Set(moods).size, e.id).toBe(moods.length);
      for (const m of moods) expect(e.moods, `${e.id}: a ${m} preset but not tagged ${m}`).toContain(m);
    }
  });

  it('covers every tier in every mood, at least three entries per tier, both scales and every texture', () => {
    const empty: string[] = [];
    for (const tier of TIERS) {
      const inTier = AUTO_SHOW_CATALOG.filter((e) => e.tiers.includes(tier));
      expect(inTier.length, tier).toBeGreaterThanOrEqual(3);
      for (const mood of MOODS) if (!inTier.some((e) => e.moods.includes(mood))) empty.push(`${tier} × ${mood}`);
      expect(inTier.some((e) => e.scale.includes('span')), `${tier}: nothing across the stage`).toBe(true);
      expect(inTier.some((e) => e.scale.includes('piece')), `${tier}: nothing per piece`).toBe(true);
    }
    expect(empty).toEqual([]);
    for (const texture of ['geometric', 'organic', 'glitch', 'light'] as const) {
      expect(AUTO_SHOW_CATALOG.some((e) => e.texture === texture), texture).toBe(true);
    }
  });

  it('a mood preset lays over the starting values', () => {
    const e = AUTO_SHOW_CATALOG.find((x) => x.kind === 'shader' && (x.variants?.length ?? 0) > 0 && Object.keys(x.params ?? {}).length > 1)!;
    expect(e).toBeTruthy();
    const v = e.variants![0];
    expect(autoShowParams(e, v.mood)).toEqual({ ...e.params, ...v.params });
    expect(autoShowParams(e)).toEqual({ ...e.params });
    expect(autoShowParams(e, MOODS.find((m) => !e.variants!.some((x) => x.mood === m)))).toEqual({ ...e.params });
  });

  it('suggests only Screen FX that exist', () => {
    const types = STAGE_EFFECT_CATALOG.map((d) => d.type);
    for (const list of Object.values(AUTO_SHOW_SCREEN_FX)) {
      for (const type of Object.values(list).flat()) expect(types).toContain(type);
    }
  });
});
