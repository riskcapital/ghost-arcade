import { describe, expect, it } from 'vitest';
import type { WLEDController } from '../../types';
import { ledClipGain, normalizeLedClip, normalizeLedClips, type TimelineLedClip } from './ledClips';
import { controllerNeedsPicture, renderLedBlock, renderTimelineLeds, type LedRenderContext } from './ledRender';
import { lookPalette } from '../../looks/edgeLooks';

const strip = (fields: Partial<WLEDController> = {}): WLEDController => ({
  id: 's', name: 'Strip', ipAddr: '127.0.0.1', port: 21324, enabled: true, ledCount: 10, ...fields,
} as WLEDController);

const block = (fields: Partial<TimelineLedClip>): TimelineLedClip => normalizeLedClip({ id: 'b', rowId: 'led:s', startTime: 0, duration: 10, ...fields })!;
const ctx = (time: number, extra: Partial<LedRenderContext> = {}): LedRenderContext => ({ time, bpm: 120, source: null, ...extra });
const pixel = (buf: Uint8Array, i: number) => Array.from(buf.subarray(i * 3, i * 3 + 3));
const render = (controller: WLEDController, clips: TimelineLedClip[], c: LedRenderContext) => {
  const out = new Uint8Array(controller.ledCount * 3);
  const driven = renderTimelineLeds(controller, clips, c, out);
  return { driven, out };
};

describe('LED blocks', () => {
  it('normalizes and keeps unknown fields out', () => {
    expect(normalizeLedClip({ rowId: 'nope' })).toBeNull();
    const c = normalizeLedClip({ rowId: 'led:s#r1', kind: 'chase', color: '#FF0000', speed: 99, pattern: 'not-a-pattern', where: { motion: { kind: 'sweep', bars: 2 } } })!;
    expect(c).toMatchObject({ rowId: 'led:s#r1', kind: 'chase', color: '#ff0000', speed: 8 });
    expect(c.pattern).toBeUndefined();
    expect(c.where).toMatchObject({ members: 'leds', motion: { kind: 'sweep', bars: 2 } });
    expect(normalizeLedClips([{ rowId: 'led:a', startTime: 5 }, { rowId: 'led:b', startTime: 1 }, null]).map((x) => x.rowId)).toEqual(['led:b', 'led:a']);
  });

  it('fades in and out, nothing outside the block', () => {
    const c = block({ startTime: 2, duration: 4, fadeIn: 1, fadeOut: 2 });
    expect(ledClipGain(c, 1.99)).toBe(0);
    expect(ledClipGain(c, 2.5)).toBeCloseTo(0.5, 9);
    expect(ledClipGain(c, 3.5)).toBe(1);
    expect(ledClipGain(c, 5)).toBeCloseTo(0.5, 9);
    expect(ledClipGain(c, 6)).toBe(0);
  });

  it('colour, with brightness and a colour line', () => {
    const px = new Uint8Array(30);
    renderLedBlock(block({ kind: 'colour', color: '#ff8000', brightness: 0.5 }), { start: 0, count: 10 }, ctx(1), px);
    expect(pixel(px, 0)).toEqual([128, 64, 0]);
    renderLedBlock(block({ kind: 'colour', color: '#ff8000' }), { start: 0, count: 10 }, ctx(1, { lines: () => ({ 'ledblock:color': 0x00ff00, 'ledblock:brightness': 1 }) }), px);
    expect(pixel(px, 9)).toEqual([0, 255, 0]);
  });

  it('gradient runs colour → second colour along the strip', () => {
    const px = new Uint8Array(30);
    renderLedBlock(block({ kind: 'gradient', color: '#ff0000', color2: '#0000ff', speed: 0 }), { start: 0, count: 10 }, ctx(1), px);
    expect(pixel(px, 0)).toEqual([255, 0, 0]);
    expect(pixel(px, 9)).toEqual([0, 0, 255]);
  });

  it('chase puts a runner where speed × time says', () => {
    const px = new Uint8Array(30);
    const c = block({ kind: 'chase', color: '#ffffff', speed: 0.5, width: 0.1 });
    renderLedBlock(c, { start: 0, count: 10 }, ctx(0), px);
    expect(pixel(px, 0)).toEqual([255, 255, 255]);
    expect(pixel(px, 5)).toEqual([0, 0, 0]);
    renderLedBlock(c, { start: 0, count: 10 }, ctx(1), px); // half way round
    expect(pixel(px, 5)).toEqual([255, 255, 255]);
    expect(pixel(px, 0)).toEqual([0, 0, 0]);
  });

  it('follow the stage copies the sampled picture of its span', () => {
    const source = new Uint8Array(30);
    for (let i = 0; i < 10; i++) source.set([i * 10, 100, 200], i * 3);
    const px = new Uint8Array(12);
    renderLedBlock(block({ kind: 'follow' }), { start: 3, count: 4 }, ctx(1, { source }), px);
    expect(pixel(px, 0)).toEqual([30, 100, 200]);
    expect(pixel(px, 3)).toEqual([60, 100, 200]);
  });

  it('LED effect: a catalog pattern, deterministic in time', () => {
    const c = block({ kind: 'effect', pattern: 'chase', color: '#ff0000', color2: '#ff0000', speed: 0.5 });
    const a = new Uint8Array(30);
    const b = new Uint8Array(30);
    renderLedBlock(c, { start: 0, count: 10 }, ctx(3.3), a);
    renderLedBlock(c, { start: 0, count: 10 }, ctx(3.3), b);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.some((v) => v > 0)).toBe(true);
    expect(a.some((v, i) => i % 3 === 0 && v === 0)).toBe(true); // not every LED lit: a runner
    const later = new Uint8Array(30);
    renderLedBlock(c, { start: 0, count: 10 }, ctx(4.1), later);
    expect(Array.from(later)).not.toEqual(Array.from(a));
  });

  it("look carries a Look's palette onto the strip", () => {
    const px = new Uint8Array(30);
    renderLedBlock(block({ kind: 'look', paletteId: 'neon' }), { start: 0, count: 10 }, ctx(0), px);
    const first = lookPalette('neon').colors[0].slice(0, 3).map((v) => Math.round(v * 255));
    expect(pixel(px, 0)).toEqual(first);
  });
});

