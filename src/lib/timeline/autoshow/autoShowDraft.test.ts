/**
 * Auto show's draft: content on the pieces through the group orders, sets
 * swapping on the beat at a drop's start and then every bar, the cast small
 * and returning, never the same content twice running on a row nor on both
 * sets at once, one palette family, bounded block count, seeded, only where
 * the Timeline is empty, and in the store as one undo step.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowLayerTrack } from '../../types';
import { createTempoMap, secondsAtBeat } from '../../show/tempoMap';
import { analyzeSongFeatures } from '../lines/songFeatures';
import { detectSongStructure, type SongStructure } from '../score/songStructure';
import { sequentialIds } from '../score/scoreDraft';
import { evaluateWhere } from '../where/whereEval';
import { pieceSpots } from '../where/spatialOrder';
import { defaultBeatAt } from '../where/whereMotion';
import { showTimeline, setShowCompositionLoader } from '../../stores/showTimeline';
import { AUTO_ROW_NAMES, draftAutoShow, stripDrafts, withAutoRows, type AutoShowInput } from './autoShowDraft';
import { AUTO_SHOW_CATALOG } from './catalogData';
import { GROUP_ORDER_IDS } from './pieceGroups';
// @ts-expect-error plain JS shared with the Show Runner's fixtures
import { styleSong } from '../../../../scripts/show-runner/styleSongs.mjs';

function quad(id: string, x0: number, y0: number, x1: number, y1: number): Layer {
  return {
    id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null, layerShape: null,
    corners: { topLeft: { x: x0, y: 1 - y0 }, topRight: { x: x1, y: 1 - y0 }, bottomRight: { x: x1, y: 1 - y1 }, bottomLeft: { x: x0, y: 1 - y1 } },
  } as unknown as Layer;
}

/** A wall: cols × rows touching tiles around a big screen in the middle. */
function wall(cols: number, rows: number): Layer[] {
  const out: Layer[] = [quad('screen', 0.4, 0.35, 0.6, 0.65)];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = c / cols, y0 = r / rows, x1 = (c + 1) / cols, y1 = (r + 1) / rows;
    if (x1 > 0.4 && x0 < 0.6 && y1 > 0.35 && y0 < 0.65) continue;
    out.push(quad(`t${r}-${c}`, x0, y0, x1, y1));
  }
  return out;
}

const tempo = createTempoMap(128, 0);
const bar = 240 / 128;
let structure: SongStructure;
const layers = wall(12, 8);
const rowOf = (l: Layer): ShowLayerTrack => ({ id: `row:${l.id}`, layerId: l.id, layerName: l.name, template: null, clips: [], lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false });
const code = (file: string) => `/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); } // ${file}`;

function input(over: Partial<AutoShowInput> = {}): AutoShowInput {
  return {
    structure, tempo, style: 'driving',
    stage: { pieces: layers.map((l) => ({ id: l.id, name: l.name })), ledRows: [], stageFx: [], ledControllers: [], layers, aspect: 16 / 9 },
    existing: { sections: [], lookClips: [], lines: [], ledClips: [], stageClips: [], layerTracks: layers.map(rowOf), whereOrders: [] },
    catalog: AUTO_SHOW_CATALOG,
    shaderCode: code,
    seed: 7,
    ids: sequentialIds('t'),
    ...over,
  };
}

beforeAll(() => {
  const f = analyzeSongFeatures(styleSong('driving'), 22050);
  structure = detectSongStructure(f, tempo, { origin: 0, start: 0, end: f.duration });
});

