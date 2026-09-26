/**
 * Cue list engine.
 *
 * Fake timers stand in for the wall clock, so a 20-minute show with real
 * waits runs in milliseconds and every fire time can be checked exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CueEngine,
  crossedTimes,
  followWaitMs,
  nextCueNumber,
  resolveFollowTarget,
  type Cue,
  type CueAction,
  type CueExecutor,
  type CueFollow,
  type CueValueTarget,
} from './cueList';

type Call = [string, ...unknown[]];

function recorder(values: Record<string, number> = {}, bpm = 120) {
  const calls: Call[] = [];
  const written: Record<string, number[]> = {};
  const key = (t: CueValueTarget) =>
    t.kind === 'macro' ? `macro:${t.macro}` : t.kind === 'layerOpacity' ? `layer:${t.layerId}` : `param:${t.path}`;
  const executor: CueExecutor = {
    recallPreset: (id) => calls.push(['preset', id]),
    recallSnapshot: (slot) => calls.push(['snapshot', slot]),
    triggerClip: (d, l, c) => calls.push(['clip', d, l, c]),
    triggerColumn: (d, c) => calls.push(['column', d, c]),
    stopAllClips: () => calls.push(['stopAll']),
    setBlackout: (on) => calls.push(['blackout', on]),
    readValue: (t) => values[key(t)] ?? null,
    writeValue: (t, v) => {
      values[key(t)] = v;
      (written[key(t)] ??= []).push(v);
    },
    timeline: (op, sec) => calls.push(['timeline', op, sec]),
    projector: (id, cmd, input) => calls.push(['projector', id, cmd, input]),
    bpm: () => bpm,
  };
  return { executor, calls, written, values };
}

function follow(patch: Partial<CueFollow>): CueFollow {
  return { mode: 'go', wait: 0, unit: 'seconds', target: 'next', jumpTo: null, ...patch };
}

let engine: CueEngine;

beforeEach(() => {
  vi.useFakeTimers();
  engine = new CueEngine();
  engine.setClock({
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  });
});

afterEach(() => {
  engine._resetForTest();
  vi.useRealTimers();
});

/** Omit that distributes over the action union. */
type ActionInit = CueAction extends unknown ? DistOmit<CueAction> : never;
type DistOmit<T> = T extends unknown ? Omit<T, 'id'> : never;

function action(a: ActionInit): CueAction {
  return { id: Math.random().toString(36).slice(2), ...a } as CueAction;
}

describe('pure helpers', () => {
  it('resolves follow targets', () => {
    const cues = [1, 2, 3].map((n) => ({ id: `c${n}`, number: String(n), name: '', actions: [], follow: follow({}), timecode: null })) as Cue[];
    expect(resolveFollowTarget(cues, cues[0])?.id).toBe('c2');
    expect(resolveFollowTarget(cues, cues[2])).toBeNull();
    expect(resolveFollowTarget(cues, { ...cues[2], follow: follow({ target: 'loop' }) })?.id).toBe('c1');
    expect(resolveFollowTarget(cues, { ...cues[0], follow: follow({ target: 'jump', jumpTo: 'c3' }) })?.id).toBe('c3');
    expect(resolveFollowTarget(cues, { ...cues[0], follow: follow({ target: 'jump', jumpTo: 'gone' }) })).toBeNull();
    expect(resolveFollowTarget(cues, { ...cues[0], follow: follow({ target: 'end' }) })).toBeNull();
  });

  it('converts beat waits at the tempo', () => {
    expect(followWaitMs(follow({ wait: 4, unit: 'beats' }), 120)).toBe(2000);
    expect(followWaitMs(follow({ wait: 8, unit: 'beats' }), 0)).toBe(4000);
    expect(followWaitMs(follow({ wait: 2.5 }), 90)).toBe(2500);
  });

  it('finds crossed times as half-open ranges, with loop wrap', () => {
    const ts = [0, 1, 2, 5, 9.5];
    expect(crossedTimes(ts, (t) => t, 0.5, 2)).toEqual([1, 2]);
    expect(crossedTimes(ts, (t) => t, 1, 1)).toEqual([]);
    expect(crossedTimes(ts, (t) => t, 3, 1)).toEqual([]);
    expect(crossedTimes(ts, (t) => t, 9, 1.5, 10)).toEqual([9.5, 0, 1]);
  });

  it('numbers new cues after, or between, their neighbours', () => {
    const mk = (n: string) => ({ number: n }) as Cue;
    expect(nextCueNumber([], 0)).toBe('1');
    expect(nextCueNumber([mk('1'), mk('2')], 2)).toBe('3');
    expect(nextCueNumber([mk('1'), mk('2')], 1)).toBe('1.5');
    expect(nextCueNumber([mk('1'), mk('5')], 1)).toBe('2');
  });
});

