/**
 * The control lines' extension points: a scope (things a line drives) and a
 * line source (things a line follows) registered at runtime are listed,
 * evaluated, applied and unregistered; scopes and sources a build does not
 * know survive a load and save untouched; the sound rows' scope and the Beat
 * LFO run on the same mechanism.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  isLiveOnlyExtSource,
  lineSource,
  paramScope,
  registerLineSource,
  registerParamScope,
  stageScopeTargets,
  type ParamScopeDef,
} from './lineExtensions';
import { findParam, paramsFor, readParam, sameTarget, targetId, type ParamEntry, type ParamTarget, type RegistrySource } from './paramRegistry';
import { normalizeLines, type ControlLine, type FollowSource } from './lineModel';
import { normalizeBindings } from './lineDocOps';
import { createLineEvaluator, lineValueAt } from './lineEvaluator';
import { clearLineFrame, currentLineFrame, lineScopeValues, publishLineFrame } from './lineRuntime';
import { computeLineLayout, followChoiceId, followChoices, followLabel, frameValue, linesForStage, STAGE_GROUP } from '../../components/show/timeline/lineUi';
import { soundLineScope } from '../sound/soundParams';
import { defaultSoundRow } from '../sound/soundModel';
import { showTimeline, setShowCompositionLoader } from '../../stores/showTimeline';
import { setHistoryCallback } from '../../stores/historyHooks';

const SRC: RegistrySource = { layers: [] };
const knob = (key: string, label: string, def = 0.5): ParamEntry => ({ key, label, group: 'Voice', min: 0, max: 1, step: 0.01, default: def, kind: 'continuous' });

/** A stand-in for a later feature: two studio voices with a cutoff each. */
function studioScope(apply?: ParamScopeDef['apply']): ParamScopeDef {
  const stored: Record<string, number> = { lead: 0.25, pad: 0.75 };
  return {
    scope: 'test.voice',
    label: 'Test voices',
    targets: () => [{ id: 'lead', label: 'Lead' }, { id: 'pad', label: 'Pad' }],
    params: (id) => (id && id in stored ? [knob('voice:cutoff', 'Cutoff', stored[id])] : []),
    read: (id, key) => (id && key === 'voice:cutoff' ? stored[id] : undefined),
    apply,
  };
}

const line = (over: Partial<ControlLine> & Pick<ControlLine, 'id' | 'target' | 'key'>): ControlLine => ({ kind: 'continuous', min: 0, max: 1, points: [], ...over });

const offs: Array<() => void> = [];
afterEach(() => {
  while (offs.length) offs.pop()!();
  clearLineFrame();
});

