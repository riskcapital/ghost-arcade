import { afterEach, describe, expect, it } from 'vitest';
import { mediaItem, voiceItem, type ClipStack } from './clipStack';
import { bringStack, clearStacks, setStackClock } from './stackRuntime';
import { defaultStudioSource, expandStudioLayers, studioVoicesFromScene, type StudioRenderInputs } from './studioPlugin';
import { createLayer, type Layer } from '../types';
import type { MixMode } from './studioMix';
import { SHUFFLE_BLENDS, mixSlots } from './studioMix';

/**
 * Auto-mix with clip visual stacks: a clip's stack is one visual in the
 * turns (the clip, as its single visual was before stacks), and it comes in
 * whole, every layer with its own blend and opacity.
 */

const shader = { kind: 'shader' as const, name: 'Tunnel', src: 'ISF/Tunnel.fs', shaderCode: '/*{"INPUTS":[]}*/ void main(){}', shaderValues: {} };
const stack = (): ClipStack => ({
  items: [
    { ...voiceItem('v1', 'VX-Barcode.fs', 'bass'), blend: 'add', opacity: 0.8 },
    { ...mediaItem('m1', shader)!, blend: 'screen', opacity: 0.5 },
  ],
  blend: 'lighten',
  opacity: 0.9,
  effects: [],
});

let bar = 0;
const inputs: StudioRenderInputs = { code: () => 'void main(){}', driven: () => ({ vxBars: Math.floor(bar), vxBar: bar - Math.floor(bar) }) };

function host(mode: MixMode, voices = 2, place: Record<string, number> = {}): Layer {
  const all = [{ file: 'VX-Barcode.fs', source: 'kick' as const }, { file: 'VX-Panels.fs', source: 'hats' as const }, { file: 'VX-DataPlot.fs', source: 'lead' as const }];
  return {
    ...createLayer('host', 'Studio', 'media'),
    source: {
      id: 'c', type: 'effect', name: 'S', src: 'plugin://musicstudio',
      effectSource: {
        ...defaultStudioSource(),
        musicVoices: studioVoicesFromScene(all.slice(0, voices)),
        musicFinish: { glow: 0, trails: 0, grade: 'neutral' as const, grain: 0 },
        musicMix: { mode, bars: 1, follow: false },
        musicStackPlace: place,
      },
    },
  } as Layer;
}

type Row = { layerId: string; opacity: number; blendMode: string };
function rowsAt(layer: Layer, at: number): { voices: Row[]; stacks: Row[]; all: Layer[] } {
  bar = at;
  const out = expandStudioLayers([layer], inputs);
  const rows = (out.find((l) => l.id === 'host')!.source!.effectSource as { vjmixRows: Row[] }).vjmixRows;
  return { voices: rows.filter((r) => r.layerId.startsWith('music-voice:')), stacks: rows.filter((r) => r.layerId.includes(':stack:')), all: out };
}
const shown = (r: Row) => r.opacity > 0.01;
/** The voices showing, by their index in the studio's list. */
const voicesOn = (voices: Row[]) => voices.filter(shown).map((r) => `v${r.layerId.split(':').at(-1)}`);

