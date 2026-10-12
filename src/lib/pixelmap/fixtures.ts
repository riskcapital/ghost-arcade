/**
 * Art-Net / sACN fixture model: defaults, sanitizing, DMX patching and
 * universe packing. Pure functions, shared by the sender and the UI.
 *
 * Layout and sampling reuse the WLED code (src/lib/wled/mapping.ts): a
 * fixture is a WLED-style mapping (strip, matrix, custom points plus a
 * source region) with a DMX patch instead of a WLED controller.
 */
import type {
  PixelMapColorOrder,
  PixelMapConfig,
  PixelMapDelivery,
  PixelMapFixture,
  PixelMapFixtureType,
  PixelMapProtocol,
  WLEDMappingConfig,
} from '../types';
import { generateUUID } from '../utils/uuid';
import { createDefaultWLEDMapping, resolveWLEDMapping, type ResolvedWLEDMapping } from '../wled/mapping';

export const DMX_CHANNELS = 512;
export const MAX_FIXTURE_PIXELS = 8192;
export const ARTNET_MAX_UNIVERSE = 32767;
export const SACN_MIN_UNIVERSE = 1;
export const SACN_MAX_UNIVERSE = 63999;
export const DEFAULT_PIXELMAP_FPS = 40;
export const MAX_PIXELMAP_FPS = 60;
/** Must match MAX_UNIVERSES_PER_FRAME in electron/pixelmap-output.cjs. */
export const MAX_UNIVERSES_PER_FRAME = 1024;

export const PIXEL_COLOR_ORDERS: PixelMapColorOrder[] = [
  'RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR',
  'RGBW', 'GRBW', 'BRGW', 'RBGW', 'WRGB',
];

const FIXTURE_TYPES: PixelMapFixtureType[] = ['strip', 'matrix', 'custom'];
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

export function isValidIPv4(address: string | undefined | null): boolean {
  return typeof address === 'string' && IPV4.test(address.trim()) && address.trim() !== '0.0.0.0';
}

export function channelsPerPixel(order: PixelMapColorOrder): 3 | 4 {
  return order.length === 4 ? 4 : 3;
}

/** 170 RGB pixels or 128 RGBW pixels per universe. */
export function pixelsPerUniverse(order: PixelMapColorOrder): number {
  return Math.floor(DMX_CHANNELS / channelsPerPixel(order));
}

export function minUniverse(protocol: PixelMapProtocol): number {
  return protocol === 'sacn' ? SACN_MIN_UNIVERSE : 0;
}

export function maxUniverse(protocol: PixelMapProtocol): number {
  return protocol === 'sacn' ? SACN_MAX_UNIVERSE : ARTNET_MAX_UNIVERSE;
}

export function deliveriesFor(protocol: PixelMapProtocol): PixelMapDelivery[] {
  return protocol === 'sacn' ? ['multicast', 'unicast'] : ['unicast', 'broadcast'];
}

export function createDefaultPixelMapConfig(): PixelMapConfig {
  return {
    enabled: false,
    fps: DEFAULT_PIXELMAP_FPS,
    artSync: false,
    sacnPriority: 100,
    sacnSourceName: 'Ghost Arcade',
    sacnCid: generateUUID(),
    fixtures: [],
  };
}

/** Layout for a fixture type, reusing the WLED mapping modes. */
export function fixtureMappingConfig(fixture: Pick<PixelMapFixture, 'type' | 'mapping'>): WLEDMappingConfig {
  return {
    ...createDefaultWLEDMapping(),
    sampleRadius: 0.01,
    ...(fixture.mapping ?? {}),
    mode: fixture.type,
  };
}

export function resolveFixtureMapping(fixture: PixelMapFixture, sourceAspect = 16 / 9): ResolvedWLEDMapping {
  return resolveWLEDMapping(fixture.pixelCount, fixtureMappingConfig(fixture), sourceAspect, MAX_FIXTURE_PIXELS);
}

/** The first universe after every existing fixture on the same protocol. */
function nextFreeUniverse(fixtures: PixelMapFixture[], protocol: PixelMapProtocol): number {
  let next = minUniverse(protocol);
  for (const fixture of fixtures) {
    if (fixture.protocol !== protocol) continue;
    const segments = patchFixture(fixture);
    const last = segments[segments.length - 1];
    if (last) next = Math.max(next, last.universe + 1);
  }
  return Math.min(next, maxUniverse(protocol));
}

