import { describe, expect, it } from 'vitest';
import { GridScrollMirror } from './gridView';

/** A scroller that clamps like a browser one: 0..max. */
function scroller(max: number, at = 0) {
  let left = at;
  return {
    max,
    get scrollLeft() { return left; },
    set scrollLeft(v: number) { left = Math.max(0, Math.min(this.max, v)); },
  };
}

describe('the grid scroll mirror (what the lanes draw from)', () => {
  it('a grid made again at 0 (Timeline closed and opened) is put back where the view was, so the mirror matches it', () => {
    const mirror = new GridScrollMirror();
    const first = scroller(2000);
    mirror.attach(first);
    first.scrollLeft = 600;
    expect(mirror.read()).toBe(600);
    const again = scroller(2000, 0);
    expect(mirror.attach(again)).toBe(600);
    expect(again.scrollLeft).toBe(600);
  });

  it('never claims more scroll than the element has (a clamp with no scroll event)', () => {
    const mirror = new GridScrollMirror();
    const el = scroller(2000);
    mirror.attach(el);
    el.scrollLeft = 600;
    mirror.read();
    el.max = 40; el.scrollLeft = el.scrollLeft; // the view grew: the browser clamps
    expect(mirror.read()).toBe(40);
    const small = scroller(0);
    expect(mirror.attach(small)).toBe(0);
  });

  it('the same element again changes nothing', () => {
    const mirror = new GridScrollMirror();
    const el = scroller(2000, 300);
    expect(mirror.attach(el)).toBe(0); // put back to the mirror's 0 on first bind
    el.scrollLeft = 300;
    expect(mirror.attach(el)).toBe(300);
  });
});