describe('auto-mix with clip visual stacks', () => {
  afterEach(() => {
    clearStacks();
    setStackClock(() => performance.now());
  });
  // The stack is fully in (no fade) so the mix alone sets its opacity.
  const bring = () => {
    setStackClock(() => 0);
    bringStack({ track: 'studio:lead', order: 2, trackName: 'Lead', clipName: 'Hook', clipId: 'c1', resolve: () => stack() }, 0);
  };

  it('All: the stack shows with its own blend and opacity, as before', () => {
    bring();
    const { stacks } = rowsAt(host('all'), 0.5);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ opacity: 0.9, blendMode: 'lighten' });
  });

  it('One by one: the clip takes its turn down the list, the voices sit out while it shows', () => {
    bring();
    // No place: the clip is on top of the list, so it is the first turn.
    const turns = [0, 1, 2, 3].map((b) => {
      const { voices, stacks } = rowsAt(host('order'), b + 0.5);
      return [...stacks.filter(shown).map(() => 'clip'), ...voicesOn(voices)];
    });
    // One visual at a time, each once per round: the clip counted once, not once per layer.
    expect(turns.every((t) => t.length === 1)).toBe(true);
    expect(turns.slice(0, 3).flat().sort()).toEqual(['clip', 'v0', 'v1']);
    expect(turns[3]).toEqual(turns[0]);
  });

  it('One by one: when the clip is picked it comes in whole, every layer at its own blend and opacity', () => {
    bring();
    const at = [0, 1, 2].find((b) => shown(rowsAt(host('order'), b + 0.5).stacks[0]))!;
    const { stacks, all } = rowsAt(host('order'), at + 0.5);
    expect(stacks[0]).toMatchObject({ opacity: 0.9, blendMode: 'lighten' });
    const inner = (all.find((l) => l.id.endsWith(':stack:' + stacks[0].layerId.split(':stack:')[1]))!.source!.effectSource as { vjmixRows: Row[] }).vjmixRows;
    expect(inner.map((r) => [r.opacity, r.blendMode])).toEqual([[0.5, 'screen'], [0.8, 'add']]);
  });

  it('follows the order set in the Visuals list (a clip placed between the voices takes its turn there)', () => {
    bring();
    const turns = [0, 1, 2].map((b) => {
      const { voices, stacks } = rowsAt(host('order', 2, { 'studio:lead': 1 }), b + 0.5);
      return [...stacks.filter(shown).map(() => 'clip'), ...voicesOn(voices)].join();
    });
    expect(turns).toEqual(['v0', 'clip', 'v1']);
  });

  it('One at random: the clip is one of the choices, never twice running', () => {
    bring();
    const picks: string[] = [];
    for (let b = 0; b < 40; b++) {
      const { voices, stacks } = rowsAt(host('random', 3), b + 0.5);
      const on = [...stacks.filter(shown).map(() => 'clip'), ...voicesOn(voices)];
      expect(on).toHaveLength(1);
      picks.push(on[0]);
    }
    expect(picks).toContain('clip');
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('Shuffle: the clip is in the shuffle, and when shown takes the shuffle blend like a voice', () => {
    bring();
    let clipShown = 0;
    let clipHidden = 0;
    for (let b = 0; b < 30; b++) {
      const { voices, stacks } = rowsAt(host('shuffle', 3), b + 0.5);
      const count = voices.filter(shown).length + stacks.filter(shown).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
      if (shown(stacks[0])) {
        clipShown++;
        expect(SHUFFLE_BLENDS).toContain(stacks[0].blendMode);
        expect(stacks[0].opacity).toBeCloseTo(0.9);
      } else clipHidden++;
    }
    expect(clipShown).toBeGreaterThan(0);
    expect(clipHidden).toBeGreaterThan(0);
  });

  it('a stack turned down to nothing sits out of the turns', () => {
    setStackClock(() => 0);
    bringStack({ track: 'studio:lead', order: 2, trackName: 'Lead', clipName: 'Hook', clipId: 'c1', resolve: () => ({ ...stack(), opacity: 0 }) }, 0);
    const turns = [0, 1, 2, 3].map((b) => voicesOn(rowsAt(host('order'), b + 0.5).voices).join());
    expect(turns).toEqual(['v0', 'v1', 'v0', 'v1']);
  });

  it('a new clip on the same track takes the old one\'s turn (the track is one visual)', () => {
    setStackClock(() => 0);
    bringStack({ track: 'studio:lead', order: 2, trackName: 'Lead', clipName: 'Hook', clipId: 'c1', resolve: () => stack() }, 0);
    // A second clip on the track while the first is still fading out: one turn between them.
    setStackClock(() => 0);
    bringStack({ track: 'studio:lead', order: 2, trackName: 'Lead', clipName: 'Verse', clipId: 'c2', resolve: () => stack() }, 1000);
    const turns = [0, 1, 2].map((b) => {
      const { voices, stacks } = rowsAt(host('order'), b + 0.5);
      return voices.filter(shown).length + (stacks.some(shown) ? 1 : 0);
    });
    expect(turns).toEqual([1, 1, 1]);
  });

  it('following the music, the clip still takes its turns', () => {
    bring();
    const layer = host('order');
    (layer.source!.effectSource as unknown as { musicMix: { follow: boolean } }).musicMix.follow = true;
    const seen = new Set<string>();
    for (let b = 0; b < 24; b++) {
      const { voices, stacks } = rowsAt(layer, b + 0.6);
      for (const v of [...stacks.filter(shown).map(() => 'clip'), ...voicesOn(voices)]) seen.add(v);
    }
    expect([...seen].sort()).toEqual(['clip', 'v0', 'v1']);
  });
});

describe('auto-mix slots', () => {
  it('are the voices in list order when no clip plays (as before stacks)', () => {
    const s = mixSlots([{ kind: 'voice', index: 0 }, { kind: 'voice', index: 1 }], [false, true], []);
    expect(s).toEqual({ muted: [false, true], voice: [0, 1], track: new Map() });
  });
  it('give each track one slot, muted only when every stack on it is', () => {
    const order = [{ kind: 'stack', index: 0 }, { kind: 'voice', index: 0 }, { kind: 'stack', index: 1 }, { kind: 'stack', index: 2 }] as const;
    const s = mixSlots(order, [false], [{ track: 'a', muted: false }, { track: 'b', muted: true }, { track: 'a', muted: true }]);
    expect(s.muted).toEqual([false, false, true]);
    expect(s.voice).toEqual([1]);
    expect([...s.track]).toEqual([['a', 0], ['b', 2]]);
  });
});
