import { describe, expect, it } from 'vitest';
import { createLineStore } from './lineStore';
import { createLineRecorder, RELEASE_MS, RETURN_GLIDE } from './lineRecorder';
import { createLineControls } from './lineControls';
import { lineValueAt, pointsValueAt } from './lineEvaluator';
import type { ParamEntry, ParamTarget, RegistrySource } from './paramRegistry';
import type { ControlLine } from './lineModel';
import { createLayer, type Layer } from '../../types';

const L1: ParamTarget = { scope: 'layer', id: 'L1' };
const entries: Record<string, ParamEntry> = {
  'shader:speed': { key: 'shader:speed', label: 'Speed', group: 'Shader', min: 0, max: 10, step: 0.01, default: 1, kind: 'continuous' },
  'layer:visible': { key: 'layer:visible', label: 'Visible', group: 'Layer', min: 0, max: 1, step: 1, default: true, kind: 'bool' },
  'layer:opacity': { key: 'layer:opacity', label: 'Opacity', group: 'Layer', min: 0, max: 1, step: 0.01, default: 1, kind: 'continuous' },
};

function rig(initial: ControlLine[] = []) {
  let ms = 0;
  let ids = 0;
  const store = createLineStore(initial);
  const recorder = createLineRecorder({
    lines: () => store.lines(),
    commit: (label, line) => store.putLine(label, line),
    describe: (_t, key) => entries[key] ?? null,
    newId: () => `line${++ids}`,
  }, { now: () => ms });
  return { store, recorder, clock: { get ms() { return ms; }, set ms(v) { ms = v; } } };
}

/** Play the show from t0 to t1 at 60 fps, calling `move(t)` each frame. */
function play(r: ReturnType<typeof rig>, t0: number, t1: number, move?: (t: number) => number | null) {
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    r.clock.ms = t * 1000;
    const v = move?.(t);
    if (v !== null && v !== undefined) r.recorder.input(L1, 'shader:speed', v, t);
    r.recorder.tick(t);
  }
}

