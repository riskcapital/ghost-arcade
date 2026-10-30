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
  it('is offered as a plugin that starts with a scene', () => {
    const plugin = getPlugin('musicstudio');
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
    expect(host.source?.effectSource?.vjmixRows).toEqual([
      { layerId: studioVoiceLayerId(host, 0), opacity: 0.8, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 1), opacity: 0.6, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 2), opacity: 1, blendMode: 'screen' },
      { layerId: studioVoiceLayerId(host, 3), opacity: 0.8, blendMode: 'screen' },
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
    expect(s.musicVoices).toHaveLength(MAX_STUDIO_VOICES);
    expect(s.musicVoices[0].level).toBe(1);
    const odd = normalizeStudioSource({ musicVoices: [{ file: 'VX-Ok.fs', source: 'nope', params: { a: 'x', b: 2, 'bad name': 1 } }] }).musicVoices[0];
    expect(odd).toEqual({ file: 'VX-Ok.fs', source: 'all', auto: true, level: 1, params: { b: 2 } });
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