describe('GO, Back, Stop', () => {
  it('GO fires the standby cue and stands by on the next', () => {
    const { executor, calls } = recorder();
    engine.setExecutor(executor);
    const a = engine.addCue({ name: 'Open', actions: [action({ kind: 'preset', compositionId: 'comp-a' })] });
    const b = engine.addCue({ name: 'Two', actions: [action({ kind: 'snapshot', slot: 3 })] });
    expect(engine.state.standbyCueId).toBe(a);
    expect(engine.go()).toBe(a);
    expect(calls).toEqual([['preset', 'comp-a']]);
    expect(engine.state.currentCueId).toBe(a);
    expect(engine.state.standbyCueId).toBe(b);
    expect(engine.go()).toBe(b);
    expect(engine.state.standbyCueId).toBeNull();
    expect(engine.state.active).toBe(false);
    // End of the list: GO does nothing.
    expect(engine.go()).toBeNull();
    expect(calls).toEqual([['preset', 'comp-a'], ['snapshot', 3]]);
  });

  it('Back fires the cue above the current one', () => {
    const { executor, calls } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ actions: [action({ kind: 'blackout', on: true })] });
    engine.addCue({ actions: [action({ kind: 'blackout', on: false })] });
    engine.go();
    engine.go();
    engine.back();
    expect(calls.at(-1)).toEqual(['blackout', true]);
    expect(engine.state.history.map((h) => h.source)).toEqual(['go', 'go', 'back']);
  });

  it('Stop cancels a pending follow and GO resumes from standby', () => {
    const { executor, calls } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ follow: follow({ mode: 'auto', wait: 5 }) });
    const b = engine.addCue({ actions: [action({ kind: 'vjColumn', deck: 'B', column: 2 })] });
    engine.go();
    expect(engine.remainingMs()).toBe(5000);
    vi.advanceTimersByTime(2000);
    expect(engine.remainingMs()).toBe(3000);
    engine.stop();
    expect(engine.state.pendingFollow).toBeNull();
    expect(calls).toContainEqual(['timeline', 'pause', 0]);
    vi.advanceTimersByTime(10000);
    expect(engine.state.currentCueId).not.toBe(b);
    engine.go();
    expect(engine.state.currentCueId).toBe(b);
    expect(calls.at(-1)).toEqual(['column', 'B', 2]);
  });

  it('putting a cue on standby cancels the follow and GO fires it', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ follow: follow({ mode: 'auto', wait: 1 }) });
    engine.addCue();
    const c = engine.addCue();
    engine.go();
    engine.setStandby(c);
    vi.advanceTimersByTime(5000);
    expect(engine.state.history).toHaveLength(1);
    engine.go();
    expect(engine.state.currentCueId).toBe(c);
  });

  it('Reset stands by on the first cue', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    const a = engine.addCue();
    engine.addCue();
    engine.go();
    engine.go();
    engine.reset();
    expect(engine.state.currentCueId).toBeNull();
    expect(engine.state.standbyCueId).toBe(a);
  });
});

