import { describe, expect, it } from 'vitest';
import type { PixelMapFixture } from '../types';
import {
  buildPixelMapFrame,
  computeUniverseUsage,
  createDefaultPixelMapConfig,
  createPixelMapFixture,
  fixtureIssues,
  normalizePixelMapConfig,
  patchFixture,
  pixelsPerUniverse,
  resolveFixtureMapping,
  sanitizePixelMapFixture,
} from './fixtures';

function fixture(fields: Partial<PixelMapFixture> = {}): PixelMapFixture {
  return { ...createPixelMapFixture([]), address: '127.0.0.1', ...fields };
}

function solid(count: number, rgb: [number, number, number]): Uint8Array {
  const buffer = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) buffer.set(rgb, index * 3);
  return buffer;
}

function frameFor(fixtures: PixelMapFixture[], pixels: Record<string, Uint8Array>) {
  const config = { ...createDefaultPixelMapConfig(), enabled: true, fixtures };
  return buildPixelMapFrame(config, new Map(Object.entries(pixels)));
}

describe('universe spanning', () => {
  it('fits 170 RGB or 128 RGBW pixels per universe', () => {
    expect(pixelsPerUniverse('RGB')).toBe(170);
    expect(pixelsPerUniverse('GRB')).toBe(170);
    expect(pixelsPerUniverse('RGBW')).toBe(128);
  });

  it('fills universe 0 exactly with a 170-pixel RGB strip', () => {
    const strip = fixture({ pixelCount: 170, universe: 0, channel: 1 });
    expect(patchFixture(strip)).toEqual([
      { universe: 0, channel: 1, firstPixel: 0, pixelCount: 170, channelCount: 510 },
    ]);
    const frame = frameFor([strip], { [strip.id]: solid(170, [255, 0, 0]) });
    expect(frame.universes).toHaveLength(1);
    const data = frame.universes[0].data;
    expect(frame.universes[0]).toMatchObject({ protocol: 'artnet', host: '127.0.0.1', universe: 0 });
    expect(data.length).toBe(512);
    for (let channel = 0; channel < 510; channel += 3) {
      expect([data[channel], data[channel + 1], data[channel + 2]]).toEqual([255, 0, 0]);
    }
    expect([data[510], data[511]]).toEqual([0, 0]);
  });

  it('spills pixel 171 into universe 1, channel 1', () => {
    const strip = fixture({ pixelCount: 171, universe: 0 });
    expect(patchFixture(strip)).toEqual([
      { universe: 0, channel: 1, firstPixel: 0, pixelCount: 170, channelCount: 510 },
      { universe: 1, channel: 1, firstPixel: 170, pixelCount: 1, channelCount: 3 },
    ]);
    const pixels = solid(171, [10, 20, 30]);
    pixels.set([1, 2, 3], 170 * 3);
    const frame = frameFor([strip], { [strip.id]: pixels });
    expect(frame.universes.map(universe => universe.universe)).toEqual([0, 1]);
    expect(Array.from(frame.universes[0].data.subarray(507, 512))).toEqual([10, 20, 30, 0, 0]);
    expect(Array.from(frame.universes[1].data.subarray(0, 4))).toEqual([1, 2, 3, 0]);
  });

  it('spans RGBW fixtures at 128 pixels per universe without splitting a pixel', () => {
    const rgbw = fixture({ pixelCount: 300, colorOrder: 'RGBW', universe: 4 });
    expect(patchFixture(rgbw)).toEqual([
      { universe: 4, channel: 1, firstPixel: 0, pixelCount: 128, channelCount: 512 },
      { universe: 5, channel: 1, firstPixel: 128, pixelCount: 128, channelCount: 512 },
      { universe: 6, channel: 1, firstPixel: 256, pixelCount: 44, channelCount: 176 },
    ]);
  });

  it('moves a pixel that would straddle the universe boundary', () => {
    // Channel 509 leaves 4 channels: one RGB pixel fits (509-511), the next moves on.
    expect(patchFixture(fixture({ pixelCount: 3, channel: 509, universe: 2 }))).toEqual([
      { universe: 2, channel: 509, firstPixel: 0, pixelCount: 1, channelCount: 3 },
      { universe: 3, channel: 1, firstPixel: 1, pixelCount: 2, channelCount: 6 },
    ]);
    // Channel 511 leaves 2 channels: no RGB pixel fits, so the fixture starts in the next universe.
    expect(patchFixture(fixture({ pixelCount: 1, channel: 511, universe: 2 }))).toEqual([
      { universe: 3, channel: 1, firstPixel: 0, pixelCount: 1, channelCount: 3 },
    ]);
    // RGBW from channel 3: 510 channels left, 127 whole pixels.
    expect(patchFixture(fixture({ pixelCount: 128, channel: 3, colorOrder: 'GRBW', universe: 0 }))[0])
      .toMatchObject({ pixelCount: 127, channelCount: 508 });
  });
});