describe('the Auto show draft', () => {
  it('adds the content rows on the hero piece, its groups as named orders, Score\'s sections and lines', () => {
    const d = draftAutoShow(input());
    expect(d.hostLayerId).toBe('screen');
    expect(d.layerTracks.map((t) => t.layerName)).toEqual([AUTO_ROW_NAMES.stage, AUTO_ROW_NAMES.a, AUTO_ROW_NAMES.b, AUTO_ROW_NAMES.hero]);
    expect(d.layerTracks.every((t) => t.subRow && t.layerId === 'screen')).toBe(true);
    expect(d.sections.map((s) => s.name)).toEqual(['Intro', 'Build 1', 'Drop 1', 'Breakdown', 'Build 2', 'Drop 2', 'Outro']);
    expect(d.whereOrders.map((o) => o.id)).toContain(GROUP_ORDER_IDS.sets);
    expect(d.lines.some((l) => l.key === 'look:intensity')).toBe(true);
    expect(d.heard).toMatchObject({ bpm: 128, style: 'Driving', sections: 7, pieces: layers.length });
    // Every content block is a where block on Auto show's own orders; the sets' blocks hold their pieces dark.
    const blocks = d.layerTracks.flatMap((t) => t.clips);
    expect(blocks.every((c) => c.where?.namedOrder?.startsWith('autoshow:'))).toBe(true);
    expect(blocks.filter((c) => c.where?.namedOrder === GROUP_ORDER_IDS.sets).every((c) => c.where?.dark)).toBe(true);
    expect(blocks.every((c) => c.media.kind === 'shader' && c.media.shaderCode)).toBe(true);
  });

  it('a small cast that returns: 4–8 contents, one palette family', () => {
    const d = draftAutoShow(input());
    expect(d.cast.length).toBeGreaterThanOrEqual(4);
    expect(d.cast.length).toBeLessThanOrEqual(8);
    const used = new Set(d.layerTracks.flatMap((t) => t.clips.map((c) => c.label)));
    expect(used.size).toBeLessThanOrEqual(8);
    expect(d.layerTracks.flatMap((t) => t.clips).length).toBeGreaterThan(used.size); // they return
    expect(['cool', 'acid', 'warm']).toContain(d.palette.mood);
  });

  it('never the same content twice running on a row, and the two sets never show the same content together', () => {
    const d = draftAutoShow(input());
    for (const t of d.layerTracks) {
      const sections = d.sections.map((s) => t.clips.filter((c) => c.startTime >= s.start - 1e-6 && c.startTime < s.end - 1e-6).map((c) => c.label));
      const firstOf = sections.map((labels) => labels[0] ?? null);
      for (let i = 1; i < firstOf.length; i++) if (firstOf[i] && firstOf[i - 1]) expect(firstOf[i]).not.toBe(firstOf[i - 1]);
    }
    const a = d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.a)!;
    const b = d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.b)!;
    for (const ca of a.clips) {
      const cb = b.clips.find((c) => Math.abs(c.startTime - ca.startTime) < 1e-6);
      expect(cb).toBeTruthy();
      expect(cb!.label).not.toBe(ca.label);
    }
  });

  it('tiles alternate on the beat at a drop\'s start, then every bar', () => {
    const d = draftAutoShow(input());
    const drop = d.sections.find((s) => s.name === 'Drop 1')!;
    const a = d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.a)!;
    const b = d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.b)!;
    const spots = pieceSpots(layers);
    const lit = (row: ShowLayerTrack, t: number) => {
      const c = row.clips.find((x) => t >= x.startTime && t < x.startTime + x.duration)!;
      const w = evaluateWhere({ spec: c.where!, named: d.whereOrders, spots, time: t, start: c.startTime, ctx: { beatAt: (x) => x * 128 / 60 } });
      return { label: c.label, set: [...w.weights].filter(([, v]) => v >= 0.99).map(([id]) => id).sort().join(',') };
    };
    const setA = d.groups.setA.slice().sort().join(',');
    const setB = d.groups.setB.slice().sort().join(',');
    const beat = bar / 4;
    // First bar: the set each content is on swaps every beat.
    const onA: string[] = [];
    for (let k = 0; k < 4; k++) {
      const t = drop.start + (k + 0.5) * beat;
      const x = lit(a, t);
      const y = lit(b, t);
      expect([x.set, y.set].sort()).toEqual([setA, setB].sort());
      onA.push(x.set === setA ? x.label! : y.label!);
    }
    expect(onA[0]).not.toBe(onA[1]);
    expect(onA[1]).not.toBe(onA[2]);
    expect(onA[0]).toBe(onA[2]);
    // Then every bar: steady through a bar, swapped in the next.
    const t1 = drop.start + 1.25 * bar;
    const t2 = drop.start + 1.75 * bar;
    const t3 = drop.start + 2.25 * bar;
    expect(lit(a, t1).set).toBe(lit(a, t2).set);
    expect(lit(a, t3).set).not.toBe(lit(a, t2).set);
  });

  it('intro reveals, build travels faster each phrase, breakdown lights few, outro drops out', () => {
    const d = draftAutoShow(input());
    const stage = d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.stage)!;
    const inSection = (name: string) => { const s = d.sections.find((x) => x.name === name)!; return stage.clips.filter((c) => c.startTime >= s.start - 1e-6 && c.startTime < s.end - 1e-6); };
    expect(inSection('Intro')[0].where?.motion).toMatchObject({ kind: 'reveal' });
    expect(inSection('Intro')[0].fadeIn).toBeGreaterThan(0);
    const build = inSection('Build 1');
    expect(build.length).toBeGreaterThan(1);
    const passes = build.map((c) => (c.where!.motion as { bars: number }).bars);
    for (let i = 1; i < passes.length; i++) expect(passes[i]).toBeLessThan(passes[i - 1]);
    const breakdown = inSection('Breakdown')[0];
    expect(breakdown.where).toMatchObject({ motion: { kind: 'drawn' }, spread: 0, dark: true });
    // The breakdown's dark pieces wear a catalog Look (another row than the lit one), on black.
    expect(d.lookClips).toHaveLength(1);
    expect(AUTO_SHOW_CATALOG.filter((c) => c.kind === 'look').map((c) => c.ref)).toContain(d.lookClips[0].lookId);
    expect(d.lookClips[0].startTime).toBeCloseTo(d.sections.find((x) => x.name === 'Breakdown')!.start, 5);
    expect(d.lookClips[0].where).toMatchObject({ namedOrder: breakdown.where!.namedOrder, motion: { kind: 'drawn' }, spread: 0 });
    expect(d.lookClips[0].where!.position).not.toBe(breakdown.where!.position);
    expect(inSection('Outro')[0].where?.motion).toMatchObject({ kind: 'reveal', reverse: true });
    expect(inSection('Outro')[0].fadeOut).toBeGreaterThan(0);
    // Screen FX: none in the breakdown; a riser in each build's last bar; invert hits in the drops (Driving: the first downbeat).
    const sfx = d.stageClips.filter((c) => c.row === 'screenfx');
    const bd = d.sections.find((s) => s.name === 'Breakdown')!;
    expect(sfx.some((c) => c.startTime >= bd.start - 1e-6 && c.startTime < bd.end - 1e-6)).toBe(false);
    expect(sfx.filter((c) => c.label === 'Riser')).toHaveLength(2);
    expect(d.stageClips.filter((c) => c.row === 'effects')).toHaveLength(2);
  });

  it('is the same for the same seed, another for another (Shuffle), with the same rules', () => {
    const a = draftAutoShow(input());
    const b = draftAutoShow(input({ ids: sequentialIds('t') }));
    expect(JSON.stringify(b.layerTracks)).toBe(JSON.stringify(a.layerTracks));
    const c = draftAutoShow(input({ seed: 8 }));
    expect(JSON.stringify(c.layerTracks.map((t) => t.clips.map((x) => x.label)))).not.toBe(JSON.stringify(a.layerTracks.map((t) => t.clips.map((x) => x.label))));
    expect(c.layerTracks.map((t) => t.layerName)).toEqual(a.layerTracks.map((t) => t.layerName));
  });

  it('styles change the cut: Chill swaps every 8 bars with no hits; Hard swaps every beat for two bars and hits every phrase', () => {
    const chill = draftAutoShow(input({ style: 'chill' }));
    const hard = draftAutoShow(input({ style: 'hard' }));
    const firstA = (d: typeof chill, name: string) => {
      const s = d.sections.find((x) => x.name === name)!;
      return d.layerTracks.find((t) => t.layerName === AUTO_ROW_NAMES.a)!.clips.filter((c) => c.startTime >= s.start - 1e-6 && c.startTime < s.end - 1e-6);
    };
    expect(firstA(chill, 'Drop 1')).toHaveLength(1);
    expect(firstA(hard, 'Drop 1')[0].duration).toBeCloseTo(2 * bar, 5);
    expect(chill.stageClips.filter((c) => c.row === 'effects')).toHaveLength(0);
    expect(hard.stageClips.filter((c) => c.row === 'effects').length).toBeGreaterThan(2);
    expect(['warm', 'cool', 'mono']).toContain(chill.palette.mood);
  });

  it('only where empty: pieces with their own blocks are left out, a busy Looks row is left alone, a second Auto show adds no content', () => {
    const tracks = layers.map(rowOf);
    tracks[3] = { ...tracks[3], clips: [{ id: 'own', startTime: 10, duration: 20, media: { kind: 'image', name: 'mine', src: '/m.png' }, inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0 }] };
    const d = draftAutoShow(input({ existing: { sections: [], lookClips: [{ id: 'l', lookId: 'neon-pulse', paletteId: 'neon', startTime: 0, duration: 30, scope: 'all', fadeIn: 0, fadeOut: 0 }], lines: [], ledClips: [], stageClips: [], layerTracks: tracks, whereOrders: [] } }));
    expect(d.groups.pieces.map((p) => p.id)).not.toContain(layers[3].id);
    expect(d.skips.some((s) => /blocks of their own/.test(s))).toBe(true);
    expect(d.lookClips).toHaveLength(0);
    expect(d.skips.some((s) => /Looks row/.test(s))).toBe(true);
    const again = draftAutoShow(input({ existing: { sections: [], lookClips: [], lines: [], ledClips: [], stageClips: [], layerTracks: withAutoRows(layers.map(rowOf), d.hostLayerId, d.layerTracks), whereOrders: d.whereOrders } }));
    expect(again.layerTracks).toHaveLength(0);
    expect(again.skips.some((s) => /earlier Auto show/.test(s))).toBe(true);
  });

  it('bounded: a 4-minute song on 150 pieces stays well under 400 blocks', () => {
    const big = wall(16, 11).slice(0, 150);
    const f = analyzeSongFeatures(styleSong('hard', 22050, { scale: 2.2 }), 22050);
    const t150 = createTempoMap(150, 0);
    const s = detectSongStructure(f, t150, { origin: 0, start: 0, end: f.duration });
    expect(f.duration).toBeGreaterThan(220);
    const d = draftAutoShow(input({
      structure: s, tempo: t150, style: 'hard',
      stage: { pieces: big.map((l) => ({ id: l.id, name: l.name })), ledRows: [], stageFx: [], ledControllers: [], layers: big, aspect: 16 / 9 },
      existing: { sections: [], lookClips: [], lines: [], ledClips: [], stageClips: [], layerTracks: big.map(rowOf), whereOrders: [] },
    }));
    expect(d.groups.pieces).toHaveLength(150);
    expect(d.blockCount).toBeLessThan(400);
    expect(d.blockCount).toBeGreaterThan(20);
  });
});

