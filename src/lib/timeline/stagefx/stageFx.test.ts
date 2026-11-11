/**
 * Screen FX and Effects rows on the Timeline: block weights (fades,
 * crossfade over an overlap, cut where blocks touch), the Screen FX row's
 * rule (no blocks = the project's own Screen FX; blocks = nothing between
 * them), pure evaluation (scrub = play), lines on a block's settings and on
 * composition colours, the Effects row's effects at their mixes, the store
 * (add/move/trim/delete, undo, save/load v9, old files), the runtime that
 * takes over from the project's Screen FX automation, and the score draft.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

vi.mock('../../stores/layers', () => ({ project: writable({ layers: [], wledControllers: [], mappingComposition: null }) }));
vi.mock('../../stores/audio', () => ({ audioStore: writable({ bpm: 120, manualBPM: null, isActive: false }) }));
vi.mock('../../ableton/abletonBridge', () => ({
  abletonBridge: { liveParamValue: () => null, liveLevelValue: () => null, watchLiveSources: () => {} },
}));

import { project } from '../../stores/layers';
import type { Effect, Layer, StageEffect } from '../../types';
import { createTempoMap } from '../../show/tempoMap';
import { showTimeline, setShowCompositionLoader } from '../../stores/showTimeline';
import { normalizeStageClip, normalizeStageClips, stageClipWeights, type TimelineStageClip } from './stageClips';
import { evaluateStageFx, screenFxPieces, scenePieceId, timelineScreenFxValue } from './stageFxEval';
import { applyEffectBlockLines, applyScreenFxLines, effectBlockParams, screenFxBlockParams } from './stageFxParams';
import { effectColourGroups } from './effectColours';
import { applyStageOverrides, discoverStageParams, readStageLedParam } from '../lines/stageLedParams';
import { findParam, paramsFor, readParam } from '../lines/paramRegistry';
import { installStageFxRuntime, stageRowsDrive, _resetStageFxRuntime } from './stageFxRuntime';
import { timelineCompositionEffects, timelineScreenFx, timelineScreenFxFor } from './stageFxState';
import { createDefaultStageEffect } from '../../stores/stageEffects';
import { createLineEvaluator } from '../lines/lineEvaluator';
import type { ControlLine } from '../lines/lineModel';
import { draftScore, sequentialIds, type ScoreStage } from '../score/scoreDraft';
import { timelineRegistrySource } from '../lines/timelineLines';
import { linesForStage } from '../../components/show/timeline/lineUi';

function piece(id: string, x0: number, x1: number): Layer {
  return {
    id, name: id, type: 'shader', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null,
    corners: { topLeft: { x: x0, y: 1 }, topRight: { x: x1, y: 1 }, bottomLeft: { x: x0, y: 0 }, bottomRight: { x: x1, y: 0 } },
    layerShape: null,
  } as unknown as Layer;
}
const layers = [piece('Left', 0, 0.3), piece('Middle', 0.35, 0.65), piece('Right', 0.7, 1)];
const pieces = screenFxPieces(layers);

function fx(type: StageEffect['type'], params: Record<string, number> = {}, extra: Partial<StageEffect> = {}): StageEffect {
  const e = createDefaultStageEffect(type);
  return { ...e, params: { ...e.params, ...params }, ...extra };
}
function sfxClip(id: string, start: number, duration: number, screenFx: StageEffect, extra: Partial<TimelineStageClip> = {}): TimelineStageClip {
  return normalizeStageClip({ id, row: 'screenfx', startTime: start, duration, screenFx, ...extra })!;
}
function fxClip(id: string, start: number, duration: number, effect: Partial<Effect>, extra: Partial<TimelineStageClip> = {}): TimelineStageClip {
  return normalizeStageClip({ id, row: 'effects', startTime: start, duration, effect: { id: `e-${id}`, enabled: true, params: {}, opacity: 1, ...effect }, ...extra })!;
}
const brightness = (frame: ReturnType<typeof evaluateStageFx>, id: string) => frame.screenFx!.get(id)!.brightness;
const at = (clips: TimelineStageClip[], time: number, extra: Partial<Parameters<typeof evaluateStageFx>[0]> = {}) =>
  evaluateStageFx({ time, clips, pieces, tempo: createTempoMap(120, 0), lines: null, ...extra });

describe('block weights', () => {
  it('fades ramp a block; touching blocks cut; overlapping blocks crossfade and sum to 1', () => {
    const a = sfxClip('a', 0, 4, fx('still'), { fadeIn: 1 });
    const b = sfxClip('b', 4, 4, fx('still'));
    const c = sfxClip('c', 6, 4, fx('still'));
    const clips = [a, b, c];
    expect(stageClipWeights(clips, 'screenfx', 0.5).map((w) => w.weight)).toEqual([0.5]);
    expect(stageClipWeights(clips, 'screenfx', 3.99).map((w) => w.clip.id)).toEqual(['a']);
    expect(stageClipWeights(clips, 'screenfx', 4).map((w) => w.clip.id)).toEqual(['b']);
    // b [4,8) and c [6,10) overlap over [6,8): at 7 they are half and half.
    const mid = stageClipWeights(clips, 'screenfx', 7);
    expect(mid.map((w) => w.clip.id)).toEqual(['b', 'c']);
    expect(mid[0].weight).toBeCloseTo(0.5, 6);
    expect(mid[0].weight + mid[1].weight).toBeCloseTo(1, 6);
    expect(stageClipWeights(clips, 'screenfx', 10)).toEqual([]);
    // rows are separate
    expect(stageClipWeights(clips, 'effects', 7)).toEqual([]);
  });
});

describe('Screen FX row', () => {
  it('no blocks on the row: null (the project keeps its own Screen FX)', () => {
    expect(at([], 1).screenFx).toBeNull();
    expect(at([fxClip('x', 0, 4, { type: 'invert' as Effect['type'] })], 1).screenFx).toBeNull();
  });

  it('a strobe changes per-piece brightness only inside its span; between blocks every piece is at its own level', () => {
    const strobe = sfxClip('s', 2, 2, fx('strobe', { rate: 2, duty: 0.5 }));
    const clips = [strobe];
    // outside: no Screen FX at all (the row has blocks, so the project's are off too)
    for (const t of [0, 1.9, 4, 6]) for (const p of pieces) expect(brightness(at(clips, t), p.id)).toBe(1);
    // inside: on in the first half of each 0.5 s cycle, off in the second
    expect(brightness(at(clips, 2.1), 'Left')).toBe(1);
    expect(brightness(at(clips, 2.4), 'Left')).toBe(0);
    expect(brightness(at(clips, 2.4), 'Right')).toBe(0);
    expect(brightness(at(clips, 2.6), 'Middle')).toBe(1);
  });

  it('beat pulse flashes on the Timeline beats (pure: scrubbed = played)', () => {
    const pulse = sfxClip('p', 0, 8, fx('beat-pulse', { decay: 0.2 }));
    const tempo = createTempoMap(120, 0); // a beat every 0.5 s
    expect(brightness(at([pulse], 1.0, { tempo }), 'Left')).toBeCloseTo(1, 3);
    expect(brightness(at([pulse], 1.1, { tempo }), 'Left')).toBeCloseTo(0.5, 3);
    expect(brightness(at([pulse], 1.3, { tempo }), 'Left')).toBe(0);
    const order = [3.05, 0.1, 2.5, 1.1, 3.05, 0.1];
    const values = order.map((t) => brightness(at([pulse], t, { tempo }), 'Middle'));
    expect(values[0]).toBe(values[4]);
    expect(values[1]).toBe(values[5]);
  });

  it('a sweep crossfades into a pulse over their overlap', () => {
    const sweep = sfxClip('sw', 0, 6, fx('linear-sweep', { speed: 0.5, bandWidth: 0.3, tail: 0.4, angle: 0 }));
    const pulse = sfxClip('pu', 4, 6, fx('beat-pulse', { decay: 0.2 }));
    const clips = [sweep, pulse];
    const t = 5.1; // half way through the overlap [4,6)
    const alone = (c: TimelineStageClip) => at([{ ...c, startTime: c.startTime, fadeIn: 0, fadeOut: 0 }], t);
    for (const p of pieces) {
      const mixed = brightness(at(clips, t), p.id);
      const a = brightness(alone(sweep), p.id);
      const b = brightness(alone(pulse), p.id);
      const w = stageClipWeights(clips, 'screenfx', t);
      expect(mixed).toBeCloseTo(w[0].weight * a + w[1].weight * b, 6);
    }
    // only the pulse after the overlap
    expect(at(clips, 7).screenFxBlocks.map((b) => b.clipId)).toEqual(['pu']);
  });

  it('a colour chase tints the pieces; brightness-only effects do not', () => {
    const chase = sfxClip('c', 0, 4, fx('chase', { speed: 0.5, width: 0.3 }, { output: 'color', color: '#ff0000', color2: '#0000ff' }));
    const f = at([chase], 0.1);
    for (const p of pieces) {
      const out = f.screenFx!.get(p.id)!;
      expect(out.brightness).toBe(1);
      expect(out.tint).not.toBeNull();
    }
    expect(at([sfxClip('s', 0, 4, fx('strobe'))], 0.01).screenFx!.get('Left')!.tint).toBeNull();
  });

  it('a where line limits which pieces the effect touches', () => {
    const strobe = sfxClip('s', 0, 4, fx('strobe', { rate: 2, duty: 0.5 }), { where: { order: 'left-right', motion: { kind: 'drawn' }, position: 0, spread: 0, soft: 0, wrap: false, members: 'pieces' } as any });
    const where = new Map([['s', new Map([['Left', 1]])]]);
    const f = at([strobe], 0.4, { where });
    expect(brightness(f, 'Left')).toBe(0);
    expect(brightness(f, 'Middle')).toBe(1);
    expect(brightness(f, 'Right')).toBe(1);
  });

  it('random hits and audio reactive are pure functions of time', () => {
    const hits = fx('random-hits', { rate: 20, duration: 0.2, peak: 1 });
    const a = [0.05, 0.37, 1.21].map((t) => timelineScreenFxValue(hits, pieces[0], 0, 3, t, t, { tempo: null }));
    const b = [1.21, 0.05, 0.37].map((t) => timelineScreenFxValue(hits, pieces[0], 0, 3, t, t, { tempo: null }));
    expect([b[1], b[2], b[0]]).toEqual(a);
    const rms = fx('audio-rms-intensity', { gain: 3, floor: 0 });
    expect(timelineScreenFxValue(rms, pieces[0], 0, 3, 1, 1, { tempo: null, level: () => 0.5 })).toBeCloseTo(0.5, 6);
    expect(timelineScreenFxValue(rms, pieces[0], 0, 3, 1, 1, { tempo: null, level: () => null })).toBe(0);
  });

  it('copies of a piece in the Timeline scene follow the piece', () => {
    expect(scenePieceId('showsub::Left::row2')).toBe('Left');
    expect(scenePieceId('showwhere::Right::clip')).toBe('Right');
    expect(scenePieceId('showtrack::Middle')).toBe('Middle');
    expect(scenePieceId('Left')).toBeNull();
  });
});

describe('lines on Screen FX blocks and composition colours', () => {
  it('every numeric setting of a Screen FX block is a block line key', () => {
    const clip = sfxClip('s', 0, 4, fx('radial-pulse'));
    const keys = screenFxBlockParams(clip).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['sfx:mix', 'sfx:param:speed', 'sfx:param:ringWidth', 'sfx:param:tail', 'sfx:param:originX', 'sfx:param:originY', 'sfx:color', 'sfx:color2', 'sfx:output', 'sfx:colorStyle']));
    expect(screenFxBlockParams(clip).find((p) => p.key === 'sfx:color')!.kind).toBe('colour');
    const spiral = screenFxBlockParams(sfxClip('sp', 0, 4, fx('spiral'))).find((p) => p.key === 'sfx:param:arms')!;
    expect(spiral.kind).toBe('stepped');
  });

  it('a line on the strobe rate and the colour reaches the evaluation; the block is not changed', () => {
    const clip = sfxClip('s', 0, 4, fx('strobe', { rate: 2, duty: 0.5 }));
    const lines = { time: 0, layers: new Map(), stage: null, leds: null, blocks: new Map([['s', { 'sfx:param:rate': 1, 'sfx:mix': 0.5 }]]) } as any;
    // rate 1 Hz, duty 0.5: at 0.4 still on (would be off at 2 Hz); mix 0.5 → off = 0.5
    expect(brightness(at([clip], 0.4, { lines }), 'Left')).toBe(1);
    expect(brightness(at([clip], 0.7, { lines }), 'Left')).toBeCloseTo(0.5, 6);
    expect(clip.screenFx!.params.rate).toBe(2);
    const coloured = applyScreenFxLines(clip.screenFx!, { 'sfx:color': 0x00ff00, 'sfx:output': 2 });
    expect(coloured.color).toBe('#00ff00');
    expect(coloured.output).toBe('both');
    expect(clip.screenFx!.color).toBeUndefined();
  });

  it('a drawn line on a Screen FX block evaluates through the lines engine into the frame', () => {
    const clip = sfxClip('s', 0, 4, fx('strobe', { rate: 2, duty: 0.5 }));
    const line: ControlLine = { id: 'l', target: { scope: 'block', id: 's' }, key: 'sfx:mix', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0 }, { t: 4, v: 1 }] };
    const frame = createLineEvaluator().evaluate([line], 1, {} as any);
    expect(frame.blocks!.get('s')!['sfx:mix']).toBeCloseTo(0.25, 6);
    // at 1.3 s the 2 Hz strobe is off and the mix is 0.325: brightness 0.675
    const f2 = createLineEvaluator().evaluate([line], 1.3, {} as any);
    expect(brightness(at([clip], 1.3, { lines: f2 }), 'Left')).toBeCloseTo(1 - 0.325, 4);
  });

  it('composition effects: colour params are colour lines (stage row) and apply to copies', () => {
    const groups = effectColourGroups('vignette');
    expect(groups.map((g) => g.base)).toContain('vignetteColor');
    const effect = { id: 'v', type: 'vignette', enabled: true, params: { vignetteColorR: 1, vignetteColorG: 0, vignetteColorB: 0 }, opacity: 1 } as unknown as Effect;
    const comp = { enabled: true, effects: [effect], stageEffects: [], activeStageEffectId: null, stageEffectAutomation: { playing: false, mode: 'time', seconds: 4, beats: 4 } } as any;
    const p = discoverStageParams(comp).find((x) => x.key === 'stage:fx:v:rgb:vignetteColor')!;
    expect(p.kind).toBe('colour');
    expect(p.defaultValue).toBe(0xff0000);
    expect(readStageLedParam('stage:fx:v:rgb:vignetteColor', comp, [], [])).toBe(0xff0000);
    const [out] = applyStageOverrides([effect], { 'stage:fx:v:rgb:vignetteColor': 0x0080ff });
    expect((out.params as any).vignetteColorR).toBe(0);
    expect((out.params as any).vignetteColorG).toBeCloseTo(128 / 255, 6);
    expect((out.params as any).vignetteColorB).toBe(1);
    expect((effect.params as any).vignetteColorR).toBe(1);
    // the registry offers it
    expect(findParam({ layers: [], mappingComposition: comp }, { scope: 'stage' }, 'stage:fx:v:rgb:vignetteColor')?.kind).toBe('colour');
  });
});

describe('Effects row', () => {
  it('blocks switch an effect on for their span, crossfading by mix; lines reach the copy', () => {
    const a = fxClip('a', 0, 4, { type: 'invert' as Effect['type'], params: { invertAmount: 1 } as any, opacity: 0.8 });
    const b = fxClip('b', 3, 4, { type: 'vignette' as Effect['type'], params: {} as any });
    expect(at([a, b], -0.1).effects).toEqual([]);
    const one = at([a, b], 1).effects;
    expect(one).toHaveLength(1);
    expect(one[0].type).toBe('invert');
    expect(one[0].opacity).toBeCloseTo(0.8, 6);
    const both = at([a, b], 3.5).effects;
    expect(both.map((e) => e.type)).toEqual(['invert', 'vignette']);
    expect(both[0].opacity).toBeCloseTo(0.8 * 0.5, 6);
    expect(both[1].opacity).toBeCloseTo(0.5, 6);
    expect(at([a, b], 7).effects).toEqual([]);
    // own ids so the composite chain keeps them apart from the project's
    expect(one[0].id).toBe('timeline-fx:a');
    const lines = { time: 0, layers: new Map(), stage: null, leds: null, blocks: new Map([['b', { 'fxb:mix': 0.25, 'fxb:rgb:vignetteColor': 0xff0000 }]]) } as any;
    const v = at([b], 5, { lines }).effects[0];
    expect(v.opacity).toBeCloseTo(0.25, 6);
    expect((v.params as any).vignetteColorR).toBe(1);
    expect(effectBlockParams(b).some((p) => p.key === 'fxb:rgb:vignetteColor' && p.kind === 'colour')).toBe(true);
    expect(applyEffectBlockLines(b.effect!, null)).toBe(b.effect);
  });
});

describe('store, save and load', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    showTimeline.activateDoc('timeline', { quiet: true });
  });
  afterEach(() => showTimeline._resetForTest());

  it('add, move (lines move with the block), trim, delete; each one undo step', () => {
    showTimeline.setSnapEnabled?.(false);
    const id = showTimeline.addStageClip('screenfx', 2, { duration: 4, screenFx: fx('strobe') })!;
    expect(get(showTimeline).selection).toEqual({ kind: 'stageClip', id });
    expect(get(showTimeline).duration).toBeGreaterThanOrEqual(6);
    showTimeline.editLines(() => [{ id: 'l', target: { scope: 'block', id }, key: 'sfx:mix', kind: 'continuous', min: 0, max: 1, points: [{ t: 3, v: 0.5 }] }]);
    const before = showTimeline.exportArrangement();
    showTimeline.moveStageClip(id, 5);
    expect(showTimeline.findStageClip(id)!.startTime).toBeCloseTo(5, 6);
    expect(get(showTimeline).lines[0].points[0].t).toBeCloseTo(6, 6);
    showTimeline.resizeStageClip(id, 'end', 7);
    expect(showTimeline.findStageClip(id)!.duration).toBeCloseTo(2, 6);
    showTimeline.updateStageClip(id, { screenFx: { ...showTimeline.findStageClip(id)!.screenFx!, params: { rate: 9, duty: 0.2 } } });
    expect(showTimeline.findStageClip(id)!.screenFx!.params.rate).toBe(9);
    showTimeline.restoreArrangement(before);
    expect(showTimeline.findStageClip(id)!.startTime).toBeCloseTo(2, 6);
    showTimeline.removeStageClip(id);
    expect(get(showTimeline).stageClips).toEqual([]);
    expect(get(showTimeline).lines).toEqual([]);
  });

  it('saves in the Timeline (version 9) and opens again; an old file opens with empty rows', () => {
    showTimeline.addStageClip('screenfx', 0, { duration: 4, screenFx: fx('beat-pulse', { decay: 0.3 }) });
    showTimeline.addStageClip('effects', 2, { duration: 3, effect: { id: 'e', type: 'invert', enabled: true, params: { invertAmount: 1 }, opacity: 0.7 } as unknown as Effect });
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    expect(saved.version).toBe(9);
    expect(saved.timeline.version).toBe(9);
    expect(saved.timeline.stageClips).toHaveLength(2);
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    showTimeline.activateDoc('timeline', { quiet: true });
    const s = get(showTimeline);
    expect(s.stageClips.map((c) => c.row).sort()).toEqual(['effects', 'screenfx']);
    expect(s.stageClips.find((c) => c.row === 'screenfx')!.screenFx!.params.decay).toBe(0.3);
    expect(s.stageClips.find((c) => c.row === 'effects')!.effect!.opacity).toBe(0.7);
    const old = { ...saved, version: 8, timeline: { ...saved.timeline, version: 8, stageClips: undefined } };
    showTimeline._resetForTest();
    showTimeline.hydrate(old);
    showTimeline.activateDoc('timeline', { quiet: true });
    expect(get(showTimeline).stageClips).toEqual([]);
    // unreadable blocks are dropped, never thrown
    expect(normalizeStageClips([{ row: 'screenfx', screenFx: { type: 'nope' } }, null, { row: 'effects' }])).toEqual([]);
  });

  it('block lines show under the Stage row', () => {
    const l = (id: string, target: any): ControlLine => ({ id, target, key: 'k', kind: 'continuous', min: 0, max: 1, points: [] });
    const lines = [l('a', { scope: 'block', id: 'sfx1' }), l('b', { scope: 'block', id: 'piece-block' }), l('c', { scope: 'stage' })];
    expect(linesForStage(lines, new Set(['sfx1'])).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('the line registry knows the blocks (Screen FX settings + where, Effects settings)', () => {
    const id = showTimeline.addStageClip('screenfx', 0, { duration: 4, screenFx: fx('linear-sweep'), where: { order: 'left-right', motion: { kind: 'sweep', bars: 1 }, members: 'pieces' } as any })!;
    const src = timelineRegistrySource();
    const keys = paramsFor(src, { scope: 'block', id }).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['sfx:param:speed', 'sfx:param:angle', 'where:position', 'where:spread']));
    expect(readParam(src, { scope: 'block', id }, 'sfx:param:bandWidth')).toBe(0.3);
  });
});

describe('the runtime takes over from the project Screen FX', () => {
  let stop: (() => void) | null = null;
  beforeEach(() => {
    showTimeline._resetForTest();
    _resetStageFxRuntime();
    setShowCompositionLoader(() => {});
    (project as any).set({ layers, wledControllers: [], mappingComposition: null });
    showTimeline.activateDoc('timeline', { quiet: true });
    stop = installStageFxRuntime();
  });
  afterEach(() => {
    stop?.();
    showTimeline._resetForTest();
  });

  it('drives while the Timeline is active and open (or playing); the project automation is suspended only then', async () => {
    showTimeline.setOpen(true);
    showTimeline.addStageClip('screenfx', 1, { duration: 2, screenFx: fx('strobe', { rate: 2, duty: 0.5 }) });
    showTimeline.addStageClip('effects', 1, { duration: 2, effect: { id: 'e', type: 'invert', enabled: true, params: {}, opacity: 1 } as unknown as Effect });
    showTimeline.addStageClip('screenfx', 8, { duration: 1, screenFx: fx('breathing') });
    showTimeline.seek(1.4);
    expect(stageRowsDrive(get(showTimeline))).toBe(true);
    expect(timelineScreenFxFor('Left')!.brightness).toBe(0);
    expect(timelineScreenFxFor('showsub::Left::r')!.brightness).toBe(0);
    expect(timelineCompositionEffects()).toHaveLength(1);
    showTimeline.seek(4);
    expect(timelineScreenFx()).not.toBeNull(); // between blocks: the Timeline still owns Screen FX (none showing)
    expect(timelineScreenFxFor('Left')!.brightness).toBe(1);
    expect(timelineCompositionEffects()).toHaveLength(0);
    // closed and stopped: the project's own Screen FX and automation resume
    showTimeline.setOpen(false);
    await Promise.resolve();
    expect(timelineScreenFx()).toBeNull();
    // the Show tab: never
    showTimeline.setOpen(true);
    await Promise.resolve();
    expect(timelineScreenFx()).not.toBeNull();
    showTimeline.activateDoc('show', { quiet: true });
    await Promise.resolve();
    expect(timelineScreenFx()).toBeNull();
  });

  it('an empty Screen FX row leaves the project to its own Screen FX', () => {
    showTimeline.setOpen(true);
    showTimeline.addStageClip('effects', 0, { duration: 2, effect: { id: 'e', type: 'invert', enabled: true, params: {}, opacity: 1 } as unknown as Effect });
    showTimeline.seek(1);
    expect(timelineScreenFx()).toBeNull();
    expect(timelineCompositionEffects()).toHaveLength(1);
  });
});

describe('score the song', () => {
  const stage: ScoreStage = { pieces: [{ id: 'L', name: 'Left' }, { id: 'R', name: 'Right' }], ledRows: [], stageFx: [], ledControllers: [] };
  const tempo = createTempoMap(120, 0);
  const structure = {
    bars: Array.from({ length: 40 }, (_, i) => i * 2),
    barEnergy: [],
    sections: [
      { start: 0, end: 16, kind: 'intro', energy: 0.3, name: 'Intro' },
      { start: 16, end: 32, kind: 'build', energy: 0.6, name: 'Build 1' },
      { start: 32, end: 48, kind: 'drop', energy: 0.95, name: 'Drop 1' },
      { start: 48, end: 64, kind: 'breakdown', energy: 0.3, name: 'Breakdown' },
      { start: 64, end: 80, kind: 'outro', energy: 0.2, name: 'Outro' },
    ],
  } as any;
  const empty = { sections: [], lookClips: [], lines: [], ledClips: [], stageClips: [] };

  it('a Screen FX per section: beat pulse on drops, sweep on builds, breathing in breakdowns; cut on section starts', () => {
    const d = draftScore(structure, tempo, stage, empty, 3, sequentialIds('t'));
    expect(d.stageClips.map((c) => c.screenFx!.type)).toEqual(['breathing', 'linear-sweep', 'beat-pulse', 'breathing', 'breathing']);
    expect(d.stageClips.map((c) => c.startTime)).toEqual([0, 16, 32, 48, 64]);
    // a sweep pass per bar (2 s): speed 1
    expect(d.stageClips[1].screenFx!.params.speed).toBe(1);
    expect(d.adds.some((a) => a.includes('Screen FX'))).toBe(true);
    // the draft blocks are what the store keeps (so Shuffle recognises them)
    for (const c of d.stageClips) expect(normalizeStageClip(c)).toEqual(c);
  });

  it('only into an empty Screen FX row; seeded and undoable as one step', () => {
    const busy = { ...empty, stageClips: [sfxClip('x', 10, 4, fx('strobe'))] };
    const d = draftScore(structure, tempo, stage, busy, 3);
    expect(d.stageClips).toEqual([]);
    expect(d.skips.some((s) => s.startsWith('Screen FX row'))).toBe(true);
    expect(draftScore(structure, tempo, { ...stage, pieces: [] }, empty, 3).stageClips).toEqual([]);
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    showTimeline.activateDoc('timeline', { quiet: true });
    const draft = draftScore(structure, tempo, stage, empty, 3);
    const before = showTimeline.exportArrangement();
    showTimeline.replaceTimelineParts({ stageClips: draft.stageClips, lookClips: draft.lookClips });
    expect(get(showTimeline).stageClips).toHaveLength(5);
    showTimeline.restoreArrangement(before);
    expect(get(showTimeline).stageClips).toEqual([]);
    showTimeline._resetForTest();
  });
});