describe('colour order', () => {
  const channels = (colorOrder: PixelMapFixture['colorOrder'], rgb: [number, number, number]) => {
    const one = fixture({ pixelCount: 1, colorOrder });
    return Array.from(frameFor([one], { [one.id]: solid(1, rgb) }).universes[0].data.subarray(0, colorOrder.length));
  };

  it('reorders RGB channels', () => {
    expect(channels('RGB', [1, 2, 3])).toEqual([1, 2, 3]);
    expect(channels('GRB', [1, 2, 3])).toEqual([2, 1, 3]);
    expect(channels('BRG', [1, 2, 3])).toEqual([3, 1, 2]);
    expect(channels('BGR', [1, 2, 3])).toEqual([3, 2, 1]);
    expect(channels('RBG', [1, 2, 3])).toEqual([1, 3, 2]);
    expect(channels('GBR', [1, 2, 3])).toEqual([2, 3, 1]);
  });

  it('extracts white as min(R, G, B) for RGBW orders', () => {
    expect(channels('RGBW', [255, 0, 0])).toEqual([255, 0, 0, 0]);
    expect(channels('RGBW', [255, 255, 255])).toEqual([0, 0, 0, 255]);
    expect(channels('RGBW', [200, 150, 100])).toEqual([100, 50, 0, 100]);
    expect(channels('GRBW', [200, 150, 100])).toEqual([50, 100, 0, 100]);
    expect(channels('WRGB', [200, 150, 100])).toEqual([100, 100, 50, 0]);
  });
});

