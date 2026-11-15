import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginRenderClock, endRenderClock, engineDate, engineNowMs, engineRandom, renderClockActive, setRenderClockSeconds } from './renderClock';

afterEach(() => { endRenderClock(); vi.restoreAllMocks(); });

describe('render clock', () => {
  it('is the wall clock live', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1234);
    expect(renderClockActive()).toBe(false);
    expect(engineNowMs()).toBe(1234);
  });

  it('moves by exactly the rendered time during a render, however long a frame takes', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000);
    beginRenderClock(30);
    expect(engineNowMs()).toBe(5000);
    now.mockReturnValue(99_000); // the wall clock races ahead
    setRenderClockSeconds(30 + 1 / 120);
    expect(engineNowMs()).toBeCloseTo(5000 + 1000 / 120, 9);
    setRenderClockSeconds(31);
    expect(engineNowMs()).toBe(6000);
    endRenderClock();
    expect(engineNowMs()).toBe(99_000);
  });

  it('dates shaders from the render start plus the rendered time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    beginRenderClock(0);
    setRenderClockSeconds(90);
    expect(engineDate().getTime()).toBe(1_700_000_090_000);
  });

  it('gives the same random sequence in every render', () => {
    beginRenderClock(0, 7);
    const a = [engineRandom(), engineRandom(), engineRandom()];
    beginRenderClock(0, 7);
    const b = [engineRandom(), engineRandom(), engineRandom()];
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});