describe('recording', () => {
  it('ignores input while disarmed', () => {
    const r = rig();
    expect(r.recorder.input(L1, 'shader:speed', 5, 1)).toBe(false);
    expect(r.store.lines()).toHaveLength(0);
  });

  it('touch: writes while moving, ends RELEASE_MS after the control rests, glides back to the line', () => {
    const existing: ControlLine = { id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }, { t: 20, v: 2 }] };
    const r = rig([existing]);
    r.recorder.arm('touch');
    // A knob sweep 0 → 8 between 2 s and 3 s, then rests at 8.
    play(r, 0, 6, (t) => (t >= 2 && t <= 3 ? 8 * (t - 2) : null));
    expect(r.recorder.openPasses()).toBe(0);
    const line = r.store.lines()[0];
    // Recorded sweep, held for the release time, then back to 2.
    expect(lineValueAt(line, 1)).toBeCloseTo(2);
    expect(lineValueAt(line, 2.5) as number).toBeCloseTo(4, 0);
    expect(lineValueAt(line, 3 + RELEASE_MS / 1000 - 0.02) as number).toBeCloseTo(8, 1);
    expect(lineValueAt(line, 3 + RELEASE_MS / 1000 + RETURN_GLIDE + 0.05)).toBeCloseTo(2);
    expect(lineValueAt(line, 10)).toBeCloseTo(2);
    // Thinned: a straight sweep needs a handful of points, not 60.
    expect(line.points.length).toBeLessThan(12);
    // One undo step for the pass.
    expect(r.store.undoLabels()).toEqual(['Record into line']);
    r.store.undo();
    expect(r.store.lines()[0]).toBe(existing);
  });

  it('touch: the live value replaces the line while the pass is open, and only then', () => {
    const r = rig([{ id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }] }]);
    r.recorder.arm('touch');
    r.clock.ms = 1000;
    r.recorder.input(L1, 'shader:speed', 7, 1);
    expect(r.recorder.touches().get('a')).toBe(7);
    r.clock.ms = 1000 + RELEASE_MS - 1;
    r.recorder.tick(1.299);
    expect(r.recorder.touches().get('a')).toBe(7);
    r.clock.ms = 1000 + RELEASE_MS;
    r.recorder.tick(1.3);
    expect(r.recorder.touches().size).toBe(0);
  });

  it('latch: holds the last value until the show stops', () => {
    const r = rig([{ id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }, { t: 30, v: 2 }] }]);
    r.recorder.arm('latch');
    play(r, 0, 8, (t) => (t >= 2 && t <= 2.5 ? 6 : null));
    expect(r.recorder.openPasses()).toBe(1);
    expect(r.recorder.touches().get('a')).toBe(6);
    r.recorder.stop(8);
    const line = r.store.lines()[0];
    expect(lineValueAt(line, 5)).toBeCloseTo(6);
    expect(lineValueAt(line, 7.9)).toBeCloseTo(6);
    expect(lineValueAt(line, 9)).toBeCloseTo(2);
    expect(r.store.undoLabels()).toHaveLength(1);
  });

  it('a parameter without a line gets one, keeping its own value outside the pass', () => {
    const r = rig();
    r.recorder.arm('touch');
    play(r, 0, 3, (t) => (t >= 1 && t <= 1.5 ? 5 : null));
    const [line] = r.store.lines();
    expect(line).toMatchObject({ target: L1, key: 'shader:speed', min: 0, max: 10, kind: 'continuous' });
    expect(lineValueAt(line, 0.5)).toBeCloseTo(1);
    expect(lineValueAt(line, 1.2)).toBeCloseTo(5);
    expect(lineValueAt(line, 2.8)).toBeCloseTo(1);
    expect(r.store.undoLabels()).toEqual(['Record line']);
  });

  it('two passes are two undo steps; a bool pass records holds', () => {
    const r = rig();
    r.recorder.arm('touch');
    play(r, 0, 2, (t) => (t >= 0.5 && t <= 0.6 ? 3 : null));
    play(r, 2, 4, (t) => (t >= 3 && t <= 3.1 ? 9 : null));
    expect(r.store.undoLabels()).toHaveLength(2);
    r.recorder.input(L1, 'layer:visible', false, 4.2);
    r.clock.ms = 10_000;
    r.recorder.tick(4.6);
    const vis = r.store.lines().find((l) => l.key === 'layer:visible')!;
    expect(vis.kind).toBe('bool');
    expect(lineValueAt(vis, 4.3)).toBe(false);
    expect(lineValueAt(vis, 0)).toBe(true);
  });

  it('a loop back in show time ends the pass at the jump', () => {
    const r = rig();
    r.recorder.arm('latch');
    r.recorder.input(L1, 'shader:speed', 4, 9);
    r.recorder.input(L1, 'shader:speed', 6, 0.5);
    expect(r.store.undoLabels()).toHaveLength(1);
    expect(r.recorder.openPasses()).toBe(1);
  });

  it('latch: a seek forward leaves what the playhead skipped as it was', () => {
    const r = rig([{ id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }, { t: 100, v: 2 }] }]);
    r.recorder.arm('latch');
    play(r, 0, 2, (t) => (t >= 1 && t <= 1.2 ? 8 : null));
    // Seek to 50 and play on.
    for (let t = 50; t <= 52; t += 1 / 60) {
      r.clock.ms += 1000 / 60;
      r.recorder.tick(t);
    }
    r.recorder.stop(52);
    const line = r.store.lines()[0];
    expect(lineValueAt(line, 1.5)).toBeCloseTo(8);
    expect(lineValueAt(line, 25)).toBeCloseTo(2);
    expect(lineValueAt(line, 51)).toBeCloseTo(8);
  });

  it('touch: a seek forward mid-gesture does not ramp across the skipped part', () => {
    const r = rig([{ id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }, { t: 100, v: 2 }] }]);
    r.recorder.arm('touch');
    play(r, 1, 1.2, () => 8);
    r.clock.ms += 16;
    r.recorder.input(L1, 'shader:speed', 9, 40);
    r.clock.ms += 1000;
    r.recorder.tick(41);
    const line = r.store.lines()[0];
    expect(lineValueAt(line, 20)).toBeCloseTo(2);
    expect(lineValueAt(line, 1.1)).toBeCloseTo(8);
  });

  it('latch across a loop wrap writes the next lap too', () => {
    const r = rig([{ id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }, { t: 10, v: 2 }] }]);
    r.recorder.arm('latch');
    play(r, 5, 10 - 1 / 60, (t) => (t < 5.1 ? 9 : null));
    // The loop wraps: lap 2 from just past 0 to 4.
    for (let t = 0.01; t <= 4; t += 1 / 60) {
      r.clock.ms += 1000 / 60;
      r.recorder.tick(t);
    }
    r.recorder.stop(4);
    const line = r.store.lines()[0];
    expect(lineValueAt(line, 7)).toBeCloseTo(9);
    expect(lineValueAt(line, 2)).toBeCloseTo(9);
    expect(r.store.undoLabels()).toHaveLength(2);
  });
});

