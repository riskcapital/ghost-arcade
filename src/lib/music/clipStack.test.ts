import { afterEach, describe, expect, it } from 'vitest';
import { hasVisuals, liveStackKey, mediaItem, normalizeLiveStacks, normalizeStack, voiceItem, type ClipStack } from './clipStack';
import { bringStack, clearStacks, currentStacks, dropStack, dropTracks, setStackClock } from './stackRuntime';
import { expandStack } from './studioPlugin';
import { CLASSIC_PALETTE, resolvePalette } from './studioPalettes';
const DEFAULT_KEY = { root: 2, scale: 'dorian' as const };

const video = { kind: 'video' as const, name: 'Waves', src: 'file:///waves.mp4', libraryId: 'lib-waves', sourceDuration: 8 };
const shader = { kind: 'shader' as const, name: 'Tunnel', src: 'ISF/Tunnel.fs', shaderCode: '/*{"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.5}]}*/ void main(){}', shaderValues: { speed: 0.5 } };

function bassStack(): ClipStack {
  return {
    items: [
      { ...voiceItem('v1', 'VX-Barcode.fs', 'bass'), blend: 'add', opacity: 0.8, params: { density: 0.3 } },
      { ...mediaItem('m1', video)!, effects: [{ id: 'fx1', type: 'blur', enabled: true, params: { amount: 0.4 } } as never] },
      mediaItem('m2', shader)!,
    ],
    blend: 'screen',
    opacity: 0.9,
    effects: [{ id: 'fx2', type: 'kaleidoscope', enabled: true, params: {} } as never],
    mood: { palette: 'neon', finish: { glow: 0.6, trails: 0.2, grade: 'night', grain: 0.1 } },
  };
}

describe('clip visual stacks', () => {
  it('keeps a saved stack as it was, and drops what cannot be a layer', () => {
    const stack = bassStack();
    expect(normalizeStack(JSON.parse(JSON.stringify(stack)))).toEqual(stack);
    const bad = normalizeStack({
      items: [{ id: 'a', voice: { file: '../evil.fs' } }, { id: 'b', media: { kind: 'layer', name: 'x', src: '' } }, { id: 'c', media: video, blend: 'nonsense', opacity: 7 }, { id: 'c', media: video }],
      blend: 'bogus',
    })!;
    expect(bad.items.map((i) => i.id)).toEqual(['c']);
    expect(bad.items[0]).toMatchObject({ blend: 'normal', opacity: 1 });
    expect(bad.blend).toBe('screen');
    expect(hasVisuals(normalizeStack({ items: [] }))).toBe(false);
    expect(mediaItem('x', shader)?.params).toEqual({ speed: 0.5 });
  });

  it('keys Live clips by name, and by slot when a name is missing or repeated', () => {
    expect(liveStackKey('Bass', 2, ['Intro', 'Verse', 'Drop'])).toBe('Bass::Drop');
    expect(liveStackKey('Bass', 1, ['Drop', 'Drop'])).toBe('Bass#1');
    expect(liveStackKey('Bass', 0, ['', 'Verse'])).toBe('Bass#0');
    expect(Object.keys(normalizeLiveStacks({ 'Bass::Drop': bassStack(), 'Lead::Empty': { items: [] } }))).toEqual(['Bass::Drop']);
  });
});

