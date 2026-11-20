import { describe, expect, it } from 'vitest';
import { StageFxFrameGate } from './stageFxFrame';

describe('StageFxFrameGate (Screen FX driver, native mode)', () => {
  it('an idle Screen FX row asks for one frame, not one per animation frame', () => {
    const gate = new StageFxFrameGate();
    let published = 0;
    // A paused show past the last Screen FX block: the row exists, no values.
    for (let frame = 0; frame < 60; frame++) if (gate.offer(new Map(), new Map(), true)) published++;
    expect(published).toBe(1);
  });

  it('publishes when a value moves, and not while it holds', () => {
    const gate = new StageFxFrameGate();
    expect(gate.offer(new Map([['a', 0.5]]), new Map(), true)).toBe(true);
    expect(gate.offer(new Map([['a', 0.5]]), new Map(), true)).toBe(false);
    expect(gate.offer(new Map([['a', 0.25]]), new Map(), true)).toBe(true);
    expect(gate.offer(new Map([['a', 0.25]]), new Map([['a', [1, 0, 0]]]), true)).toBe(true);
    expect(gate.offer(new Map([['a', 0.25]]), new Map([['a', [1, 0, 0]]]), true)).toBe(false);
    expect(gate.offer(new Map([['a', 0.25]]), new Map([['a', [0, 1, 0]]]), true)).toBe(true);
  });

  it('publishes when the Timeline row starts or stops driving, and after a reset', () => {
    const gate = new StageFxFrameGate();
    gate.offer(new Map(), new Map(), false);
    expect(gate.offer(new Map(), new Map(), true)).toBe(true);
    expect(gate.offer(new Map(), new Map(), true)).toBe(false);
    gate.reset();
    expect(gate.offer(new Map(), new Map(), true)).toBe(true);
  });
});