describe('follow actions', () => {
  it('auto-follows after seconds and after beats', () => {
    const { executor } = recorder({}, 100);
    engine.setExecutor(executor);
    const a = engine.addCue({ follow: follow({ mode: 'auto', wait: 3 }) });
    const b = engine.addCue({ follow: follow({ mode: 'auto', wait: 8, unit: 'beats' }) });
    const c = engine.addCue();
    engine.go();
    vi.advanceTimersByTime(2999);
    expect(engine.state.currentCueId).toBe(a);
    vi.advanceTimersByTime(1);
    expect(engine.state.currentCueId).toBe(b);
    // 8 beats at 100 bpm = 4.8 s.
    vi.advanceTimersByTime(4799);
    expect(engine.state.currentCueId).toBe(b);
    vi.advanceTimersByTime(1);
    expect(engine.state.currentCueId).toBe(c);
    expect(engine.state.history.map((h) => h.source)).toEqual(['go', 'follow', 'follow']);
  });

  it('jumps to a named cue, with GO or automatically', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    const a = engine.addCue();
    const b = engine.addCue();
    const c = engine.addCue();
    engine.updateFollow(a, { target: 'jump', jumpTo: c });
    engine.go();
    expect(engine.state.standbyCueId).toBe(c);
    engine.updateFollow(c, { mode: 'auto', wait: 1, target: 'jump', jumpTo: b });
    engine.go();
    vi.advanceTimersByTime(1000);
    expect(engine.state.currentCueId).toBe(b);
  });

  it('loops forever without recursion, even with zero waits', () => {
    const { executor, calls } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ actions: [action({ kind: 'snapshot', slot: 1 })], follow: follow({ mode: 'auto', wait: 0 }) });
    engine.addCue({ actions: [action({ kind: 'snapshot', slot: 2 })], follow: follow({ mode: 'auto', wait: 0, target: 'loop' }) });
    engine.go();
    // Zero waits still go through the timer, at the minimum hop.
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBeGreaterThan(50);
    expect(calls.length).toBeLessThanOrEqual(101);
    engine.stop();
    const n = calls.length;
    vi.advanceTimersByTime(1000);
    expect(calls.length).toBe(n);
  });

  it('a cue removed while it is the follow target ends the chain cleanly', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ follow: follow({ mode: 'auto', wait: 1 }) });
    const b = engine.addCue();
    engine.go();
    engine.removeCue(b);
    vi.advanceTimersByTime(2000);
    expect(engine.state.history).toHaveLength(1);
  });
});

describe('fades', () => {
  it('fades a macro from its live value and a param from an explicit start', () => {
    const { executor, written, values } = recorder({ 'macro:2': 0.2 });
    engine.setExecutor(executor);
    engine.addCue({
      actions: [
        action({ kind: 'macro', macro: 2, value: 1, fade: 2 }),
        action({ kind: 'param', path: 'vj:master:opacity', value: 0, fade: 1, from: 1 }),
        action({ kind: 'layerOpacity', layerId: 'L1', value: 0.5, fade: 0 }),
      ],
    });
    engine.go();
    expect(values['layer:L1']).toBe(0.5);
    expect(values['macro:2']).toBeCloseTo(0.2, 6);
    vi.advanceTimersByTime(1000);
    expect(values['macro:2']).toBeGreaterThan(0.55);
    expect(values['macro:2']).toBeLessThan(0.65);
    // Steps are ~30 fps, so a 1 s fade is within one step of done here.
    expect(values['param:vj:master:opacity']).toBeLessThan(0.04);
    vi.advanceTimersByTime(1100);
    expect(values['param:vj:master:opacity']).toBe(0);
    expect(values['macro:2']).toBe(1);
    expect(engine.activeFadeKeys()).toEqual([]);
    // Monotonic ramp.
    const ramp = written['macro:2'];
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
  });

  it('a param with no readable value fades from what the engine last wrote', () => {
    const { executor, values } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ actions: [action({ kind: 'param', path: 'vj:crossfader:value', value: 1, fade: 0, from: null })] });
    engine.addCue({ actions: [action({ kind: 'param', path: 'vj:crossfader:value', value: 0, fade: 2, from: null })] });
    engine.go();
    engine.go();
    vi.advanceTimersByTime(1000);
    expect(values['param:vj:crossfader:value']).toBeCloseTo(0.5, 1);
  });

  it('Stop freezes a fade where it is', () => {
    const { executor, values } = recorder({ 'macro:1': 0 });
    engine.setExecutor(executor);
    engine.addCue({ actions: [action({ kind: 'macro', macro: 1, value: 1, fade: 4 })] });
    engine.go();
    vi.advanceTimersByTime(2000);
    engine.stop();
    const held = values['macro:1'];
    vi.advanceTimersByTime(4000);
    expect(values['macro:1']).toBe(held);
    expect(held).toBeGreaterThan(0.4);
    expect(held).toBeLessThan(0.6);
  });
});

