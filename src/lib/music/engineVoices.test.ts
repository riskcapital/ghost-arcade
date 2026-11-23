import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../types';
import { nativeGraphParamDefs, paramControlsFromManifest } from '../renderer/manifestParams';
import { defaultStudioSource, expandStack, expandStudioLayers, normalizeStudioSource, studioVoiceCode, type StudioRenderInputs, type StudioVoice } from './studioPlugin';
import { voiceItem, normalizeStack } from './clipStack';
import { resolvePalette } from './studioPalettes';
import { engineVoiceFile, engineLayerParams, isEngineVoiceLayer } from './engineVoices';
import { voiceShaderByFile } from './visualScenes';
import { driftRanges } from './visualDrift';
import { createAudioVisualPacker, AV_H } from '../audio/audioVisualData';

const STRANDS_DEFS = paramControlsFromManifest([
  { kind: 'slider', key: 'speed', label: 'Speed', group: 'Motion', min: 0, max: 4, step: 0.01, default: 1 },
  { kind: 'select', key: 'palette', label: 'Palette', group: 'Look', default: 'ice-and-oxblood', options: [{ value: 'ice-and-oxblood', label: 'Ice' }, { value: 'verdigris', label: 'Verdigris' }] },
  { kind: 'select', key: 'quality', label: 'Quality', group: 'Points', default: 'medium', resets: true, options: [{ value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
  { kind: 'color', key: 'colorA', label: 'Colour A', group: 'Look', default: [255, 255, 255] },
  { kind: 'toggle', key: 'trigger', label: 'Trigger', group: 'Audio', default: false, button: true },
]);

const STRANDS = engineVoiceFile('strands');
const inputs: StudioRenderInputs = {
  code: (file) => studioVoiceCode(file) ?? (file.startsWith('VX-') ? `/*{}*/ void main(){} // ${file}` : undefined),
  driven: (source) => ({ vxEnv: source === 'kick' ? 0.8 : 0.1, vxPresence: 1 }),
};

function host(voices: StudioVoice[]): Layer {
  return {
    ...createLayer('host', 'Music Studio', 'media'),
    source: { id: 'host-clip', type: 'effect', name: 'Music Studio', src: 'plugin://musicstudio', effectSource: { ...defaultStudioSource(), musicVoices: voices, musicFinish: { glow: 0, trails: 0, grade: 'neutral', grain: 0 } } },
  } as Layer;
}

const voice = (file: string, source: StudioVoice['source'], extra: Partial<StudioVoice> = {}): StudioVoice => ({ file, source, auto: false, level: 1, params: {}, ...extra });

describe('engine voices', () => {
  beforeEach(() => nativeGraphParamDefs.set({ strands: STRANDS_DEFS }));
  afterEach(() => nativeGraphParamDefs.set({}));

  it('is a voice the studio keeps through save and load, with its name', () => {
    const saved = JSON.parse(JSON.stringify({ ...defaultStudioSource(), musicVoices: [voice(STRANDS, 'kick', { params: { speed: 2, palette: 1 }, blend: 'add' })] }));
    const loaded = normalizeStudioSource(saved);
    expect(loaded.musicVoices).toHaveLength(1);
    expect(loaded.musicVoices[0]).toMatchObject({ file: STRANDS, source: 'kick', blend: 'add', params: { speed: 2, palette: 1 } });
    expect(voiceShaderByFile(STRANDS)?.name).toBe('Strands');
    // An unknown instrument is not a voice.
    expect(normalizeStudioSource({ musicVoices: [voice('engine:nope', 'all')] }).musicVoices).toHaveLength(0);
  });

  it('offers its sliders and selects as knobs that drift, never rebuilds or buttons', () => {
    const code = studioVoiceCode(STRANDS)!;
    expect(code).toContain('"speed"');
    expect(code).toContain('"palette"');
    expect(code).not.toContain('"quality"');
    expect(code).not.toContain('"trigger"');
    expect(driftRanges(code).map((r) => r.name)).toEqual(['speed']);
  });

  it('renders as a hidden instrument layer in the mix, following its own sound', () => {
    const out = expandStudioLayers([host([voice(STRANDS, 'kick', { params: { speed: 2, palette: 1 } }), voice('VX-Barcode.fs', 'hats')])], inputs);
    const engine = out.find((l) => l.type === 'gpu')!;
    expect(isEngineVoiceLayer(engine)).toBe(true);
    expect(engine.opacity).toBe(0);
    expect(engine.gpuLayerContent).toMatchObject({ shaderId: 'strands', params: { audioSource: 'kick', speed: 2, palette: 'verdigris', quality: 'medium' } });
    const mix = out.find((l) => l.id === 'host')!;
    const rows = (mix.source!.effectSource as any).vjmixRows as Array<{ layerId: string }>;
    expect(rows.map((r) => r.layerId)).toContain(engine.id);
    expect(rows).toHaveLength(2);
  });

  it('follows a Live track by its Live source, and the master when it follows everything', () => {
    expect(engineLayerParams('strands', {}, 'live:Drums/kick').audioSource).toBe('live:Drums/kick');
    expect(engineLayerParams('strands', {}, 'all').audioSource).toBeUndefined();
  });

  it('leaves an unset colour out so the palette keeps its own', () => {
    expect('colorA' in engineLayerParams('strands', {}, 'all')).toBe(false);
  });

  it('sits in a clip stack beside an audio shader', () => {
    const stack = normalizeStack({ items: [voiceItem('a', STRANDS, 'snare'), voiceItem('b', 'VX-Barcode.fs', 'hats')] })!;
    expect(stack.items[0].name).toBe('Strands');
    const built = expandStack('s', stack, 'berlin', inputs, { id: 'classic', slots: resolvePalette('classic', 'berlin', { root: 2, scale: 'dorian' }) }, { root: 2, scale: 'dorian' })!;
    const engine = built.layers.find((l) => l.type === 'gpu')!;
    expect(engine.gpuLayerContent?.params).toMatchObject({ audioSource: 'snare' });
    expect(built.layers.filter((l) => l.source?.type === 'shader')).toHaveLength(1);
  });

  it('draws a placeholder where the core cannot draw it', () => {
    nativeGraphParamDefs.set({});
    const out = expandStudioLayers([host([voice(STRANDS, 'kick')])], { ...inputs, code: (f) => (f === STRANDS ? '/*{}*/' : undefined) });
    const ph = out.find((l) => l.id.startsWith('music-voice:'))!;
    expect(ph.type).toBe('media');
    expect(ph.source?.shaderCode).toContain('placeholder');
  });
});

describe('per-source audio packets', () => {
  const analysis = { fftData: new Float32Array(256).fill(-30), waveformData: new Float32Array(512), amplitude: 0.5 } as any;
  it('takes hits from the sound\'s own notes, once per rising hit', () => {
    const p = createAudioVisualPacker();
    const seqAt = (t: number, hit: number) => p.pack(analysis, t, { hit, env: 0.7, band: 0 })![AV_H.eventSeq];
    expect(seqAt(0.0, 0)).toBe(0);
    expect(seqAt(0.016, 1)).toBe(1);
    expect(seqAt(0.033, 0.8)).toBe(1);
    expect(seqAt(0.05, 1)).toBe(2);
    expect(p.pack(analysis, 0.066, { hit: 0, env: 0.7, band: 0 })![AV_H.envBass]).toBeGreaterThan(0.6);
  });
});
