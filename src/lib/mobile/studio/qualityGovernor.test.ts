import { describe, expect, it } from 'vitest';
import { MIN_DETAIL, QualityGovernor, shaderRenderHeight } from './qualityGovernor';

const feed = (g: QualityGovernor, fps: number, seconds: number) => { const events: string[] = []; for (let i = 0; i < seconds; i++) { const e = g.sample(fps); if (e) events.push(e); } return events; };

describe('what each quality setting really renders', () => {
  it('renders a single shader at the full output size, including 1080p', () => {
    expect(shaderRenderHeight(540, 1)).toBe(540);
    expect(shaderRenderHeight(720, 1)).toBe(720);
    // The reviewed bug: "1080p · maximum detail" never rendered a shader above 720p.
    expect(shaderRenderHeight(1080, 1)).toBe(1080);
  });
  it('shares the budget between layers and keeps the lower settings as they were', () => {
    expect(shaderRenderHeight(1080, 4)).toBe(540);
    expect(shaderRenderHeight(720, 4)).toBe(360);
    expect(Math.round(shaderRenderHeight(540, 2))).toBe(509);
    expect(shaderRenderHeight(540, 4)).toBe(360);
    expect(shaderRenderHeight(720, 0)).toBe(720);
  });
  it('applies the adaptive detail and never goes below a usable size', () => {
    expect(shaderRenderHeight(1080, 1, 0.5)).toBe(540);
    expect(shaderRenderHeight(540, 8, MIN_DETAIL)).toBe(180);
  });
});

describe('adaptive detail', () => {
  it('lowers after three slow seconds, one step at a time, down to the floor', () => {
    const g = new QualityGovernor();
    feed(g, 60, 5);
    expect(feed(g, 20, 2)).toEqual([]);
    expect(feed(g, 20, 1)).toEqual(['lowered']);
    expect(g.detail).toBe(0.85);
    feed(g, 20, 30);
    expect(g.detail).toBe(MIN_DETAIL);
    expect(feed(g, 20, 10)).toEqual([]);
  });
  it('ignores a single hitch such as a shader compile', () => {
    const g = new QualityGovernor();
    feed(g, 60, 3);
    expect([g.sample(12), g.sample(60), g.sample(14), g.sample(15), g.sample(60)]).toEqual([null, null, null, null, null]);
    expect(g.detail).toBe(1);
  });
  it('recovers when the frame rate has been healthy for a while', () => {
    const g = new QualityGovernor();
    feed(g, 60, 5); feed(g, 20, 3);
    expect(g.detail).toBe(0.85);
    expect(feed(g, 58, 7)).toEqual([]);
    expect(feed(g, 58, 1)).toEqual(['raised']);
    expect(g.detail).toBe(1);
    expect(feed(g, 60, 60)).toEqual([]);
  });
  it('does not raise while the frame rate is only "not slow"', () => {
    const g = new QualityGovernor();
    feed(g, 60, 5); feed(g, 20, 3);
    expect(feed(g, 35, 120)).toEqual([]);
    expect(g.detail).toBe(0.85);
  });
  it('waits twice as long after a raise that did not hold, so detail cannot see-saw', () => {
    const g = new QualityGovernor();
    feed(g, 60, 5); feed(g, 20, 3);          // 0.85
    feed(g, 60, 8);                          // raised to 1
    expect(g.detail).toBe(1);
    expect(feed(g, 20, 3)).toEqual(['lowered']); // relapse within seconds of the raise
    expect(feed(g, 60, 15)).toEqual([]);     // 8 s is no longer enough
    expect(feed(g, 60, 1)).toEqual(['raised']);
    expect(feed(g, 20, 3)).toEqual(['lowered']);
    expect(feed(g, 60, 31)).toEqual([]);     // now 32 s
    expect(feed(g, 60, 1)).toEqual(['raised']);
  });
  it('does not treat a 30 fps cap (low power mode) as slow', () => {
    const g = new QualityGovernor();
    expect(feed(g, 30, 120)).toEqual([]);
    expect(g.detail).toBe(1);
  });
});