describe('a registered scope', () => {
  it('is in the registry while registered: entries, labels, stored values, picker targets; gone after unregister', () => {
    const off = registerParamScope(studioScope());
    const lead: ParamTarget = { scope: 'test.voice', id: 'lead' };
    expect(paramsFor(SRC, lead).map((p) => p.key)).toEqual(['voice:cutoff']);
    expect(findParam(SRC, lead, 'voice:cutoff')).toMatchObject({ label: 'Cutoff', group: 'Voice', default: 0.25 });
    expect(readParam(SRC, lead, 'voice:cutoff')).toBe(0.25);
    expect(readParam(SRC, { scope: 'test.voice', id: 'pad' }, 'voice:cutoff')).toBe(0.75);
    expect(targetId(lead)).toBe('test.voice:lead');
    expect(sameTarget(lead, { scope: 'test.voice', id: 'lead' })).toBe(true);
    expect(sameTarget(lead, { scope: 'test.voice', id: 'pad' })).toBe(false);
    expect(stageScopeTargets()).toEqual([
      { target: { scope: 'test.voice', id: 'lead' }, label: 'Test voices: Lead' },
      { target: { scope: 'test.voice', id: 'pad' }, label: 'Test voices: Pad' },
    ]);
    off();
    expect(paramScope('test.voice')).toBeUndefined();
    expect(paramsFor(SRC, lead)).toEqual([]);
    expect(readParam(SRC, lead, 'voice:cutoff')).toBeUndefined();
    expect(stageScopeTargets()).toEqual([]);
  });

  it('a scope without targets is one target; built-in scopes cannot be registered; a stale unregister does nothing', () => {
    const def: ParamScopeDef = { scope: 'test.room', label: 'Room', params: () => [knob('room:haze', 'Haze')] };
    offs.push(registerParamScope(def));
    expect(stageScopeTargets()).toEqual([{ target: { scope: 'test.room' }, label: 'Room' }]);
    expect(paramsFor(SRC, { scope: 'test.room' }).map((p) => p.key)).toEqual(['room:haze']);
    expect(targetId({ scope: 'test.room' })).toBe('test.room');
    for (const scope of ['layer', 'stage', 'led', 'block', 'look']) expect(() => registerParamScope({ ...def, scope })).toThrow();
    // Registered again: the newest wins; unregistering it brings back the one before.
    const first = registerParamScope({ ...def, label: 'Room 1' });
    const second = registerParamScope({ ...def, label: 'Room 2' });
    expect(paramScope('test.room')?.label).toBe('Room 2');
    second();
    expect(paramScope('test.room')?.label).toBe('Room 1');
    first();
    expect(paramScope('test.room')).toBe(def);
  });

  it('lines on it evaluate by target id; apply gets the values when they change (and null when they stop)', () => {
    const apply = vi.fn();
    offs.push(registerParamScope(studioScope(apply)));
    const lines = [
      line({ id: 'a', target: { scope: 'test.voice', id: 'lead' }, key: 'voice:cutoff', points: [{ t: 0, v: 0 }, { t: 10, v: 1 }] }),
      line({ id: 'b', target: { scope: 'test.voice', id: 'pad' }, key: 'voice:cutoff', points: [{ t: 0, v: 0.5 }] }),
    ];
    const ev = createLineEvaluator();
    publishLineFrame(ev.evaluate(lines, 2.5));
    expect(apply).toHaveBeenCalledTimes(1);
    const values = apply.mock.calls[0][0] as Map<string, Record<string, number>>;
    expect(values.get('lead')!['voice:cutoff']).toBeCloseTo(0.25, 6);
    expect(values.get('pad')!['voice:cutoff']).toBe(0.5);
    expect(lineScopeValues('test.voice', 'lead')!['voice:cutoff']).toBeCloseTo(0.25, 6);
    expect(frameValue(currentLineFrame(), lines[0])).toBeCloseTo(0.25, 6);
    // Same values: not applied again; new values: applied.
    publishLineFrame(ev.evaluate(lines, 2.5));
    expect(apply).toHaveBeenCalledTimes(1);
    publishLineFrame(ev.evaluate(lines, 5));
    expect(apply).toHaveBeenCalledTimes(2);
    expect((apply.mock.calls[1][0] as Map<string, Record<string, number>>).get('lead')!['voice:cutoff']).toBeCloseTo(0.5, 6);
    // Scrubbing back gives what playing gave.
    publishLineFrame(ev.evaluate(lines, 2.5));
    expect((apply.mock.calls[2][0] as Map<string, Record<string, number>>).get('lead')!['voice:cutoff']).toBeCloseTo(0.25, 6);
    clearLineFrame();
    expect(apply).toHaveBeenLastCalledWith(null);
    expect(lineScopeValues('test.voice')).toBeNull();
  });

  it('a scope registered while lines drive it gets their values at once; a throwing apply never stops the frame', () => {
    const lines = [line({ id: 'a', target: { scope: 'test.voice', id: 'lead' }, key: 'voice:cutoff', points: [{ t: 0, v: 0.8 }] })];
    publishLineFrame(createLineEvaluator().evaluate(lines, 1));
    const apply = vi.fn();
    offs.push(registerParamScope(studioScope(apply)));
    expect(apply).toHaveBeenCalledTimes(1);
    expect((apply.mock.calls[0][0] as Map<string, Record<string, number>>).get('lead')!['voice:cutoff']).toBeCloseTo(0.8, 6);
    offs.push(registerParamScope({ ...studioScope(() => { throw new Error('boom'); }), scope: 'test.bad' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = [...lines, line({ id: 'c', target: { scope: 'test.bad', id: 'lead' }, key: 'voice:cutoff', points: [{ t: 0, v: 0.1 }] })];
    expect(() => publishLineFrame(createLineEvaluator().evaluate(bad, 1))).not.toThrow();
    expect(currentLineFrame()?.scopes?.get('test.bad')?.get('lead')?.['voice:cutoff']).toBeCloseTo(0.1, 6);
    warn.mockRestore();
  });

  it('its lines show under the Stage row; the sound rows (own rows) stay out of the Stage picker', () => {
    offs.push(registerParamScope(studioScope()));
    const row = defaultSoundRow(0);
    offs.push(registerParamScope(soundLineScope(() => [row])));
    const ext = line({ id: 'x', target: { scope: 'test.voice', id: 'lead' }, key: 'voice:cutoff', points: [{ t: 0, v: 1 }] });
    const sound = line({ id: 's', target: { scope: 'sound', id: row.id }, key: 'sound:volume', points: [{ t: 0, v: 1 }] });
    const unknown = line({ id: 'u', target: { scope: 'later.thing', id: 'q' } as ParamTarget, key: 'k', points: [{ t: 0, v: 1 }] });
    expect(linesForStage([ext, sound, unknown]).map((l) => l.id)).toEqual(['x']);
    expect(computeLineLayout([], [ext, sound, unknown], new Set()).lines.get(STAGE_GROUP)?.map((l) => l.id)).toEqual(['x']);
    expect(stageScopeTargets().map((t) => t.target.scope)).toEqual(['test.voice', 'test.voice']);
  });
});

describe('a registered line source', () => {
  it('offline (sample): a line follows it, scrub = play = export; unregistered, the line rests on its base', () => {
    const sample = vi.fn((t: number, source: FollowSource) => ((source as { gain?: number }).gain ?? 1) * ((t % 4) / 4));
    const off = registerLineSource({ kind: 'test.ramp', label: 'Test ramp', sample });
    const l = line({ id: 'f', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', follow: { source: { kind: 'test.ramp', gain: 0.5 }, depth: 1, base: 0 } });
    expect(isLiveOnlyExtSource('test.ramp')).toBe(false);
    expect(lineValueAt(l, 2)).toBeCloseTo(0.25, 6);
    const ev = createLineEvaluator();
    const played = [0, 1, 2, 3].map((t) => ev.evaluate([l], t).layers.get('A')!['layer:opacity']);
    const scrubbed = [3, 0, 2, 1].map((t) => ({ t, v: createLineEvaluator().evaluate([l], t).layers.get('A')!['layer:opacity'] }));
    for (const { t, v } of scrubbed) expect(v).toBe(played[t]);
    // An export (live inputs off) still follows an offline source.
    expect(lineValueAt(l, 3, { liveInputs: false })).toBeCloseTo(0.375, 6);
    expect(sample).toHaveBeenCalledWith(3, { kind: 'test.ramp', gain: 0.5 }, expect.anything(), 0);
    off();
    expect(lineSource('test.ramp')).toBeUndefined();
    expect(lineValueAt(l, 2)).toBe(0);
  });

  it('live-only (live): drives the line live, adds nothing to an export, gets the line smoothing; a throwing source is no value', () => {
    let now = 0.8;
    offs.push(registerLineSource({ kind: 'test.touch', label: 'Touch', live: () => now }));
    expect(isLiveOnlyExtSource('test.touch')).toBe(true);
    const l = line({ id: 't', target: { scope: 'stage' }, key: 'stage:fx:x:opacity', points: [{ t: 0, v: 0.1 }], follow: { source: { kind: 'test.touch' }, depth: 0.5 } });
    expect(lineValueAt(l, 1)).toBeCloseTo(0.1 + 0.5 * 0.8, 6);
    expect(lineValueAt(l, 1, { liveInputs: false })).toBeCloseTo(0.1, 6);
    const smooth = { ...l, follow: { ...l.follow!, smooth: 1 } };
    const ev = createLineEvaluator();
    now = 0;
    ev.evaluate([smooth], 0, { dt: 1 / 60 });
    now = 1;
    const v = ev.evaluate([smooth], 1 / 60, { dt: 1 / 60 }).stage!['stage:fx:x:opacity'] as number;
    expect(v).toBeGreaterThan(0.1);
    expect(v).toBeLessThan(0.15);
    offs.push(registerLineSource({ kind: 'test.bad', label: 'Bad', live: () => { throw new Error('x'); } }));
    expect(lineValueAt({ ...l, follow: { ...l.follow!, source: { kind: 'test.bad' } } }, 1)).toBeCloseTo(0.1, 6);
    expect(() => registerLineSource({ kind: 'test.empty', label: 'Empty' })).toThrow();
  });

  it('the follows menu lists it (one entry per choice) after the built-in sources; its label names a line that follows it', () => {
    offs.push(registerLineSource({
      kind: 'test.signal',
      label: 'Studio signal',
      choices: () => [{ id: 'lead', label: 'Lead level', source: { voice: 'lead' } }, { id: 'pad', label: 'Pad level', source: { voice: 'pad' } }],
      sample: () => 0.5,
    }));
    offs.push(registerLineSource({ kind: 'test.plain', label: 'Plain source', sample: () => 1 }));
    const choices = followChoices();
    const ids = choices.map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(['none', 'audio:level']);
    expect(ids).toContain('beat');
    // The Beat LFO is registered too, but listed once (built in, with its own fields).
    expect(ids.filter((id) => id.startsWith('beat'))).toEqual(['beat']);
    const ext = choices.filter((c) => c.source && c.source.kind.startsWith('test.'));
    expect(ext.map((c) => [c.id, c.label, c.source])).toEqual([
      ['test.signal#lead', 'Lead level', { kind: 'test.signal', voice: 'lead' }],
      ['test.signal#pad', 'Pad level', { kind: 'test.signal', voice: 'pad' }],
      ['test.plain', 'Plain source', { kind: 'test.plain' }],
    ]);
    expect(followChoiceId({ kind: 'test.signal', voice: 'pad' })).toBe('test.signal#pad');
    expect(followLabel({ kind: 'test.signal', voice: 'pad' })).toBe('Pad level');
    expect(followLabel({ kind: 'test.plain' })).toBe('Plain source');
    expect(followLabel({ kind: 'beat', shape: 'sine', beats: 4 })).toBe('LFO 1 bar');
  });
});

describe('built-ins on the mechanism', () => {
  it('the Beat LFO is a registered offline source: it evaluates through the registry', () => {
    const def = lineSource('beat');
    expect(def?.sample).toBeTypeOf('function');
    const l = line({ id: 'b', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', follow: { source: { kind: 'beat', shape: 'saw', beats: 4 }, depth: 1, base: 0 } });
    // 120 BPM default grid: 2 quarters a second, a 4-quarter saw.
    expect(lineValueAt(l, 1)).toBeCloseTo(0.5, 6);
    expect(lineValueAt(l, 1, { liveInputs: false })).toBeCloseTo(0.5, 6);
    // Stood in for, the registry's def is what runs; unregistered, the built-in is back.
    const off = registerLineSource({ ...def!, sample: () => 0.25 });
    expect(lineValueAt(l, 1)).toBeCloseTo(0.25, 6);
    off();
    expect(lineSource('beat')).toBe(def);
    expect(lineValueAt(l, 1)).toBeCloseTo(0.5, 6);
  });

  it('the sound rows are a registered scope: lines on a row land in the frame under scope "sound" (and frame.sounds)', () => {
    const row = defaultSoundRow(0);
    offs.push(registerParamScope(soundLineScope(() => [row])));
    expect(paramsFor(SRC, { scope: 'sound', id: row.id }).map((p) => p.key)).toContain('sound:volume');
    const l = line({ id: 's', target: { scope: 'sound', id: row.id }, key: 'sound:volume', points: [{ t: 0, v: 0.3 }] });
    const frame = createLineEvaluator().evaluate([l], 0);
    expect(frame.scopes?.get('sound')?.get(row.id)?.['sound:volume']).toBeCloseTo(0.3, 6);
    expect(frame.sounds).toBe(frame.scopes?.get('sound'));
    publishLineFrame(frame);
    expect(currentLineFrame()?.sounds?.get(row.id)?.['sound:volume']).toBeCloseTo(0.3, 6);
    expect(lineScopeValues('sound', row.id)?.['sound:volume']).toBeCloseTo(0.3, 6);
  });
});

describe('saved files: what this build does not know survives', () => {
  const unknownScope = {
    id: 'u1', target: { scope: 'later.scene', id: 'n7', node: { path: ['a', 'b'] } }, key: 'scene:fog', kind: 'continuous', min: 0, max: 2,
    points: [{ t: 0, v: 0.5 }, { t: 4, v: 1.5, c: 'smooth' }], follow: null, label: 'Fog',
  };
  const unknownSource = {
    id: 'u2', target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [],
    follow: { source: { kind: 'later.touch', zone: 'z1', weights: [0.2, 0.8], opts: { decay: 0.3 } }, depth: 0.5, base: 0.2, smooth: 0.1 },
  };

  it('normalizeLines keeps unknown scopes and sources as written; bindings keep unknown targets', () => {
    const raw = JSON.parse(JSON.stringify([unknownScope, unknownSource]));
    const lines = normalizeLines(raw);
    expect(lines).toEqual([unknownScope, unknownSource]);
    // Copies, not the file's objects.
    expect(lines[0].target).not.toBe(raw[0].target);
    expect(JSON.parse(JSON.stringify(normalizeLines(JSON.parse(JSON.stringify(lines)))))).toEqual([unknownScope, unknownSource]);
    // Unknown and unregistered: no value from them, nothing thrown, no NaN.
    const frame = createLineEvaluator().evaluate(lines, 2);
    expect(frame.scopes?.get('later.scene')?.get('n7')?.['scene:fog']).toBeCloseTo(1, 1);
    expect(frame.layers.get('A')?.['layer:opacity']).toBe(0.2);
    // Junk still goes.
    expect(normalizeLines([{ id: 'j', key: 'k', target: { scope: 7 } }, { id: 'j2', key: 'k', target: { scope: 'x.y', id: 3 } }])).toEqual([]);
    const bindings = normalizeBindings([{ id: 'b', key: 'scene:fog', target: unknownScope.target, source: { kind: 'midi', cc: 3, channel: 0 } }]);
    expect(bindings[0].target).toEqual(unknownScope.target);
  });

  describe('through the Timeline document', () => {
    beforeEach(() => {
      showTimeline._resetForTest();
      setShowCompositionLoader(() => {});
      setHistoryCallback(() => {});
      showTimeline.openDoc('timeline');
    });
    afterEach(() => {
      setShowCompositionLoader(null);
      showTimeline._resetForTest();
    });

    it('a file with them opens and saves again untouched (lines and bindings)', () => {
      const known = { id: 'k1', target: { scope: 'stage' }, key: 'stage:fx:e1:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 1, v: 0.4 }], follow: null };
      const binding = { id: 'b1', key: 'scene:fog', target: unknownScope.target, source: { kind: 'midi', cc: 9, channel: 1 } };
      const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
      saved.timeline.lines = JSON.parse(JSON.stringify([known, unknownScope, unknownSource]));
      saved.timeline.lineBindings = JSON.parse(JSON.stringify([binding]));
      showTimeline._resetForTest();
      showTimeline.hydrate(saved);
      expect(showTimeline.activeDoc()).toBe('timeline');
      const again = JSON.parse(JSON.stringify(showTimeline.serialize()));
      expect(again.timeline.lines).toEqual([known, unknownScope, unknownSource]);
      expect(again.timeline.lineBindings).toEqual([binding]);
      expect(get(showTimeline).lines).toHaveLength(3);
    });
  });
});
