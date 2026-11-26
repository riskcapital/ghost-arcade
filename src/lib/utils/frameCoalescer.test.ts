import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFrameCoalescer } from './frameCoalescer';

let frames: Array<() => void> = [];

beforeEach(() => {
  frames = [];
  (globalThis as any).requestAnimationFrame = (cb: () => void) => { frames.push(cb); return frames.length; };
  (globalThis as any).cancelAnimationFrame = (id: number) => { frames[id - 1] = () => {}; };
});

afterEach(() => {
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
});

describe('createFrameCoalescer', () => {
  it('runs once per frame with the latest arguments', () => {
    const seen: number[] = [];
    const c = createFrameCoalescer((n: number) => seen.push(n));
    c.schedule(1); c.schedule(2); c.schedule(3);
    expect(seen).toEqual([]);
    expect(frames.length).toBe(1);
    frames[0]();
    expect(seen).toEqual([3]);
  });

  it('flush applies the waiting call at once, and only once', () => {
    const seen: number[] = [];
    const c = createFrameCoalescer((n: number) => seen.push(n));
    c.schedule(7);
    c.flush();
    expect(seen).toEqual([7]);
    frames[0]();
    c.flush();
    expect(seen).toEqual([7]);
  });

  it('cancel drops the waiting call', () => {
    const seen: number[] = [];
    const c = createFrameCoalescer((n: number) => seen.push(n));
    c.schedule(1);
    c.cancel();
    frames[0]();
    expect(seen).toEqual([]);
  });

  it('runs straight away without requestAnimationFrame', () => {
    delete (globalThis as any).requestAnimationFrame;
    const seen: number[] = [];
    const c = createFrameCoalescer((n: number) => seen.push(n));
    c.schedule(5);
    expect(seen).toEqual([5]);
  });
});
