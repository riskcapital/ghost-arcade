import { describe, expect, it } from 'vitest';
import { liveEditBarPlace } from './liveEditBarPlace';

describe('the Live key bar stays off the top of the canvas (the rotate handle)', () => {
  it('beside the canvas when there is room (a Timeline open, a narrow canvas)', () => {
    const p = liveEditBarPlace({ x: 390, y: 0, width: 492, height: 277 });
    expect(p).toEqual({ left: 12, top: 10, centered: false, above: false, maxWidth: 366 });
  });
  it('along the bottom edge when the canvas fills the width', () => {
    const p = liveEditBarPlace({ x: 20, y: 30, width: 1200, height: 675 });
    expect(p).toEqual({ left: 620, top: 695, centered: true, above: true, maxWidth: null });
  });
});