describe('in the Timeline', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    showTimeline.openDoc('timeline');
  });
  afterEach(() => showTimeline._resetForTest());

  it('goes in as one step after the hero\'s row and comes out with one undo; Shuffle takes out only what nobody touched', () => {
    const d = draftAutoShow(input());
    const tracks = layers.map(rowOf);
    showTimeline.replaceTimelineParts({ layerTracks: tracks });
    const before = showTimeline.exportArrangement();
    showTimeline.replaceTimelineParts({ tempo, sections: d.sections, lookClips: d.lookClips, lines: d.lines, ledClips: d.ledClips, stageClips: d.stageClips, layerTracks: withAutoRows(get(showTimeline).layerTracks, d.hostLayerId, d.layerTracks), whereOrders: d.whereOrders });
    const s = get(showTimeline);
    const hostAt = s.layerTracks.findIndex((t) => t.layerId === 'screen' && !t.subRow);
    expect(s.layerTracks.slice(hostAt + 1, hostAt + 5).map((t) => t.layerName)).toEqual([AUTO_ROW_NAMES.stage, AUTO_ROW_NAMES.a, AUTO_ROW_NAMES.b, AUTO_ROW_NAMES.hero]);
    expect(s.whereOrders.some((o) => o.id === GROUP_ORDER_IDS.sets && o.slots?.length === 2)).toBe(true);
    // An edit on one drafted block keeps it (and its row) through Shuffle.
    const edited = s.layerTracks[hostAt + 2].clips[0];
    showTimeline.updateLayerClip(edited.id, { opacity: 0.5 }, { discrete: true });
    const stripped = stripDrafts(get(showTimeline), [d]);
    expect(stripped.layerTracks.filter((t) => t.subRow)).toHaveLength(1);
    expect(stripped.layerTracks.find((t) => t.subRow)!.clips.map((c) => c.id)).toEqual([edited.id]);
    expect(stripped.sections).toEqual([]);
    expect(stripped.lookClips).toEqual([]);
    showTimeline.restoreArrangement(before);
    const back = get(showTimeline);
    expect(back.layerTracks.some((t) => t.subRow)).toBe(false);
    expect(back.sections).toEqual([]);
    expect(back.stageClips).toEqual([]);
    expect(back.whereOrders).toEqual([]);
  });
});
