import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../types';
import {
  MAX_STUDIO_VOICES,
  defaultStudioSource,
  expandStudioLayers,
  normalizeStudioSource,
  studioVoiceLayerId,
  studioVoicesFromScene,
  type StudioRenderInputs,
} from './studioPlugin';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlugin } from '../plugins/registry';
import { MUSIC_STUDIO } from '../features';

const inputs: StudioRenderInputs = {
  code: (file) => (file === 'VX-Missing.fs' ? undefined : `/*{}*/ void main(){} // ${file}`),
  driven: (source) => ({ vxEnv: source === 'kick' ? 0.8 : 0.1, vxPresence: 1 }),
};

function studioLayer(id: string, voices = defaultStudioSource().musicVoices): Layer {
  return {
    ...createLayer(id, 'Music Studio', 'media'),
    opacity: 0.7,
    blendMode: 'add',
    source: { id: `${id}-clip`, type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: { ...defaultStudioSource(), musicVoices: voices } },
  } as Layer;
}

describe('Music Studio plugin', () => {
  // A release build leaves the Studio out (VITE_MUSIC_STUDIO=off): then it is not offered at all.
  it('is offered as a plugin that starts with a scene, only when the Studio is in the build', () => {
    const plugin = getPlugin('musicstudio');
    if (!MUSIC_STUDIO) {
      expect(plugin).toBeUndefined();
      return;
    }
    expect(plugin?.effectType).toBe('music-studio');
    expect(plugin?.defaultSourceParams.musicVoices.length).toBeGreaterThan(0);
    // Every default voice is a shader the studio ships.
    for (const v of plugin!.defaultSourceParams.musicVoices) expect(readFileSync(join(process.cwd(), 'public/ISF', v.file), 'utf8')).toContain('vxSource');
  });

  it('turns an instance into hidden voices and one screen mix, keeping the layer itself', () => {
    const other = createLayer('plain', 'Plain', 'media');
    const out = expandStudioLayers([other, studioLayer('vj-layer-2-A')], inputs);
    const voices = out.filter((l) => l.id.startsWith('music-voice:'));
    expect(voices).toHaveLength(4);
    expect(voices.every((v) => v.opacity === 0 && v.source?.type === 'shader')).toBe(true);
    const host = out.find((l) => l.id === 'vj-layer-2-A')!;
    expect(host.opacity).toBe(0.7);
    expect(host.blendMode).toBe('add');
    expect(host.source?.id).toBe('vj-layer-2-A-clip');
    expect(host.source?.effectSource?.effectType).toBe('vj-mix');
    // Stacked from the bottom up: the first voice in the list is the last row, on top.
    expect(host.source?.effectSource?.vjmixRows).toEqual([
      { layerId: studioVoiceLayerId(host, 3), opacity: 0.8, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 2), opacity: 1, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 1), opacity: 0.6, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 0), opacity: 0.8, blendMode: 'screen' },
    ]);
    // Untouched layers pass straight through.
    expect(out[0]).toBe(other);
  });

  it('gives each voice its look, the palette, what it follows and this frame\'s signals', () => {
    const out = expandStudioLayers([studioLayer('m', studioVoicesFromScene([{ file: 'VX-Barcode.fs', source: 'kick', params: { bands: 3 } }]))], inputs);
    const values = out[0].source?.shaderValues as Record<string, unknown>;
    expect(values.bands).toBe(3);
    expect(values.vxSource).toBe(1);
    expect(values.vxAuto).toBe(true);
    expect(values.vxEnv).toBe(0.8);
    expect(values.ink).toEqual([0.94, 0.95, 0.97, 1]);
  });

  it('leaves out a voice until its shader has loaded', () => {
    const voices = studioVoicesFromScene([{ file: 'VX-Missing.fs', source: 'kick' }, { file: 'VX-Barcode.fs', source: 'hats' }]);
    const out = expandStudioLayers([studioLayer('m', voices)], inputs);
    expect(out.filter((l) => l.id.startsWith('music-voice:')).map((l) => l.id)).toEqual(['music-voice:m:1']);
  });

  it('counts the instances it saw', () => {
    let seen = -1;
    expandStudioLayers([studioLayer('a'), studioLayer('b'), createLayer('c', 'C')], inputs, (n) => (seen = n));
    expect(seen).toBe(2);
    expandStudioLayers([createLayer('c', 'C')], inputs, (n) => (seen = n));
    expect(seen).toBe(0);
  });

  it('cleans a saved instance', () => {
    const many = Array.from({ length: 9 }, () => ({ file: 'VX-Barcode.fs', source: 'kick', level: 3 }));
    const s = normalizeStudioSource({ musicSet: 'nope', musicVoices: [...many, { file: '../../etc/passwd' }, { file: 'VX-Ok.fs', source: 'nope', params: { a: 'x', b: 2, 'bad name': 1 } }] });
    expect(s.musicSet).toBe('berlin');
    // No small cap any more: nine visuals and the good extra one all survive.
    expect(s.musicVoices).toHaveLength(10);
    // A damaged file cannot make thousands.
    expect(normalizeStudioSource({ musicVoices: Array.from({ length: 1000 }, () => ({ file: 'VX-Barcode.fs', source: 'kick' })) }).musicVoices).toHaveLength(MAX_STUDIO_VOICES);
    expect(s.musicVoices[0].level).toBe(1);
    const odd = normalizeStudioSource({ musicVoices: [{ file: 'VX-Ok.fs', source: 'nope', params: { a: 'x', b: 2, 'bad name': 1 } }] }).musicVoices[0];
    expect(odd).toEqual({ file: 'VX-Ok.fs', source: 'all', auto: true, level: 1, blend: 'screen', params: { b: 2 } });
  });

  it('keeps each voice its own blend mode, and screen for an unknown one', () => {
    const s = normalizeStudioSource({ musicVoices: [{ file: 'VX-A.fs', blend: 'multiply' }, { file: 'VX-B.fs', blend: 'nope' }] });
    expect(s.musicVoices.map((v) => v.blend)).toEqual(['multiply', 'screen']);
  });

  it('can hold every built-in scene', () => {
    // Scenes are listed in visualScenes.ts; read them from the source so this test needs no DOM.
    const source = readFileSync(join(process.cwd(), 'src/lib/music/visualScenes.ts'), 'utf8');
    const scenes = source.split(/\{ id: '[a-z-]+', name: /).slice(1).map((block) => block.split(/\] \},/)[0]);
    expect(scenes.length).toBeGreaterThan(10);
    for (const block of scenes) {
      const voices = [...block.matchAll(/file: '([^']+)', source: '([a-z]+)'/g)].map((m) => ({ file: m[1], source: m[2] as 'all' }));
      expect(voices.length).toBeGreaterThan(0);
      expect(voices.length).toBeLessThanOrEqual(MAX_STUDIO_VOICES);
      expect(normalizeStudioSource({ musicVoices: studioVoicesFromScene(voices) }).musicVoices).toHaveLength(voices.length);
    }
  });
});

