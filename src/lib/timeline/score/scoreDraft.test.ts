/**
 * Score the song's draft rules: a look per section from the right tier,
 * never the same look twice running, drops cut on the beat then every bar,
 * where motions per section type, an energy line on All looks, a stage line,
 * LED rows following the stage; seeded (same seed = same draft, Shuffle =
 * another); only empty rows filled, so scoring twice adds nothing; and the
 * whole draft goes in and comes out as one undo step.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createTempoMap } from '../../show/tempoMap';
import { analyzeSongFeatures } from '../lines/songFeatures';
import { detectSongStructure, type SongStructure } from './songStructure';
import { synthSong, SYNTH_DEFAULT } from './synthSong.testutil';
import { BUILD_LOOKS, CALM_LOOKS, DROP_LOOKS, draftIsEmpty, draftScore, lookTier, sequentialIds, type ScoreStage } from './scoreDraft';
import { ALL_LOOKS_ID } from '../lines/paramRegistry';
import { showTimeline, setShowCompositionLoader } from '../../stores/showTimeline';
import { evaluateShowLooks } from '../../show/tracks/showLooks';

const tempo = createTempoMap(120, 0);
let structure: SongStructure;
const stage: ScoreStage = {
  pieces: [{ id: 'L', name: 'Left' }, { id: 'M', name: 'Middle' }, { id: 'R', name: 'Right' }],
  ledRows: ['led:c1'],
  stageFx: [],
  ledControllers: [{ id: 'c1', name: 'Strip' }],
};
const empty = { sections: [], lookClips: [], lines: [], ledClips: [] };

beforeEach(() => {
  structure ??= detectSongStructure(analyzeSongFeatures(synthSong(SYNTH_DEFAULT), 22050), tempo, { origin: 0, start: 0, end: 120 });
});

describe('the draft', () => {
  it('names and colours the sections; all play through', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    expect(d.sections.map((s) => s.name)).toEqual(['Intro', 'Build 1', 'Drop 1', 'Breakdown', 'Build 2', 'Drop 2', 'Outro']);
    expect(d.sections.every((s) => s.action === 'through')).toBe(true);
    expect(new Set(d.sections.map((s) => s.color)).size).toBeGreaterThan(3);
  });

  it('a look per section from the tier that suits it; drops use the hardest looks; never the same look twice running', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    for (const p of d.plan) {
      for (const id of p.lookIds) expect(lookTier(p.kind, p.energy)).toContain(id);
      if (p.kind === 'drop') expect(DROP_LOOKS).toContain(p.lookIds[0]);
      if (p.kind === 'build') expect(BUILD_LOOKS).toContain(p.lookIds[0]);
      if (p.kind === 'intro' || p.kind === 'outro' || p.kind === 'breakdown') expect(CALM_LOOKS).toContain(p.lookIds[0]);
    }
    // Consecutive sections never share a look at their meeting point.
    const blocks = [...d.lookClips].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].lookId).not.toBe(blocks[i - 1].lookId);
  });

  it('cuts on section starts; a drop cuts on every beat of its first bar, then every bar', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    const sectionStarts = d.sections.map((s) => s.start);
    for (const t of sectionStarts) expect(d.lookClips.some((c) => Math.abs(c.startTime - t) < 1e-6)).toBe(true);
    const drop = d.sections.find((s) => s.name === 'Drop 1')!;
    const inDrop = d.lookClips.filter((c) => c.startTime >= drop.start - 1e-6 && c.startTime < drop.end - 1e-6);
    // 16 bars: 4 beat blocks in bar 1, then 15 bar blocks.
    expect(inDrop).toHaveLength(4 + 15);
    expect(inDrop.slice(0, 4).every((c) => Math.abs(c.duration - 0.5) < 1e-6)).toBe(true);
    expect(inDrop.slice(4).every((c) => Math.abs(c.duration - 2) < 1e-6)).toBe(true);
    // Blocks touch (cuts): no overlap, no gap, through the song.
    const sorted = [...d.lookClips].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startTime).toBeCloseTo(sorted[i - 1].startTime + sorted[i - 1].duration, 6);
  });

  it('where motions: sweep on builds, burst on drops, ping-pong in the breakdown; none with one piece', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    const motion = (name: string) => d.plan.find((p) => p.name === name)!.motion;
    expect(motion('Build 1')).toBe('sweep');
    expect(motion('Drop 1')).toBe('burst');
    expect(motion('Breakdown')).toBe('pingpong');
    expect(motion('Intro')).toBeNull();
    const single = draftScore(structure, tempo, { ...stage, pieces: [{ id: 'L', name: 'Left' }] }, empty, 1);
    expect(single.lookClips.every((c) => !c.where)).toBe(true);
  });

  it('an energy line on All looks: dim intro, ramp through the build, full on the drop, fading outro', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    const line = d.lines.find((l) => l.target.scope === 'look' && l.target.id === ALL_LOOKS_ID)!;
    expect(line.key).toBe('look:intensity');
    const at = (name: string) => line.points.filter((p) => { const s = d.sections.find((x) => x.name === name)!; return p.t >= s.start - 1e-6 && p.t < s.end; }).map((p) => p.v);
    const [buildA, buildB] = at('Build 1');
    expect(buildB).toBeGreaterThan(buildA);
    expect(Math.min(...at('Drop 1'))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...at('Intro'))).toBeLessThan(Math.min(...at('Drop 1')));
    expect(at('Outro')[1]).toBeLessThan(0.3);
    expect(line.follow?.source).toEqual({ kind: 'audio', feature: 'level' });
  });

  it('a stage line: the first Stage FX mix, else LED brightness; LED rows follow the stage', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    expect(d.lines.some((l) => l.key === 'led:c1:brightness')).toBe(true);
    expect(d.ledClips).toHaveLength(1);
    expect(d.ledClips[0]).toMatchObject({ rowId: 'led:c1', kind: 'follow', startTime: 0 });
    const fx = draftScore(structure, tempo, { ...stage, stageFx: [{ id: 'fx1', name: 'Bloom' }] }, empty, 1);
    expect(fx.lines.some((l) => l.key === 'stage:fx:fx1:opacity')).toBe(true);
    expect(fx.lines.some((l) => l.key.startsWith('led:'))).toBe(false);
  });

  it('seeded: the same seed gives the same draft, another seed another one by the same rules', () => {
    const a = draftScore(structure, tempo, stage, empty, 42, sequentialIds('x'));
    const b = draftScore(structure, tempo, stage, empty, 42, sequentialIds('x'));
    expect(b).toEqual(a);
    const others = [1, 2, 3, 4, 5].map((seed) => draftScore(structure, tempo, stage, empty, seed, sequentialIds('x')));
    expect(others.some((o) => JSON.stringify(o.lookClips.map((c) => [c.lookId, c.paletteId])) !== JSON.stringify(a.lookClips.map((c) => [c.lookId, c.paletteId])))).toBe(true);
    for (const o of others) expect(o.lookClips.length).toBe(a.lookClips.length);
  });

  it('fills only empty rows: scoring again adds nothing; the Timeline\'s own sections are followed', () => {
    const first = draftScore(structure, tempo, stage, empty, 1);
    const again = draftScore(structure, tempo, stage, { sections: first.sections, lookClips: first.lookClips, lines: first.lines, ledClips: first.ledClips }, 2);
    expect(draftIsEmpty(again)).toBe(true);
    expect(again.skips.length).toBeGreaterThan(0);
    // Own sections, no looks yet: the draft uses them (kind from the song).
    const own = [{ id: 'mine', name: 'My part', color: '#ffffff', start: 32, end: 64, action: 'hold' as const }];
    const d = draftScore(structure, tempo, stage, { ...empty, sections: own }, 1);
    expect(d.sections).toEqual([]);
    expect(d.plan).toHaveLength(1);
    expect(d.plan[0].kind).toBe('drop');
  });
});

describe('in the Timeline', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    showTimeline.openDoc('timeline');
  });
  afterEach(() => showTimeline._resetForTest());

  it('goes in as one step and comes out with one undo; the look changes at every section boundary', () => {
    const d = draftScore(structure, tempo, stage, empty, 1);
    const before = showTimeline.exportArrangement();
    showTimeline.replaceTimelineParts({ tempo, sections: d.sections, lookClips: d.lookClips, lines: d.lines, ledClips: d.ledClips });
    const s = get(showTimeline);
    expect(s.sections).toHaveLength(7);
    expect(s.lookClips).toHaveLength(d.lookClips.length);
    expect(s.tempo?.segments[0].bpm).toBe(120);
    for (const sec of s.sections.slice(1)) {
      const before = evaluateShowLooks(s.lookClips, sec.start - 0.05).map((l) => l.lookId);
      const after = evaluateShowLooks(s.lookClips, sec.start + 0.05).map((l) => l.lookId);
      expect(after).not.toEqual(before);
    }
    showTimeline.restoreArrangement(before);
    const back = get(showTimeline);
    expect(back.sections).toEqual([]);
    expect(back.lookClips).toEqual([]);
    expect(back.lines).toEqual([]);
    expect(back.ledClips).toEqual([]);
  });
});
