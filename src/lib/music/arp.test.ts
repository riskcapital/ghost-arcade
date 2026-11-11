import { describe, expect, it } from 'vitest';
import { arpCycle, Arpeggiator } from './arp';

const notes = (a: Arpeggiator, beats: number) => a.advance(beats).map((s) => s.note);

describe('arpeggiator', () => {
  it('orders a chord up, down and up-down', () => {
    expect(arpCycle([64, 60, 67], 'up')).toEqual([60, 64, 67]);
    expect(arpCycle([64, 60, 67], 'down')).toEqual([67, 64, 60]);
    expect(arpCycle([64, 60, 67], 'updown')).toEqual([60, 64, 67, 64]);
    expect(arpCycle([64, 60], 'played')).toEqual([64, 60]);
  });

  it('climbs octaves', () => {
    expect(arpCycle([60, 64], 'up', 2)).toEqual([60, 64, 72, 76]);
  });

  it('steps at its rate in beats, starting on the key', () => {
    const a = new Arpeggiator({ mode: 'up', rate: 0.25, gate: 0.5 });
    a.press(60, 0.9);
    a.press(64, 0.7);
    const steps = a.advance(1);
    expect(steps.map((s) => s.at)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(steps.map((s) => s.note)).toEqual([60, 64, 60, 64]);
    expect(steps[0].len).toBeCloseTo(0.125);
    expect(steps[1].vel).toBe(0.7);
  });

  it('carries its phase across windows', () => {
    const a = new Arpeggiator({ mode: 'up', rate: 0.5 });
    a.press(60, 1);
    expect(a.advance(0.3).map((s) => s.at)).toEqual([0]);
    const next = a.advance(0.3);
    expect(next).toHaveLength(1);
    expect(next[0].at).toBeCloseTo(0.2);
  });

  it('picks random notes from the held ones', () => {
    const a = new Arpeggiator({ mode: 'random', rate: 0.25, octaves: 2 }, () => 0.99);
    a.press(60, 1);
    a.press(67, 1);
    expect(notes(a, 0.5)).toEqual([79, 79]);
  });

  it('stops when the keys let go, unless latched', () => {
    const a = new Arpeggiator({ mode: 'up', rate: 0.25 });
    a.press(60, 1);
    a.release(60);
    expect(a.advance(1)).toHaveLength(0);
    const l = new Arpeggiator({ mode: 'up', rate: 0.25, latch: true });
    l.press(60, 1);
    l.press(64, 1);
    l.release(60);
    l.release(64);
    expect(notes(l, 0.5)).toEqual([60, 64]);
    // A fresh chord replaces the latched one.
    l.press(67, 1);
    expect(notes(l, 0.5)).toEqual([67, 67]);
  });
});