describe('Music Studio auto-mix in the render', () => {
  it('shows one visual at a time by the bar, at its own level', () => {
    const voices = studioVoicesFromScene([
      { file: 'VX-Barcode.fs', source: 'kick', level: 0.8 },
      { file: 'VX-Panels.fs', source: 'hats' },
      { file: 'VX-Glyphs.fs', source: 'bass' },
    ]);
    const layer = studioLayer('m', voices);
    (layer.source!.effectSource as any).musicMix = { mode: 'order', bars: 1 };
    const atBar = (bars: number): StudioRenderInputs => ({ ...inputs, driven: () => ({ vxPresence: 1, vxBars: bars, vxBar: 0.5 }) });
    const rows = (bars: number) => {
      const mixLayer = expandStudioLayers([layer], atBar(bars)).find((l) => (l.source?.effectSource as any)?.effectType === 'vj-mix')!;
      // Rows are stacked bottom-up; turn them back into list order.
      return [...(mixLayer.source!.effectSource as any).vjmixRows].reverse().map((r: { opacity: number }) => r.opacity);
    };
    expect(rows(0)).toEqual([0.8, 0, 0]);
    expect(rows(1)).toEqual([0, 1, 0]);
    expect(rows(2)).toEqual([0, 0, 1]);
  });

  it('lets shuffle change the blends while it is on, and only then', () => {
    const voices = studioVoicesFromScene(Array.from({ length: 4 }, () => ({ file: 'VX-Barcode.fs', source: 'kick' as const })));
    const layer = studioLayer('m', voices);
    const mixRows = (mode: string) => {
      (layer.source!.effectSource as any).musicMix = { mode, bars: 1 };
      const out = expandStudioLayers([layer], { ...inputs, driven: () => ({ vxPresence: 1, vxBars: 5, vxBar: 0.5 }) });
      return (out.find((l) => (l.source?.effectSource as any)?.effectType === 'vj-mix')!.source!.effectSource as any).vjmixRows as { opacity: number; blendMode: string }[];
    };
    expect(mixRows('all').every((r) => r.blendMode === 'screen' && r.opacity === 1)).toBe(true);
    const shuffled = mixRows('shuffle').filter((r) => r.opacity > 0.99);
    expect(shuffled.length).toBeGreaterThan(0);
    expect(shuffled.length).toBeLessThanOrEqual(3);
  });
});