describe('controls', () => {
  function controlsRig(initial: ControlLine[] = []) {
    const r = rig(initial);
    let showTime = 0;
    let playing = true;
    let restoring = false;
    let bid = 0;
    const controls = createLineControls({
      restoring: () => restoring,
      recorder: r.recorder,
      lines: () => r.store.lines(),
      describe: (_t, key) => entries[key] ?? null,
      showTime: () => showTime,
      playing: () => playing,
      newId: () => `b${++bid}`,
      now: () => r.clock.ms,
    });
    return { ...r, controls, setTime: (t: number) => { showTime = t; }, setPlaying: (p: boolean) => { playing = p; }, setRestoring: (v: boolean) => { restoring = v; } };
  }

  it('touch a knob to bind: the next moved CC binds and is kept from the mappings', () => {
    const c = controlsRig();
    c.controls.bindNext(L1, 'shader:speed');
    expect(c.controls.onMidi(0, 'note', 36, 100, { id: 'x', name: 'Pad' })).toBe(false);
    expect(c.controls.onMidi(2, 'cc', 21, 64, { id: 'x', name: 'Knobs' })).toBe(true);
    expect(c.controls.bindings()).toEqual([{ id: 'b1', source: { kind: 'midi', channel: 2, cc: 21, input: 'Knobs' }, target: L1, key: 'shader:speed' }]);
    expect(c.controls.pendingBind()).toBeNull();
    // Later moves pass through to the mappings too (not consumed).
    expect(c.controls.onMidi(2, 'cc', 21, 10, { id: 'x', name: 'Knobs' })).toBe(false);
    // Rebinding the parameter to another knob replaces the binding.
    c.controls.bindNext(L1, 'shader:speed');
    c.controls.onMidi(2, 'cc', 22, 0, { id: 'x', name: 'Knobs' });
    expect(c.controls.bindings().map((b) => (b.source as any).cc)).toEqual([22]);
  });

  it('a bound knob records into the line when armed and playing, scaled to the range', () => {
    const c = controlsRig();
    c.controls.bindNext(L1, 'shader:speed');
    c.controls.onMidi(0, 'cc', 1, 0, { id: null });
    c.recorder.arm('touch');
    c.setTime(1);
    c.clock.ms = 1000;
    c.controls.onMidi(0, 'cc', 1, 127, { id: null });
    expect(c.recorder.touches().size).toBe(1);
    expect([...c.recorder.touches().values()][0]).toBe(10);
    expect(c.controls.midiCC(0, 1)).toBe(1);
    expect(c.controls.midiCC(-1, 1)).toBe(1);
  });

  it('unarmed, a bound knob drives the line live for a moment, without writing it', () => {
    const line: ControlLine = { id: 'a', target: L1, key: 'shader:speed', kind: 'continuous', min: 0, max: 10, points: [{ t: 0, v: 2 }] };
    const c = controlsRig([line]);
    c.controls.setBindings([{ id: 'b', source: { kind: 'midi', channel: -1, cc: 5 }, target: L1, key: 'shader:speed' }]);
    c.clock.ms = 0;
    c.controls.onMidi(3, 'cc', 5, 127, { id: null });
    expect(c.controls.touches().get('a')).toBe(10);
    c.clock.ms = RELEASE_MS + 1;
    expect(c.controls.touches().get('a')).toBeUndefined();
    expect(c.store.lines()[0]).toBe(line);
  });

  it('a stored value put back by undo or redo is not recorded as a move', () => {
    const line: ControlLine = { id: 'a', target: L1, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }, { t: 10, v: 1 }] };
    const c = controlsRig([line]);
    const source = (opacity: number): RegistrySource => ({ layers: [{ ...createLayer('L1', 'Facade'), opacity }] });
    c.controls.observe(source(1));
    c.recorder.arm('touch');
    c.setTime(2);
    c.setRestoring(true);
    c.controls.observe(source(0.4));
    c.setRestoring(false);
    expect(c.recorder.openPasses()).toBe(0);
    // The restored value is the new baseline: an unchanged project records nothing.
    c.controls.observe(source(0.4));
    expect(c.recorder.openPasses()).toBe(0);
    expect(c.store.undoLabels()).toHaveLength(0);
  });

  it('a stored value moved by the slider, OSC or a Live signal is recorded (project watch)', () => {
    const line: ControlLine = { id: 'a', target: L1, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }, { t: 10, v: 1 }] };
    const c = controlsRig([line]);
    const layer = (opacity: number): Layer => ({ ...createLayer('L1', 'Facade'), opacity });
    const source = (opacity: number): RegistrySource => ({ layers: [layer(opacity)] });
    c.controls.observe(source(1)); // primes
    c.recorder.arm('touch');
    c.clock.ms = 2000;
    c.setTime(2);
    c.controls.observe(source(0.4));
    expect(c.recorder.touches().get('a')).toBeCloseTo(0.4);
    c.clock.ms = 2000 + RELEASE_MS;
    c.recorder.tick(2.3);
    expect(lineValueAt(c.store.lines()[0], 2.1)).toBeCloseTo(0.4);
    expect(pointsValueAt(c.store.lines()[0].points, 8)).toBeCloseTo(1);
    // Stopped: changes are edits, not recordings.
    c.setPlaying(false);
    c.controls.observe(source(0.1));
    expect(c.recorder.openPasses()).toBe(0);
  });

  it('OSC and Live knob bindings', () => {
    let live = 0.2;
    const r = rig();
    const controls = createLineControls({
      recorder: r.recorder, lines: () => r.store.lines(), describe: (_t, k) => entries[k] ?? null,
      showTime: () => 1, playing: () => true, newId: () => 'b', now: () => r.clock.ms, liveParam: () => live,
    }, [
      { id: 'o', source: { kind: 'osc', address: '/fader/1' }, target: L1, key: 'shader:speed' },
      { id: 'k', source: { kind: 'live-param', track: 0, device: 1, param: 2 }, target: L1, key: 'layer:opacity' },
    ]);
    r.recorder.arm('touch');
    expect(controls.onOsc('/fader/1', 0.5)).toBe(true);
    controls.pollLive();
    live = 0.6;
    controls.pollLive();
    expect([...r.recorder.touches().values()].sort()).toEqual([0.6, 5]);
  });
});