export function createPixelMapFixture(existing: PixelMapFixture[] = [], protocol: PixelMapProtocol = 'artnet'): PixelMapFixture {
  return {
    id: `fixture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Fixture ${existing.length + 1}`,
    enabled: true,
    type: 'strip',
    pixelCount: 170,
    colorOrder: 'RGB',
    protocol,
    delivery: protocol === 'sacn' ? 'multicast' : 'unicast',
    address: '',
    universe: nextFreeUniverse(existing, protocol),
    channel: 1,
    mapping: {
      ...createDefaultWLEDMapping(),
      mode: 'strip',
      columns: 16,
      sampleRadius: 0.01,
    },
    brightness: 1,
    gamma: 1,
    samplingMode: 'average',
    testPattern: 'off',
    testColor: '#ffffff',
  };
}

export function sanitizePixelMapFixture(raw: Partial<PixelMapFixture> | undefined, index = 0): PixelMapFixture {
  const base = createPixelMapFixture([], raw?.protocol === 'sacn' ? 'sacn' : 'artnet');
  const protocol: PixelMapProtocol = raw?.protocol === 'sacn' ? 'sacn' : 'artnet';
  const deliveries = deliveriesFor(protocol);
  const type = FIXTURE_TYPES.includes(raw?.type as PixelMapFixtureType) ? raw!.type! : 'strip';
  return {
    ...base,
    ...(raw ?? {}),
    id: typeof raw?.id === 'string' && raw.id ? raw.id : base.id,
    name: typeof raw?.name === 'string' ? raw.name : `Fixture ${index + 1}`,
    enabled: raw?.enabled !== false,
    type,
    pixelCount: clampInt(raw?.pixelCount, 1, MAX_FIXTURE_PIXELS, 170),
    colorOrder: PIXEL_COLOR_ORDERS.includes(raw?.colorOrder as PixelMapColorOrder) ? raw!.colorOrder! : 'RGB',
    protocol,
    delivery: deliveries.includes(raw?.delivery as PixelMapDelivery) ? raw!.delivery! : deliveries[0],
    address: typeof raw?.address === 'string' ? raw.address.trim() : '',
    universe: clampInt(raw?.universe, minUniverse(protocol), maxUniverse(protocol), minUniverse(protocol)),
    channel: clampInt(raw?.channel, 1, DMX_CHANNELS, 1),
    mapping: { ...base.mapping, ...(raw?.mapping ?? {}), mode: type },
  };
}

export function normalizePixelMapConfig(raw: Partial<PixelMapConfig> | undefined | null): PixelMapConfig {
  const base = createDefaultPixelMapConfig();
  if (!raw || typeof raw !== 'object') return base;
  const cid = typeof raw.sacnCid === 'string' && /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(raw.sacnCid)
    ? raw.sacnCid
    : base.sacnCid;
  return {
    enabled: raw.enabled === true,
    fps: clampInt(raw.fps, 1, MAX_PIXELMAP_FPS, DEFAULT_PIXELMAP_FPS),
    artSync: raw.artSync === true,
    sacnPriority: clampInt(raw.sacnPriority, 0, 200, 100),
    sacnSourceName: typeof raw.sacnSourceName === 'string' && raw.sacnSourceName.trim()
      ? raw.sacnSourceName.slice(0, 63)
      : base.sacnSourceName,
    sacnCid: cid,
    fixtures: Array.isArray(raw.fixtures) ? raw.fixtures.map(sanitizePixelMapFixture) : [],
  };
}

export interface FixturePatchSegment {
  universe: number;
  /** First DMX channel of this segment, 1-based. */
  channel: number;
  firstPixel: number;
  pixelCount: number;
  channelCount: number;
}

/**
 * Split a fixture across universes. The first universe starts at the
 * fixture's channel; every later universe starts at channel 1. A pixel
 * that would not fit whole in the remaining channels moves to the next
 * universe.
 */
export function patchFixture(fixture: Pick<PixelMapFixture, 'pixelCount' | 'colorOrder' | 'universe' | 'channel'>): FixturePatchSegment[] {
  const width = channelsPerPixel(fixture.colorOrder);
  const segments: FixturePatchSegment[] = [];
  let remaining = clampInt(fixture.pixelCount, 1, MAX_FIXTURE_PIXELS, 1);
  let universe = Math.max(0, Math.floor(fixture.universe) || 0);
  let channel = clampInt(fixture.channel, 1, DMX_CHANNELS, 1);
  let pixel = 0;
  while (remaining > 0) {
    const fit = Math.floor((DMX_CHANNELS - (channel - 1)) / width);
    if (fit > 0) {
      const count = Math.min(fit, remaining);
      segments.push({ universe, channel, firstPixel: pixel, pixelCount: count, channelCount: count * width });
      pixel += count;
      remaining -= count;
    }
    universe += 1;
    channel = 1;
  }
  return segments;
}

