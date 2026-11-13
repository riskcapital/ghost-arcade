import { describe, expect, it } from 'vitest';
import { defaultShow, normalizeShow, newSurface, gridPoints, forgetSurfaceClip, type Show } from './model';
import { planSurfaceClips, putOnSurface, libraryClip, surfaceCapMessage } from './surfaceClips';
import { deviceTier, surfaceClipCap, SURFACE_CLIP_CAP } from './qualityGovernor';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { mobileHeavyShaderPaths } from './shaderPerformance';
import { standaloneShaderPaths } from './shaderAvailability';

const shaderIds = (show: Show) => show.clips.filter((c) => c.kind === 'shader').map((c) => c.id);

function mapped(count: number, clips: (string | undefined)[]): Show {
  const show = defaultShow();
  show.mapping = true;
  show.surfaces = Array.from({ length: count }, (_, i) => ({ ...newSurface(i), clipId: clips[i] }));
  return show;
}

describe('a clip per surface: old sets', () => {
  it('loads a set saved before 1.2 exactly as before: no surface gains a clip', () => {
    const old = defaultShow();
    old.mapping = true;
    old.surfaces = [
      { ...newSurface(0), source: 'mix' },
      { ...newSurface(1), source: 2, points: gridPoints(0.1, 0.1, 0.3, 0.3) },
    ];
    // What app 1.1 wrote: no clipId key, no stage key.
    const saved = JSON.parse(JSON.stringify(old));
    for (const s of saved.surfaces) delete s.clipId;
    const loaded = normalizeShow(saved);
    expect(loaded.surfaces.map((s) => 'clipId' in s)).toEqual([false, false]);
    expect(loaded.surfaces.map((s) => s.source)).toEqual(['mix', 2]);
    expect('stage' in loaded).toBe(false);
    // And saves back byte-for-byte the same surfaces.
    expect(JSON.stringify(normalizeShow(JSON.parse(JSON.stringify(loaded))).surfaces)).toBe(JSON.stringify(loaded.surfaces));
  });
  it('keeps a surface clip through a save and load', () => {
    const show = mapped(2, [undefined, undefined]);
    const id = shaderIds(show)[3];
    show.surfaces[1].clipId = id;
    const loaded = normalizeShow(JSON.parse(JSON.stringify(show)));
    expect(loaded.surfaces[1].clipId).toBe(id);
    expect(loaded.surfaces[0].clipId).toBeUndefined();
  });
  it('drops a surface clip that left the set, or is a live camera, and keeps the deck source', () => {
    const show = mapped(2, ['gone', 'camera-user']);
    show.clips.push({ id: 'camera-user', kind: 'camera', facing: 'user', name: 'Front camera' });
    show.surfaces[0].source = 3;
    const loaded = normalizeShow(JSON.parse(JSON.stringify(show)));
    expect(loaded.surfaces.map((s) => s.clipId)).toEqual([undefined, undefined]);
    expect(loaded.surfaces[0].source).toBe(3);
  });
  it('keeps the stage only while mapping is on', () => {
    const on = { ...mapped(1, []), stage: 'boxes' };
    expect(normalizeShow(JSON.parse(JSON.stringify(on))).stage).toBe('boxes');
    expect('stage' in normalizeShow(JSON.parse(JSON.stringify({ ...on, mapping: false })))).toBe(false);
    expect('stage' in normalizeShow(JSON.parse(JSON.stringify({ ...on, stage: '<script>' })))).toBe(false);
  });
  it('forgets a removed clip on every surface that showed it', () => {
    const surfaces = mapped(3, ['a', 'b', 'a']).surfaces;
    const next = forgetSurfaceClip(surfaces, 'a');
    expect(next.map((s) => s.clipId)).toEqual([undefined, 'b', undefined]);
    expect(next[1]).toBe(surfaces[1]);
  });
});

