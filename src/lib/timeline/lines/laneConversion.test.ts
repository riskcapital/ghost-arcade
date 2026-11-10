/**
 * The Timeline document owns its control lines: the step-1 ◆ lanes become
 * lines on load (same keys, times, values and easings), lines save and
 * reload with the Timeline, follow the blocks they belong to, count toward
 * the length, and are undone with the rest of the document.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { KeyframeTrack, Layer, ShowLayerClip, ShowLayerTrack } from '../../types';
import { showTimeline, setShowCompositionLoader, type ShowArrangement } from '../../stores/showTimeline';
import { rowTrackId } from '../../show/tracks/showStageRows';
import { setHistoryCallback } from '../../stores/historyHooks';
import { curveForEasing, fitLineRanges, lanesToLines, laneToLine, rowLineTarget } from './laneConversion';
import { removeLinesForBlocks, shiftLinesWithBlock, linesEnd } from './lineDocOps';
import { lineValueAt } from './lineEvaluator';
import type { ControlLine } from './lineModel';

const numLane = (key: string, keys: Array<[number, number, string?]>): KeyframeTrack => ({
  key, label: key, type: 'number', keyframes: keys.map(([time, value, easing]) => ({ time, value, easing: (easing ?? 'linear') as any })), boolKeyframes: [],
});
const boolLane = (key: string, keys: Array<[number, boolean]>): KeyframeTrack => ({
  key, label: key, type: 'boolean', keyframes: [], boolKeyframes: keys.map(([time, value]) => ({ time, value })),
});
function track(over: Partial<ShowLayerTrack>): ShowLayerTrack {
  return { id: 'T', layerId: 'A', layerName: 'A', clips: [], lanes: [], collapsed: false, muted: false, locked: false, gap: 'hide', template: null, ...over } as ShowLayerTrack;
}
function layer(id: string): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null } as unknown as Layer;
}
const clip = (id: string, startTime: number, duration: number): ShowLayerClip => ({
  id, startTime, duration, media: { kind: 'image', name: 'a.png', src: '/a.png' }, inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0,
});

describe('◆ lanes become lines', () => {
  it('keeps keys, times, values; easing becomes the curve; step holds', () => {
    const l = laneToLine(numLane('shader:speed', [[1, 2, 'ease-in'], [3, 5, 'step'], [4, 0.5]]), { scope: 'layer', id: 'A' }, 'x')!;
    expect(l.points).toEqual([{ t: 1, v: 2, c: 'ease-in' }, { t: 3, v: 5, c: 'hold' }, { t: 4, v: 0.5 }]);
    expect(l.min).toBe(0);
    expect(l.max).toBe(5);
    expect(lineValueAt(l, 3.5)).toBe(5);
    expect(curveForEasing('linear')).toBeUndefined();
    const b = laneToLine(boolLane('layer:visible', [[0, true], [2, false]]), { scope: 'layer', id: 'A' }, 'y')!;
    expect(b.kind).toBe('bool');
    expect(lineValueAt(b, 1)).toBe(true);
    expect(lineValueAt(b, 2.5)).toBe(false);
  });

  it('a piece row targets the piece, an added layer its own copy; lanes are emptied; a line already there wins', () => {
    const piece = track({ id: 'row:A', lanes: [numLane('layer:opacity', [[0, 0], [2, 1]])] });
    const sub = track({ id: 'S1', subRow: true, lanes: [numLane('layer:opacity', [[1, 0.3]])] });
    const existing: ControlLine = { id: 'mine', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }] };
    const out = lanesToLines([piece, sub], [existing]);
    expect(out.tracks.every((t) => t.lanes.length === 0)).toBe(true);
    expect(out.lines.map((l) => l.target)).toEqual([{ scope: 'layer', id: 'showsub::A::S1' }]);
    expect(rowLineTarget(piece)).toEqual({ scope: 'layer', id: 'A' });
    const fresh = lanesToLines([piece, sub]);
    expect(fresh.lines.map((l) => l.id)).toEqual(['lane:row:A:layer:opacity', 'lane:S1:layer:opacity']);
  });

  it('fits a line to its parameter once the registry knows it', () => {
    const l: ControlLine = { id: 'x', target: { scope: 'layer', id: 'A' }, key: 'shader:speed', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 0.5 }] };
    const out = fitLineRanges([l], () => ({ key: 'shader:speed', label: 'Speed', group: 'Shader', min: 0, max: 10, step: 0.1, default: 1, kind: 'continuous' }));
    expect(out[0].max).toBe(10);
    expect(fitLineRanges(out, () => ({ key: 'shader:speed', label: 'Speed', group: 'Shader', min: 0, max: 10, step: 0.1, default: 1, kind: 'continuous' }))).toBe(out);
  });
});

describe('lines follow their blocks', () => {
  const blockLine: ControlLine = { id: 'b', target: { scope: 'block', id: 'c1' }, key: 'shader:x', kind: 'continuous', min: 0, max: 1, points: [{ t: 2, v: 0 }, { t: 4, v: 1 }] };
  const rowLine: ControlLine = { id: 'r', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 1, v: 0 }, { t: 3, v: 1 }, { t: 9, v: 0 }] };
  it('a moved block carries its lines whole and the row points under it', () => {
    const out = shiftLinesWithBlock([blockLine, rowLine], { clipId: 'c1', rowTarget: { scope: 'layer', id: 'A' }, from: 2, to: 5, delta: 1 });
    expect(out[0].points.map((p) => p.t)).toEqual([3, 5]);
    expect(out[1].points.map((p) => p.t)).toEqual([1, 4, 9]);
    expect(removeLinesForBlocks(out, ['c1']).map((l) => l.id)).toEqual(['r']);
    expect(linesEnd(out)).toBe(9);
  });
});

describe('the Timeline document holds its lines', () => {
  let steps = 0;
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    steps = 0;
    setHistoryCallback(() => { steps++; });
    showTimeline.openDoc('timeline');
    showTimeline.syncStageRows([layer('A')], []);
  });
  afterEach(() => {
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  const opacity = (points: ControlLine['points']): ControlLine => ({ id: 'op', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points });

  it('an edit is one undo step; lines count toward the length; undo puts them back', () => {
    const before = showTimeline.exportArrangement();
    showTimeline.setLines([opacity([{ t: 0, v: 0 }, { t: 12, v: 1 }])]);
    expect(steps).toBe(1);
    expect(get(showTimeline).duration).toBe(12);
    showTimeline.restoreArrangement(before as ShowArrangement);
    expect(get(showTimeline).lines).toEqual([]);
  });

  it('saves with the Timeline (version 5) and reopens', () => {
    showTimeline.setLines([opacity([{ t: 0, v: 0 }, { t: 2, v: 1, c: 'smooth' }])]);
    showTimeline.setLineBindings([{ id: 'b1', source: { kind: 'midi', channel: 0, cc: 21 }, target: { scope: 'layer', id: 'A' }, key: 'layer:opacity' }]);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    expect(saved.version).toBe(7);
    expect(saved.timeline.lines).toHaveLength(1);
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    expect(showTimeline.activeDoc()).toBe('timeline');
    const s = get(showTimeline);
    expect(s.lines[0].points[1]).toEqual({ t: 2, v: 1, c: 'smooth' });
    expect(s.lineBindings[0].source).toEqual({ kind: 'midi', channel: 0, cc: 21 });
  });

  it('opens an old Timeline whose rows had ◆ lanes as lines (same keys), the rows without lanes', () => {
    const old = {
      version: 4, isOpen: true, loop: false, zoom: 12, snapEnabled: true, audioTracks: [], presetClips: [], activeDoc: 'timeline',
      timeline: {
        version: 4, isOpen: false, loop: false, zoom: 12, snapEnabled: true, audioTracks: [], presetClips: [],
        layerTracks: [{ ...track({ id: rowTrackId('A'), clips: [clip('c1', 0, 4)], lanes: [numLane('layer:opacity', [[0, 0.2], [4, 0.8]])] }) }],
      },
    };
    showTimeline._resetForTest();
    showTimeline.hydrate(old);
    const s = get(showTimeline);
    expect(s.layerTracks.every((t) => t.lanes.length === 0)).toBe(true);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].key).toBe('layer:opacity');
    expect(s.lines[0].target).toEqual({ scope: 'layer', id: 'A' });
    expect(lineValueAt(s.lines[0], 2)).toBeCloseTo(0.5);
  });

  it('moving a block moves its lines in the same step; deleting it deletes them', () => {
    const id = showTimeline.addLayerClip(rowTrackId('A'), { kind: 'image', name: 'a.png', src: '/a.png' }, 2)!;
    const c = get(showTimeline).layerTracks.find((t) => t.layerId === 'A')!.clips[0];
    showTimeline.setLines([{ id: 'b', target: { scope: 'block', id }, key: 'shader:x', kind: 'continuous', min: 0, max: 1, points: [{ t: c.startTime + 1, v: 1 }] }]);
    showTimeline.setSnapEnabled(false);
    showTimeline.moveLayerClip(id, c.startTime + 3);
    expect(get(showTimeline).lines[0].points[0].t).toBeCloseTo(c.startTime + 4);
    showTimeline.removeLayerClips([id]);
    expect(get(showTimeline).lines).toEqual([]);
  });
});