describe('frames', () => {
  it('merges fixtures that share a universe and skips disabled or unaddressed ones', () => {
    const first = fixture({ pixelCount: 2, universe: 0, channel: 1 });
    const second = fixture({ id: 'second', pixelCount: 2, universe: 0, channel: 7 });
    const off = fixture({ id: 'off', pixelCount: 2, universe: 0, channel: 20, enabled: false });
    const noAddress = fixture({ id: 'blank', pixelCount: 2, universe: 9, address: '' });
    const frame = frameFor([first, second, off, noAddress], {
      [first.id]: solid(2, [1, 1, 1]),
      second: solid(2, [2, 2, 2]),
      off: solid(2, [3, 3, 3]),
      blank: solid(2, [4, 4, 4]),
    });
    expect(frame.universes).toHaveLength(1);
    expect(Array.from(frame.universes[0].data.subarray(0, 21))).toEqual([
      1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('sends sACN multicast with a null host and the project source settings', () => {
    const sacn = fixture({ protocol: 'sacn', delivery: 'multicast', universe: 1, pixelCount: 1, address: '' });
    const frame = frameFor([sacn], { [sacn.id]: solid(1, [9, 8, 7]) });
    expect(frame.universes[0]).toMatchObject({ protocol: 'sacn', host: null, universe: 1 });
    expect(frame.sacn).toMatchObject({ priority: 100, sourceName: 'Ghost Arcade' });
    expect(frame.sacn.cid).toMatch(/^[0-9a-f-]{36}$/);
    expect(frame.fps).toBe(40);
  });
});

describe('universe usage', () => {
  it('reports channels used per universe', () => {
    const usage = computeUniverseUsage([fixture({ id: 'a', name: 'A', pixelCount: 171 })]);
    expect(usage.rows.map(row => [row.universe, row.used, row.overlap])).toEqual([[0, 510, false], [1, 3, false]]);
    expect(usage.conflicts).toEqual([]);
  });

  it('flags fixtures writing the same channels of the same universe', () => {
    const usage = computeUniverseUsage([
      fixture({ id: 'a', name: 'A', pixelCount: 10, universe: 0, channel: 1 }),
      fixture({ id: 'b', name: 'B', pixelCount: 10, universe: 0, channel: 25 }),
      fixture({ id: 'c', name: 'C', pixelCount: 10, universe: 0, channel: 100 }),
    ]);
    expect(usage.conflicts).toEqual([{ protocol: 'artnet', universe: 0, first: 'A', second: 'B', start: 25, end: 30 }]);
    expect([...usage.overlappingFixtureIds].sort()).toEqual(['a', 'b']);
    expect(usage.rows[0].spans.map(span => span.overlap)).toEqual([true, true, false]);
  });

  it('keeps different nodes and protocols apart, but broadcast reaches every node', () => {
    const separate = computeUniverseUsage([
      fixture({ id: 'a', address: '10.0.0.1' }),
      fixture({ id: 'b', address: '10.0.0.2' }),
      fixture({ id: 'c', protocol: 'sacn', delivery: 'multicast', universe: 1 }),
      fixture({ id: 'd', protocol: 'sacn', delivery: 'multicast', universe: 2 }),
    ]);
    expect(separate.conflicts).toEqual([]);
    const broadcast = computeUniverseUsage([
      fixture({ id: 'a', address: '10.0.0.1' }),
      fixture({ id: 'b', address: '10.0.0.255', delivery: 'broadcast' }),
    ]);
    expect(broadcast.conflicts).toHaveLength(1);
  });
});

describe('fixture model', () => {
  it('places a new fixture after the universes already in use', () => {
    const first = fixture({ pixelCount: 171 });
    expect(createPixelMapFixture([first]).universe).toBe(2);
    expect(createPixelMapFixture([first], 'sacn').universe).toBe(1);
  });

  it('reports missing addresses and protocol universe limits', () => {
    expect(fixtureIssues(fixture({ address: '' }))).toEqual(['Enter the node IP address.']);
    expect(fixtureIssues(fixture({ address: '300.1.1.1' }))).toHaveLength(1);
    expect(fixtureIssues(fixture({ protocol: 'sacn', delivery: 'multicast', address: '', universe: 1 }))).toEqual([]);
    expect(fixtureIssues(fixture({ universe: 32767, pixelCount: 171 }))).toEqual(['This fixture runs past universe 32767.']);
  });

  it('sanitizes saved fixtures and config', () => {
    const cleaned = sanitizePixelMapFixture({ protocol: 'sacn', universe: 0, channel: 900, pixelCount: 1e9, colorOrder: 'XYZ' as never, delivery: 'broadcast' });
    expect(cleaned).toMatchObject({ universe: 1, channel: 512, pixelCount: 8192, colorOrder: 'RGB', delivery: 'multicast' });
    const config = normalizePixelMapConfig({ fps: 500, sacnPriority: -3, sacnCid: 'bad', fixtures: [{ type: 'matrix' } as never] });
    expect(config).toMatchObject({ enabled: false, fps: 60, sacnPriority: 0 });
    expect(config.sacnCid).toMatch(/^[0-9a-f-]{36}$/);
    expect(config.fixtures[0].mapping.mode).toBe('matrix');
    expect(normalizePixelMapConfig(undefined).fixtures).toEqual([]);
  });

  it('lays out strips, serpentine matrices and custom points past the WLED 490 cap', () => {
    const strip = resolveFixtureMapping(fixture({ pixelCount: 600, type: 'strip' }));
    expect(strip.points).toHaveLength(600);
    expect(strip.points[0]).toEqual({ x: 0, y: 0.5 });
    const matrix = resolveFixtureMapping(fixture({
      pixelCount: 8,
      type: 'matrix',
      mapping: { mode: 'matrix', columns: 4, serpentine: true },
    }));
    // Second row runs right to left.
    expect(matrix.points[4].x).toBeGreaterThan(matrix.points[7].x);
    const custom = resolveFixtureMapping(fixture({
      pixelCount: 2,
      type: 'custom',
      mapping: { mode: 'custom', points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }] },
    }));
    expect(custom.points).toEqual([{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 }]);
  });
});