describe('LED rows', () => {
  it('a row with no blocks keeps the project output; with blocks it is dark between them', () => {
    expect(render(strip(), [], ctx(1)).driven).toBe(false);
    expect(render(strip(), [block({ rowId: 'led:other' })], ctx(1)).driven).toBe(false);
    const clips = [block({ kind: 'colour', color: '#ff0000', startTime: 2, duration: 2 })];
    const before = render(strip(), clips, ctx(1));
    expect(before.driven).toBe(true);
    expect(before.out.every((v) => v === 0)).toBe(true);
    expect(pixel(render(strip(), clips, ctx(3)).out, 4)).toEqual([255, 0, 0]);
    expect(render(strip(), clips, ctx(4)).out.every((v) => v === 0)).toBe(true);
  });

  it('range rows paint their span over the controller row', () => {
    const controller = strip({ ranges: [{ id: 'r', name: 'Top', start: 5, count: 5 }] });
    const clips = [
      block({ id: 'whole', kind: 'colour', color: '#ff0000' }),
      block({ id: 'part', rowId: 'led:s#r', kind: 'colour', color: '#0000ff' }),
    ];
    const { out } = render(controller, clips, ctx(1));
    expect(pixel(out, 4)).toEqual([255, 0, 0]);
    expect(pixel(out, 5)).toEqual([0, 0, 255]);
  });

  it('overlapping blocks: the later draws over by its fade', () => {
    const clips = [
      block({ id: 'a', kind: 'colour', color: '#ff0000', startTime: 0, duration: 10 }),
      block({ id: 'b', kind: 'colour', color: '#0000ff', startTime: 4, duration: 6, fadeIn: 2 }),
    ];
    expect(pixel(render(strip(), clips, ctx(5)).out, 0)).toEqual([128, 0, 128]);
  });

  it('an LED block with a where line lights only the fixtures in its window', () => {
    const a = strip({ id: 'a' });
    const b = strip({ id: 'b' });
    const c = block({ id: 'w', rowId: 'led:a', kind: 'colour', color: '#00ff00', where: { motion: { kind: 'drawn' } } as never });
    const where = new Map([['w', new Map([['led:b', 1]])]]);
    expect(render(a, [c], ctx(1, { where, allDriven: true })).out.every((v) => v === 0)).toBe(true);
    expect(pixel(render(b, [c], ctx(1, { where, allDriven: true })).out, 0)).toEqual([0, 255, 0]);
    // half lit: half the light
    const half = new Map([['w', new Map([['led:b', 0.5]])]]);
    expect(pixel(render(b, [c], ctx(1, { where: half, allDriven: true })).out, 0)).toEqual([0, 128, 0]);
  });

  it('a look travelling off the projection lands on the lit fixtures', () => {
    const looks = [{ clipId: 'L', paletteId: 'neon', weight: 1, localTime: 0, spots: new Map([['led:s', 1]]) }];
    const { driven, out } = render(strip(), [], ctx(1, { looks, allDriven: true }));
    expect(driven).toBe(true);
    expect(out.some((v) => v > 0)).toBe(true);
  });
});

describe('which controllers need the stage picture', () => {
  it('colour blocks need none; follow and content effects do while lit; undriven controllers always do', () => {
    const colours = [block({ kind: 'colour', startTime: 0, duration: 4 }), block({ id: 'c', kind: 'chase', startTime: 4, duration: 4 })];
    expect(controllerNeedsPicture(strip(), colours, { time: 1 })).toBe(false);
    expect(controllerNeedsPicture(strip(), colours, { time: 9 })).toBe(false);
    const follow = [...colours, block({ id: 'f', kind: 'follow', startTime: 8, duration: 2 })];
    expect(controllerNeedsPicture(strip(), follow, { time: 1 })).toBe(false);
    expect(controllerNeedsPicture(strip(), follow, { time: 9 })).toBe(true);
    const content = [block({ id: 'e', kind: 'effect', pattern: 'chase', startTime: 0, duration: 4 })];
    expect(controllerNeedsPicture(strip(), content, { time: 1 })).toBe(false);
    const shaderChase = [block({ id: 'e', kind: 'effect', pattern: 'shader-color-chase', startTime: 0, duration: 4 })];
    expect(controllerNeedsPicture(strip(), shaderChase, { time: 1 })).toBe(true);
    // Not on the Timeline: the project's own LED output samples the picture.
    expect(controllerNeedsPicture(strip({ id: 'other' }), colours, { time: 1 })).toBe(true);
    expect(controllerNeedsPicture(strip({ id: 'other' }), colours, { time: 1, allDriven: true })).toBe(false);
  });
});