export interface PixelMapTarget {
  protocol: PixelMapProtocol;
  /** null = sACN multicast (group derived from the universe). */
  host: string | null;
}

export function fixtureTarget(fixture: PixelMapFixture): PixelMapTarget {
  if (fixture.protocol === 'sacn' && fixture.delivery !== 'unicast') return { protocol: 'sacn', host: null };
  return { protocol: fixture.protocol, host: fixture.address.trim() };
}

export function targetLabel(target: PixelMapTarget, delivery?: PixelMapDelivery): string {
  if (target.host === null) return 'multicast';
  return delivery === 'broadcast' ? `broadcast ${target.host}` : target.host;
}

/** Problems that stop a fixture from sending. Empty when it is ready. */
export function fixtureIssues(fixture: PixelMapFixture): string[] {
  const issues: string[] = [];
  const target = fixtureTarget(fixture);
  if (target.host !== null && !isValidIPv4(target.host)) {
    issues.push(fixture.delivery === 'broadcast'
      ? 'Enter a broadcast address, for example 2.255.255.255 or 192.168.1.255.'
      : 'Enter the node IP address.');
  }
  const segments = patchFixture(fixture);
  const last = segments[segments.length - 1];
  if (fixture.universe < minUniverse(fixture.protocol)) {
    issues.push(fixture.protocol === 'sacn' ? 'sACN universes start at 1.' : 'Art-Net universes start at 0.');
  } else if (last && last.universe > maxUniverse(fixture.protocol)) {
    issues.push(`This fixture runs past universe ${maxUniverse(fixture.protocol)}.`);
  }
  return issues;
}

export interface UniverseSpan {
  fixtureId: string;
  name: string;
  enabled: boolean;
  /** Inclusive, 1-based. */
  start: number;
  end: number;
  overlap: boolean;
}

export interface UniverseUsageRow {
  key: string;
  protocol: PixelMapProtocol;
  host: string | null;
  broadcast: boolean;
  universe: number;
  spans: UniverseSpan[];
  used: number;
  overlap: boolean;
}

export interface UniverseConflict {
  protocol: PixelMapProtocol;
  universe: number;
  first: string;
  second: string;
  start: number;
  end: number;
}

export interface UniverseUsage {
  rows: UniverseUsageRow[];
  conflicts: UniverseConflict[];
  overlappingFixtureIds: Set<string>;
  universeCount: number;
}

export function universeKey(protocol: PixelMapProtocol, host: string | null, universe: number): string {
  return `${protocol}|${host ?? 'multicast'}|${universe}`;
}

/**
 * Channel usage per (protocol, destination, universe), with overlaps.
 * Two fixtures conflict when they write the same channels of the same
 * universe to the same destination. An Art-Net broadcast reaches every
 * node, so it conflicts with any Art-Net fixture on that universe.
 */