describe('markers and timecode', () => {
  it('fires the cues of markers the timeline crosses, in order, and not on a backwards move', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    const a = engine.addCue();
    const b = engine.addCue();
    engine.addMarker(10, b);
    engine.addMarker(5, a);
    engine.addMarker(7, null);
    expect(engine.timelineAdvanced(0, 4.9)).toEqual([]);
    expect(engine.timelineAdvanced(4.9, 10)).toEqual([a, b]);
    expect(engine.timelineAdvanced(10, 3)).toEqual([]);
    expect(engine.timelineAdvanced(9.9, 2, 12)).toEqual([b]);
    expect(engine.state.history.map((h) => h.source)).toEqual(['marker', 'marker', 'marker']);
  });

  it('fires cues whose timecode the chased clock crosses', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    const a = engine.addCue({ timecode: 3600 });
    const b = engine.addCue({ timecode: 3600.5 });
    expect(engine.timecodeAdvanced(3599.9, 3600.6)).toEqual([a, b]);
  });
});

describe('persistence', () => {
  it('round-trips cues, follows, actions and markers, and cleans dangling references', () => {
    const a = engine.addCue({ name: 'A', timecode: 12.5 });
    const b = engine.addCue({ name: 'B' });
    engine.updateFollow(a, { mode: 'auto', wait: 4, unit: 'beats', target: 'jump', jumpTo: b });
    engine.addAction(b, 'projector');
    engine.addAction(b, 'param');
    engine.addMarker(30, a, 'Top');
    const saved = JSON.parse(JSON.stringify(engine.serialize()));

    const other = new CueEngine();
    other.hydrate(saved);
    expect(other.serialize()).toEqual(saved);
    expect(other.state.standbyCueId).toBe(a);
    expect(other.state.currentCueId).toBeNull();

    saved.cues = saved.cues.filter((c: Cue) => c.id !== b);
    other.hydrate(saved);
    expect(other.state.cues[0].follow.target).toBe('next');
    expect(other.state.cues[0].follow.jumpTo).toBeNull();

    other.hydrate({ cues: [{ actions: [{ kind: 'nope' }, { kind: 'snapshot', slot: 99 }] }], markers: [{ time: -1 }, { time: 3, cueId: 'x' }] });
    expect(other.state.cues[0].actions).toHaveLength(1);
    expect(other.state.cues[0].actions[0]).toMatchObject({ kind: 'snapshot', slot: 16 });
    expect(other.state.markers).toHaveLength(1);
    expect(other.state.markers[0].cueId).toBeNull();
  });
});

