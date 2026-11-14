/**
 * Live source traces: a time window kept as a growing array with a moving
 * front (no shift per frame), a hard sample cap, and the following lines
 * worked out once per list of lines.
 */
import { describe, expect, it } from 'vitest';
import type { ControlLine } from './lineModel';
import { LiveTrace, LiveTraceTable, MAX_TRACE_SAMPLES } from './liveTrace';

const midiLine = (id: string, cc = 1): ControlLine => ({
  id, target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [],
  follow: { source: { kind: 'midi', cc, channel: -1 }, depth: 1 },
});
const beatLine = (id: string): ControlLine => ({
  id, target: { scope: 'layer', id: 'A' }, key: 'layer:opacity', kind: 'continuous', min: 0, max: 1, points: [],
  follow: { source: { kind: 'beat', shape: 'sine', beats: 4 }, depth: 1 },
});

describe('LiveTrace', () => {
  it('keeps the last `seconds` of samples, numbered from the start of the run', () => {
    const tr = new LiveTrace(30);
    for (let i = 0; i < 60 * 100; i++) tr.push(i / 60, i % 2);
    const s = tr.samples();
    expect(s[0].t).toBeGreaterThanOrEqual(100 - 1 / 60 - 30 - 1e-9);
    expect(s[s.length - 1].t).toBeCloseTo((6000 - 1) / 60);
    expect(tr.size).toBe(1801);
    expect(tr.end).toBe(6000);
    expect(tr.first).toBe(6000 - 1801);
    expect(tr.t(tr.first)).toBe(s[0].t);
    expect(tr.v(tr.end - 1)).toBe(s[s.length - 1].v);
  });

  it('does not keep the dropped samples in memory', () => {
    const tr = new LiveTrace(1);
    for (let i = 0; i < 100_000; i++) tr.push(i / 60, 0.5);
    // Kept array (with its dropped front) stays within twice the window and the compaction floor.
    const raw = (tr as unknown as { ts: number[] }).ts.length;
    expect(raw).toBeLessThanOrEqual(Math.max(2 * tr.size, 1024));
  });

  it('caps the samples whatever the frame rate (time standing still)', () => {
    const tr = new LiveTrace(30);
    for (let i = 0; i < MAX_TRACE_SAMPLES * 3; i++) tr.push(5, 0.1);
    expect(tr.size).toBe(MAX_TRACE_SAMPLES);
  });

  it('starts a new run when time goes back (a seek or a loop)', () => {
    const tr = new LiveTrace(30);
    for (let i = 0; i < 100; i++) tr.push(10 + i / 60, 0.3);
    const run = tr.run;
    tr.push(2, 0.9);
    expect(tr.run).toBe(run + 1);
    expect(tr.samples()).toEqual([{ t: 2, v: 0.9 }]);
    expect(tr.first).toBe(0);
  });
});

describe('LiveTraceTable', () => {
  it('records the lines that follow a live source and drops a trace when its line stops following', () => {
    const table = new LiveTraceTable(30);
    let lines: ControlLine[] = [midiLine('a', 1), midiLine('b', 2), beatLine('c')];
    const read = (src: { kind: string; cc?: number }) => (src.kind === 'midi' ? (src.cc ?? 0) / 10 : null);
    for (let i = 0; i < 10; i++) expect(table.record(lines, i / 60, read)).toBe(true);
    expect([...table.keys()].sort()).toEqual(['a', 'b']);
    expect(table.get('a')!.size).toBe(10);
    expect(table.get('b')!.v(9)).toBeCloseTo(0.2);
    lines = [midiLine('a', 1), beatLine('b')];
    table.record(lines, 1, read);
    expect([...table.keys()]).toEqual(['a']);
    lines = [];
    expect(table.record(lines, 2, read)).toBe(false);
    expect(table.size).toBe(0);
  });

  it('reads the list of lines only when it changes, not every frame', () => {
    const table = new LiveTraceTable(30);
    const plain: ControlLine[] = [midiLine('a'), ...Array.from({ length: 500 }, (_, i) => beatLine(`x${i}`))];
    let reads = 0;
    const lines = new Proxy(plain, {
      get(target, prop, recv) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
        return Reflect.get(target, prop, recv);
      },
    });
    table.record(lines, 0, () => 0.5);
    const first = reads;
    expect(first).toBeGreaterThan(0);
    for (let i = 1; i < 600; i++) table.record(lines, i / 60, () => 0.5);
    expect(reads).toBe(first);
    expect(table.get('a')!.size).toBe(600);
  });

  it('skips a source with no value yet', () => {
    const table = new LiveTraceTable(30);
    expect(table.record([midiLine('a')], 0, () => null)).toBe(false);
    expect(table.get('a')).toBeUndefined();
  });
});