export function computeUniverseUsage(fixtures: PixelMapFixture[]): UniverseUsage {
  const rows = new Map<string, UniverseUsageRow>();
  const byUniverse = new Map<string, Array<{ span: UniverseSpan; row: UniverseUsageRow }>>();
  for (const fixture of fixtures) {
    const target = fixtureTarget(fixture);
    const broadcast = fixture.protocol === 'artnet' && fixture.delivery === 'broadcast';
    for (const segment of patchFixture(fixture)) {
      const key = universeKey(target.protocol, target.host, segment.universe);
      let row = rows.get(key);
      if (!row) {
        row = { key, protocol: target.protocol, host: target.host, broadcast, universe: segment.universe, spans: [], used: 0, overlap: false };
        rows.set(key, row);
      }
      row.broadcast ||= broadcast;
      const span: UniverseSpan = {
        fixtureId: fixture.id,
        name: fixture.name,
        enabled: fixture.enabled,
        start: segment.channel,
        end: segment.channel + segment.channelCount - 1,
        overlap: false,
      };
      row.spans.push(span);
      const group = `${target.protocol}|${segment.universe}`;
      byUniverse.set(group, [...(byUniverse.get(group) ?? []), { span, row }]);
    }
  }

  const conflicts: UniverseConflict[] = [];
  const overlappingFixtureIds = new Set<string>();
  for (const entries of byUniverse.values()) {
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const first = entries[a];
        const second = entries[b];
        const sameDestination = first.row === second.row
          || (first.row.protocol === 'artnet' && (first.row.broadcast || second.row.broadcast));
        if (!sameDestination) continue;
        const start = Math.max(first.span.start, second.span.start);
        const end = Math.min(first.span.end, second.span.end);
        if (start > end) continue;
        first.span.overlap = second.span.overlap = true;
        first.row.overlap = second.row.overlap = true;
        overlappingFixtureIds.add(first.span.fixtureId);
        overlappingFixtureIds.add(second.span.fixtureId);
        conflicts.push({
          protocol: first.row.protocol,
          universe: first.row.universe,
          first: first.span.name,
          second: second.span.name,
          start,
          end,
        });
      }
    }
  }

  const sorted = [...rows.values()].sort((a, b) =>
    a.protocol.localeCompare(b.protocol)
    || (a.host ?? '').localeCompare(b.host ?? '')
    || a.universe - b.universe
  );
  for (const row of sorted) {
    row.spans.sort((a, b) => a.start - b.start);
    const channels = new Set<number>();
    for (const span of row.spans) for (let channel = span.start; channel <= span.end; channel += 1) channels.add(channel);
    row.used = channels.size;
  }
  return { rows: sorted, conflicts, overlappingFixtureIds, universeCount: sorted.length };
}

export interface UniverseBuffer {
  protocol: PixelMapProtocol;
  host: string | null;
  universe: number;
  data: Uint8Array;
}

/** Channel slots for each colour letter; W is extracted as min(R, G, B). */
function orderIndices(order: PixelMapColorOrder): number[] {
  return Array.from(order, letter => 'RGBW'.indexOf(letter));
}

/**
 * Write a fixture's RGB pixels (3 bytes each, physical order) into full
 * 512-channel universe buffers, applying the colour order and patch.
 */
export function writeFixtureChannels(
  fixture: PixelMapFixture,
  rgb: Uint8Array,
  universes: Map<string, UniverseBuffer>
): void {
  const target = fixtureTarget(fixture);
  const indices = orderIndices(fixture.colorOrder);
  const white = indices.length === 4;
  const values = [0, 0, 0, 0];
  for (const segment of patchFixture(fixture)) {
    const key = universeKey(target.protocol, target.host, segment.universe);
    let buffer = universes.get(key);
    if (!buffer) {
      buffer = { protocol: target.protocol, host: target.host, universe: segment.universe, data: new Uint8Array(DMX_CHANNELS) };
      universes.set(key, buffer);
    }
    let offset = segment.channel - 1;
    for (let pixel = segment.firstPixel; pixel < segment.firstPixel + segment.pixelCount; pixel += 1) {
      const source = pixel * 3;
      const red = rgb[source] ?? 0;
      const green = rgb[source + 1] ?? 0;
      const blue = rgb[source + 2] ?? 0;
      if (white) {
        const w = Math.min(red, green, blue);
        values[0] = red - w;
        values[1] = green - w;
        values[2] = blue - w;
        values[3] = w;
      } else {
        values[0] = red;
        values[1] = green;
        values[2] = blue;
      }
      for (let slot = 0; slot < indices.length; slot += 1) buffer.data[offset + slot] = values[indices[slot]];
      offset += indices.length;
    }
  }
}

export interface PixelMapFrame {
  fps: number;
  artSync: boolean;
  sacn: { priority: number; sourceName: string; cid: string };
  universes: UniverseBuffer[];
}

/** Pack every ready fixture's pixels into one frame for pixelmap_send_frame. */
export function buildPixelMapFrame(
  config: PixelMapConfig,
  pixels: Map<string, Uint8Array>
): PixelMapFrame {
  const universes = new Map<string, UniverseBuffer>();
  for (const fixture of config.fixtures) {
    const rgb = pixels.get(fixture.id);
    if (!fixture.enabled || !rgb || fixtureIssues(fixture).length > 0) continue;
    writeFixtureChannels(fixture, rgb, universes);
  }
  return {
    fps: clampInt(config.fps, 1, MAX_PIXELMAP_FPS, DEFAULT_PIXELMAP_FPS),
    artSync: config.artSync,
    sacn: { priority: config.sacnPriority, sourceName: config.sacnSourceName, cid: config.sacnCid },
    universes: [...universes.values()].slice(0, MAX_UNIVERSES_PER_FRAME),
  };
}
