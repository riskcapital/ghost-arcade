import { describe, expect, it } from 'vitest';
import { registerStudioControls, releaseStudioControls, runStudioControl, studioControl, studioControls } from './studioControls';

describe('studio controls', () => {
  it('fires a trigger once per press', () => {
    const hits: number[] = [];
    const off = registerStudioControls([{ id: 'test.pad', label: 'Pad', group: 'Pads', kind: 'trigger', run: (v) => hits.push(v) }]);
    runStudioControl('test.pad', 0.8);
    runStudioControl('test.pad', 0.9);
    runStudioControl('test.pad', 0);
    runStudioControl('test.pad', 0.3);
    expect(hits).toEqual([0.8, 0.3]);
    off();
    expect(runStudioControl('test.pad', 1)).toBe(false);
  });

  it('holds while pressed and lets go on release or when released for it', () => {
    const states: number[] = [];
    const off = registerStudioControls([{ id: 'test.throw', label: 'Throw', group: 'Band', kind: 'hold', run: (v) => states.push(v) }]);
    runStudioControl('test.throw', 1);
    runStudioControl('test.throw', 0);
    runStudioControl('test.throw', 1);
    releaseStudioControls();
    expect(states).toEqual([1, 0, 1, 0]);
    off();
  });

  it('flips a toggle on each press and follows a knob', () => {
    let on = false;
    const knob: number[] = [];
    const off = registerStudioControls([
      { id: 'test.freeze', label: 'Freeze', group: 'Band', kind: 'toggle', run: () => (on = !on) },
      { id: 'test.level', label: 'Level', group: 'Visuals', kind: 'value', run: (v) => knob.push(v) },
    ]);
    runStudioControl('test.freeze', 1);
    runStudioControl('test.freeze', 0);
    runStudioControl('test.freeze', 1);
    expect(on).toBe(false);
    runStudioControl('test.level', 0.2);
    runStudioControl('test.level', 2);
    expect(knob).toEqual([0.2, 1]);
    expect(studioControls().map((c) => c.group)).toEqual(['Band', 'Visuals']);
    off();
    expect(studioControl('test.level')).toBeUndefined();
  });

  it('refuses ids the router could not reach', () => {
    expect(() => registerStudioControls([{ id: 'Bad Id', label: '', group: '', kind: 'trigger', run: () => {} }])).toThrow();
  });
});