describe('a 20-minute show runs unattended from one GO', () => {
  it('fires every cue at its programmed time and stops at the end', () => {
    const { executor, calls, values } = recorder({ 'macro:1': 0 }, 120);
    engine.setExecutor(executor);
    const A = (a: ActionInit) => action(a);
    const ids: string[] = [];
    const add = (name: string, actions: CueAction[], f: Partial<CueFollow>) => {
      const id = engine.addCue({ name, actions, follow: follow({ mode: 'auto', ...f }) });
      ids.push(id);
      return id;
    };
    // Waits in seconds unless beats (120 bpm: 1 beat = 0.5 s).
    add('Preshow', [A({ kind: 'blackout', on: true }), A({ kind: 'projector', projectorId: '*', command: 'power-on', input: '' })], { wait: 60 });
    add('House to half', [A({ kind: 'blackout', on: false }), A({ kind: 'preset', compositionId: 'intro' })], { wait: 120 });
    add('Music in', [A({ kind: 'timeline', op: 'play', seconds: 0 }), A({ kind: 'macro', macro: 1, value: 1, fade: 10 })], { wait: 240, unit: 'beats' }); // 120 s
    add('Scene 2', [A({ kind: 'snapshot', slot: 2 })], { wait: 180 });
    const skip = add('Scene 3', [A({ kind: 'vjColumn', deck: 'A', column: 1 })], { wait: 150 });
    const hidden = add('Only on GO', [A({ kind: 'snapshot', slot: 9 })], { mode: 'go' });
    add('Scene 4', [A({ kind: 'vjClip', deck: 'B', layer: 0, column: 3 })], { wait: 210 });
    add('Scene 5', [A({ kind: 'param', path: 'vj:crossfader:value', value: 1, fade: 5, from: 0 })], { wait: 160, unit: 'beats' }); // 80 s
    add('Finale', [A({ kind: 'preset', compositionId: 'finale' })], { wait: 180 });
    add('Fade out', [A({ kind: 'macro', macro: 1, value: 0, fade: 30 })], { wait: 60 });
    add('End', [A({ kind: 'blackout', on: true }), A({ kind: 'timeline', op: 'stop', seconds: 0 }), A({ kind: 'projector', projectorId: '*', command: 'shutter-close', input: '' })], { mode: 'go', target: 'end' });
    // Scene 3 jumps over the GO-only cue.
    engine.updateFollow(skip, { target: 'jump', jumpTo: ids[6] });

    const t0 = Date.now();
    engine.go();
    vi.advanceTimersByTime(20 * 60 * 1000);
    const fired = engine.state.history.map((h) => [engine.state.cues.find((c) => c.id === h.cueId)!.name, (h.at - t0) / 1000, h.source]);
    expect(fired).toEqual([
      ['Preshow', 0, 'go'],
      ['House to half', 60, 'follow'],
      ['Music in', 180, 'follow'],
      ['Scene 2', 300, 'follow'],
      ['Scene 3', 480, 'follow'],
      ['Scene 4', 630, 'follow'],
      ['Scene 5', 840, 'follow'],
      ['Finale', 920, 'follow'],
      ['Fade out', 1100, 'follow'],
      ['End', 1160, 'follow'],
    ]);
    expect(engine.state.history.some((h) => h.cueId === hidden)).toBe(false);
    expect(engine.state.active).toBe(false);
    expect(engine.state.pendingFollow).toBeNull();
    expect(values['macro:1']).toBe(0);
    expect(values['param:vj:crossfader:value']).toBe(1);
    expect(calls.filter((c) => c[0] === 'projector')).toEqual([
      ['projector', '*', 'power-on', ''],
      ['projector', '*', 'shutter-close', ''],
    ]);
    expect(calls.at(-2)).toEqual(['timeline', 'stop', 0]);
    // Nothing else happens after the end.
    const n = calls.length;
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(calls.length).toBe(n);
  });

  it('a looping installation keeps cycling for hours', () => {
    const { executor } = recorder();
    engine.setExecutor(executor);
    engine.addCue({ follow: follow({ mode: 'auto', wait: 45 }) });
    engine.addCue({ follow: follow({ mode: 'auto', wait: 75, target: 'loop' }) });
    engine.go();
    vi.advanceTimersByTime(4 * 60 * 60 * 1000);
    // 4 h / 2 min per lap = 120 laps, 2 fires each, plus the first GO.
    expect(engine.state.history).toHaveLength(50); // capped
    expect(engine.state.active).toBe(true);
  });
});