describe('the stacks playing', () => {
  let now = 0;
  setStackClock(() => now);
  afterEach(() => clearStacks());
  const bass = bassStack();
  const lead: ClipStack = { items: [voiceItem('l1', 'VX-Panels.fs', 'lead')], blend: 'add', opacity: 1, effects: [] };
  const entry = (track: string, clipId: string, stack: ClipStack, order = 0) => ({ track, order, trackName: track, clipName: clipId, clipId, resolve: () => stack });

  it('layers a row of clips in track order, crossfades a track to its next clip, and lets a stopped track go', () => {
    now = 1000;
    bringStack(entry('studio:lead', 'c-lead', lead, 2));
    bringStack(entry('studio:bass', 'c-bass', bass, 1));
    now = 1240;
    expect(currentStacks().map((s) => [s.entry.clipId, +s.level.toFixed(2)])).toEqual([['c-bass', 0.5], ['c-lead', 0.5]]);
    now = 2000;
    // The bass track's next clip: the old one fades as the new one comes.
    bringStack(entry('studio:bass', 'c-bass-2', lead, 1));
    now = 2240;
    expect(currentStacks().map((s) => [s.entry.clipId, +s.level.toFixed(2)])).toEqual([['c-bass', 0.5], ['c-bass-2', 0.5], ['c-lead', 1]]);
    // The same clip again changes nothing.
    bringStack(entry('studio:lead', 'c-lead', lead, 2));
    now = 3000;
    expect(currentStacks().map((s) => s.entry.clipId)).toEqual(['c-bass-2', 'c-lead']);
    dropStack('studio:lead');
    dropTracks('studio:');
    now = 4000;
    expect(currentStacks()).toEqual([]);
  });

  it('shows a playing clip\'s visuals added while it plays', () => {
    let stack: ClipStack | undefined;
    now = 0;
    bringStack({ ...entry('live:Bass', '', lead), clipId: undefined, liveKey: 'Bass::Drop', resolve: () => stack });
    now = 1000;
    expect(currentStacks()).toEqual([]);
    stack = bass;
    expect(currentStacks().map((s) => s.stack)).toEqual([bass]);
  });
});

describe('a stack as layers', () => {
  it('renders each layer hidden with its effects, and mixes them with the stack\'s effects and mood', () => {
    const inputs = { code: (f: string) => (f === 'VX-Barcode.fs' ? 'void main(){}' : undefined), driven: () => ({}) };
    const palette = { id: CLASSIC_PALETTE, slots: resolvePalette(CLASSIC_PALETTE, 'analog', DEFAULT_KEY) };
    const out = expandStack('host:stack:s1', bassStack(), 'analog', inputs, palette, DEFAULT_KEY)!;
    const mix = out.layers.at(-1)!;
    expect(mix.id).toBe('host:stack:s1');
    expect(mix.opacity).toBe(0);
    const fx = mix.source!.effectSource as { vjmixRows: Array<{ layerId: string; opacity: number; blendMode: string }>; vjmixLayerEffectChain?: boolean };
    // Bottom first: the list's last layer draws first, the first on top.
    expect(fx.vjmixRows.map((r) => [r.layerId, r.blendMode, r.opacity])).toEqual([
      ['host:stack:s1:m2', 'normal', 1],
      ['host:stack:s1:m1', 'normal', 1],
      ['host:stack:s1:v1', 'add', 0.8],
    ]);
    expect(fx.vjmixLayerEffectChain).toBe(true);
    // The mood's finish, then the stack's own effects.
    expect(mix.effects!.at(-1)!.type).toBe('kaleidoscope');
    expect(mix.effects!.length).toBeGreaterThan(1);
    const byId = new Map(out.layers.map((l) => [l.id, l]));
    expect(byId.get('host:stack:s1:m1')!.source).toMatchObject({ type: 'video', isPlaying: true, playbackMode: 'loop', id: 'host:stack:s1:m1:lib-waves' });
    expect(byId.get('host:stack:s1:m1')!.effects!.map((e) => e.type)).toEqual(['blur']);
    expect(byId.get('host:stack:s1:m2')!.source).toMatchObject({ type: 'shader', shaderValues: { speed: 0.5 } });
    expect(byId.get('host:stack:s1:v1')!.source!.shaderValues).toMatchObject({ density: 0.3 });
    // A voice whose shader has not loaded waits; nothing at all to draw is no stack.
    expect(expandStack('h', { ...bassStack(), items: [voiceItem('v', 'VX-Panels.fs', 'all')] }, 'analog', inputs, palette, DEFAULT_KEY)).toBeNull();
  });
});