describe('a clip per surface: the plan', () => {
  it('plays nothing while mapping is off', () => {
    const show = mapped(2, []);
    show.surfaces[0].clipId = shaderIds(show)[0];
    show.mapping = false;
    expect(planSurfaceClips(show, 4).playing).toEqual([]);
  });
  it('renders each different clip once, in surface order, up to the cap', () => {
    const base = mapped(6, []);
    const [a, b, c, d] = shaderIds(base);
    const show = mapped(6, [a, b, a, c, d, b]);
    const plan = planSurfaceClips(show, 3);
    expect(plan.playing).toEqual([a, b, c]);
    expect(plan.capped).toEqual([4]);
    expect(plan.wanted).toBe(4);
    expect(surfaceCapMessage(plan, 'This iPhone')).toBe('This iPhone plays 3 different surface clips at once. Surface 5 shows the deck instead.');
    expect(surfaceCapMessage(planSurfaceClips(show, 4))).toBe('');
  });
  it('skips switched-off surfaces and clips this device cannot run', () => {
    const show = mapped(3, []);
    const heavy = MOBILE_SHADERS.find((s) => mobileHeavyShaderPaths.has(s.path))!;
    show.clips.push({ id: 'heavy', kind: 'shader', shaderId: heavy.id, name: heavy.name });
    const [a, b] = shaderIds(show);
    show.surfaces[0].clipId = 'heavy';
    show.surfaces[1] = { ...show.surfaces[1], clipId: a, enabled: false };
    show.surfaces[2].clipId = b;
    expect(planSurfaceClips(show, 1)).toMatchObject({ playing: [b], capped: [] });
  });
});

describe('putting a visual on a surface', () => {
  it('reuses the set clip of a library visual, or adds one', () => {
    const show = mapped(2, []);
    const existing = show.clips.find((c) => c.kind === 'shader')!;
    const reuse = putOnSurface(show, 0, { shader: existing.shaderId! });
    expect(reuse.clips).toBe(show.clips);
    expect(reuse.surfaces[0].clipId).toBe(existing.id);
    const unused = MOBILE_SHADERS.find((s) => !s.requiresImage && standaloneShaderPaths.has(s.path) && !mobileHeavyShaderPaths.has(s.path) && !show.clips.some((c) => c.shaderId === s.id))!;
    const added = putOnSurface(show, 1, { shader: unused.id });
    expect(added.clips.length).toBe(show.clips.length + 1);
    expect(added.clips.at(-1)).toMatchObject({ kind: 'shader', shaderId: unused.id, name: unused.name });
    expect(added.surfaces[1].clipId).toBe(added.clips.at(-1)!.id);
  });
  it('puts a photo or video of the set on a surface, never a live camera', () => {
    const show = mapped(1, []);
    show.clips.push({ id: 'photo', kind: 'image', assetId: 'p', name: 'Wall.jpg' }, { id: 'cam', kind: 'camera', name: 'Rear camera' });
    expect(putOnSurface(show, 0, { clip: 'photo' }).surfaces[0].clipId).toBe('photo');
    expect(putOnSurface(show, 0, { clip: 'cam' })).toBe(show);
  });
  it('takes the clip off again with the deck mix', () => {
    const show = mapped(1, []);
    show.surfaces[0].clipId = shaderIds(show)[0];
    const deck = putOnSurface(show, 0, { deck: true });
    expect('clipId' in deck.surfaces[0]).toBe(false);
    expect(deck.surfaces[0].source).toBe('mix');
  });
  it('will not use a shader that needs a picture of its own', () => {
    const needsImage = MOBILE_SHADERS.find((s) => s.requiresImage);
    if (needsImage) expect(libraryClip([], needsImage.id)).toBeNull();
  });
});

describe('device tier', () => {
  it('reads memory first and falls back to the middle tier', () => {
    expect(deviceTier({ memoryGB: 3 })).toBe('economy');
    expect(deviceTier({ memoryGB: 4 })).toBe('balanced');
    expect(deviceTier({ memoryGB: 6 })).toBe('high');
    expect(deviceTier({ memoryGB: 8, cores: 6 })).toBe('high');
    expect(deviceTier({})).toBe('balanced');
    expect(deviceTier({ cores: 2 })).toBe('economy');
    expect(surfaceClipCap({ memoryGB: 6 })).toBe(SURFACE_CLIP_CAP.high);
  });
  it('lets every tier play every template (three different visuals at most)', () => {
    expect(Math.min(...Object.values(SURFACE_CLIP_CAP))).toBeGreaterThanOrEqual(3);
  });
});
