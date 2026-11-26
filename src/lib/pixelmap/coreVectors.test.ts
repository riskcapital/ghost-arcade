/**
 * Reference vectors for the render core's port of the pixel-map and WLED
 * output (native-renderer/src/pixelmap_out). Every value here comes from the
 * JS modules the editor path runs; the Rust tests read the same file and
 * must produce the same bytes.
 *
 * The file is checked in. After a deliberate change to the JS packers or
 * sampling, regenerate it with GA_WRITE_PIXELMAP_VECTORS=1 and run the
 * native tests.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { PixelMapConfig, PixelMapFixture, WLEDColorSamplingMode, WLEDTestPattern } from '../types';
import { calibrateWLEDPixels, fillWLEDTestPattern, sampleWLEDSourcePixels } from '../wled/mapping';
import { buildPixelMapFrame, createDefaultPixelMapConfig, createPixelMapFixture, normalizePixelMapConfig } from './fixtures';
import { buildCorePixelMapPlan } from './corePlan';

const require = createRequire(import.meta.url);
const packets = require('../../../electron/pixelmap-packets.cjs');
const { buildWLEDRealtimePacket } = require('../../../electron/wled-packet.cjs');
const { createPixelMapOutput } = require('../../../electron/pixelmap-output.cjs');

const VECTORS = path.resolve(__dirname, '../../../native-renderer/src/pixelmap_out/testdata/vectors.json');
const CID = '5f1b1c2e-8d3a-4c6b-9e0f-1a2b3c4d5e6f';

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (bytes: ArrayLike<number>) => Buffer.from(Array.from(bytes)).toString('hex');
const randomBytes = (random: () => number, count: number) => Array.from({ length: count }, () => Math.floor(random() * 256));

function packetVectors() {
  const random = rng(1);
  const out: unknown[] = [];
  const art = (universe: number, sequence: number, data: number[]) =>
    out.push({ kind: 'artdmx', universe, sequence, data: hex(data), packet: hex(packets.buildArtDmxPacket({ universe, sequence, data: Uint8Array.from(data) })) });
  art(0, 1, randomBytes(random, 512));
  art(0x1234, 255, randomBytes(random, 3));
  art(32767, 0, [9]);
  art(16, 77, randomBytes(random, 170 * 3));
  art(5, 200, randomBytes(random, 2));
  out.push({ kind: 'artsync', packet: hex(packets.buildArtSyncPacket()) });
  const e131 = (fields: Record<string, unknown>, data: number[]) => out.push({
    kind: 'e131', ...fields, data: hex(data),
    packet: hex(packets.buildE131DataPacket({ cid: CID, ...fields, data: Uint8Array.from(data) })),
  });
  e131({ universe: 1, sequence: 0, priority: 100, sourceName: 'Ghost Arcade' }, randomBytes(random, 512));
  e131({ universe: 63999, sequence: 255, priority: 200, sourceName: '  Stage left  ' }, randomBytes(random, 1));
  e131({ universe: 300, sequence: 9, priority: 0, sourceName: '' }, randomBytes(random, 384));
  e131({ universe: 2, sequence: 4, priority: 120, sourceName: 'x'.repeat(80), terminated: true }, randomBytes(random, 510));
  e131({ universe: 7, sequence: 1, priority: 100, sourceName: `${'a'.repeat(62)}é and more` }, randomBytes(random, 12));
  e131({ universe: 8, sequence: 2, priority: 100, sourceName: '舞台照明'.repeat(8), preview: true, forceSync: true, syncAddress: 9 }, randomBytes(random, 33));
  e131({ universe: 9, sequence: 3, priority: 100, sourceName: '﻿ Lobby ' }, randomBytes(random, 6));
  for (const leds of [1, 2, 150, 490]) {
    const pixels = randomBytes(random, leds * 3);
    out.push({ kind: 'wled', data: hex(pixels), packet: hex(buildWLEDRealtimePacket(Uint8Array.from(pixels))) });
  }
  return out;
}

/** A 64x36 picture: gradients, flat patches and noise, RGBA, top row first. */
function picture() {
  const random = rng(2);
  const width = 64;
  const height = 36;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (x < 20) {
        data[i] = Math.round((x / 19) * 255);
        data[i + 1] = Math.round((y / 35) * 255);
        data[i + 2] = 128;
      } else if (x < 40) {
        const flat = (Math.floor(x / 5) + Math.floor(y / 6)) % 4;
        const colors = [[255, 0, 0], [0, 255, 40], [20, 20, 255], [250, 250, 250]];
        data.set(colors[flat], i);
      } else {
        data.set(randomBytes(random, 3), i);
      }
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const MODES: WLEDColorSamplingMode[] = ['exact', 'average', 'dominant', 'highlight', 'palette', 'luma-hue'];

function samplingVectors(image: ReturnType<typeof picture>) {
  const random = rng(3);
  const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }];
  for (let i = 0; i < 60; i += 1) points.push({ x: random(), y: random() });
  const out: unknown[] = [];
  for (const radius of [0, 0.01, 0.05, 0.12, 0.3]) {
    for (const mode of MODES) {
      const output = new Uint8Array(points.length * 3);
      sampleWLEDSourcePixels(image.data, image.width, image.height, points, radius, output, mode);
      out.push({ radius, mode, output: hex(output) });
    }
  }
  return { points: points.flatMap(p => [p.x, p.y]), cases: out };
}

const OPTION_SETS = [
  {},
  { brightness: 0.5 },
  { gamma: 2.2 },
  { gamma: 0.7, brightness: 0.8 },
  { brightness: 3, gamma: 9 },
  { calibration: { redGain: 1.5, greenGain: 0.5, blueGain: 2, saturation: 1.7 } },
  { calibration: { saturation: 0 } },
  { calibration: { blackThreshold: 0.2 } },
  { calibration: { smoothing: 0.6 } },
  { calibration: { smoothing: 2 } },
  { calibration: { colorMatrix: [0.9, 0.1, 0, 0.05, 0.9, 0.05, 0, 0.2, 0.8] } },
  { calibration: { colorMatrix: [1, 2] } },
  { gamma: 1.8, brightness: 0.9, calibration: { redGain: 0.8, smoothing: 0.3, saturation: 1.2, blackThreshold: 0.01 } },
];

function calibrationVectors() {
  const random = rng(4);
  const source = randomBytes(random, 90);
  source.splice(0, 9, 0, 0, 0, 255, 255, 255, 1, 2, 3);
  const previous = randomBytes(random, 90);
  return {
    source: hex(source),
    previous: hex(previous),
    cases: OPTION_SETS.map(options => {
      const output = new Uint8Array(90);
      calibrateWLEDPixels(Uint8Array.from(source), output, options, Uint8Array.from(previous));
      return { options, output: hex(output) };
    }),
  };
}

function patternVectors() {
  const out: unknown[] = [];
  const previous = new Uint8Array(17 * 3).fill(40);
  for (const pattern of ['solid', 'rainbow', 'chase'] as WLEDTestPattern[]) {
    for (const [color, nowMs] of [['#ff8000', 0], ['#00ffcc', 1234.5], ['bogus', 80 * 20], [undefined, 999]] as const) {
      for (const options of [{}, { brightness: 0.7, gamma: 2, calibration: { smoothing: 0.5 } }]) {
        const output = new Uint8Array(17 * 3);
        fillWLEDTestPattern(pattern, color, nowMs, output, options, previous);
        out.push({ pattern, color: color ?? null, nowMs, options, output: hex(output) });
      }
    }
  }
  return { previous: hex(previous), cases: out };
}

function fixtureConfig(): PixelMapConfig {
  const base = createDefaultPixelMapConfig();
  const fixture = (fields: Partial<PixelMapFixture>) => ({ ...createPixelMapFixture([]), ...fields }) as PixelMapFixture;
  return normalizePixelMapConfig({
    ...base,
    enabled: true,
    fps: 40,
    artSync: true,
    sacnPriority: 150,
    sacnSourceName: 'Vectors',
    sacnCid: CID,
    fixtures: [
      fixture({ id: 'strip', name: 'Strip', pixelCount: 300, colorOrder: 'GRB', protocol: 'artnet', delivery: 'unicast', address: '10.0.0.5', universe: 0, channel: 4,
        mapping: { mode: 'strip', axis: 'horizontal', columns: 16, serpentine: false, reverse: true, flipX: false, flipY: false, sourceRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, sampleRadius: 0.02 },
        brightness: 0.8, gamma: 2.2, samplingMode: 'average' }),
      fixture({ id: 'matrix', name: 'Matrix', type: 'matrix', pixelCount: 256, colorOrder: 'RGBW', protocol: 'sacn', delivery: 'multicast', universe: 10, channel: 1,
        mapping: { mode: 'matrix', axis: 'vertical', columns: 16, serpentine: true, reverse: false, flipX: true, flipY: false, sourceRegion: { x: 0, y: 0, width: 1, height: 1 }, sampleRadius: 0.05 },
        samplingMode: 'dominant', calibration: { saturation: 1.3, redGain: 0.9 } }),
      fixture({ id: 'wrgb', name: 'Wash', type: 'custom', pixelCount: 5, colorOrder: 'WRGB', protocol: 'sacn', delivery: 'unicast', address: '10.0.0.9', universe: 3, channel: 500,
        mapping: { mode: 'custom', axis: 'horizontal', columns: 8, serpentine: false, reverse: false, flipX: false, flipY: true, sourceRegion: { x: 0, y: 0, width: 1, height: 1 }, sampleRadius: 0.12,
          points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.95 }] },
        samplingMode: 'luma-hue', calibration: { blackThreshold: 0.05 } }),
      fixture({ id: 'shared', name: 'Shares strip universe', pixelCount: 2, colorOrder: 'BGR', protocol: 'artnet', delivery: 'unicast', address: '10.0.0.5', universe: 1, channel: 400, samplingMode: 'highlight' }),
      fixture({ id: 'off', name: 'Disabled', enabled: false, pixelCount: 10, protocol: 'artnet', address: '10.0.0.5', universe: 2 }),
      fixture({ id: 'broken', name: 'No address', pixelCount: 10, protocol: 'artnet', address: '', universe: 4 }),
      fixture({ id: 'test', name: 'Test pattern', pixelCount: 7, colorOrder: 'RGB', protocol: 'artnet', delivery: 'broadcast', address: '10.255.255.255', universe: 6, testPattern: 'solid', testColor: '#123456', brightness: 0.5 }),
    ],
  });
}

/** One editor-path tick over `image` for every ready fixture, then packing. */
function endToEnd(image: ReturnType<typeof picture>) {
  const config = fixtureConfig();
  const plan = buildCorePixelMapPlan(config, image.width / image.height);
  const pixels = new Map<string, Uint8Array>();
  for (const fixture of plan.fixtures) {
    const count = fixture.points.length / 2;
    const points = Array.from({ length: count }, (_, i) => ({ x: fixture.points[i * 2], y: fixture.points[i * 2 + 1] }));
    const options = { brightness: fixture.brightness, gamma: fixture.gamma, calibration: fixture.calibration };
    const rgb = new Uint8Array(count * 3);
    const previous = new Uint8Array(count * 3);
    if (fixture.testPattern !== 'off') {
      fillWLEDTestPattern(fixture.testPattern as WLEDTestPattern, fixture.testColor, 0, rgb, options, previous);
    } else {
      const source = new Uint8Array(count * 3);
      sampleWLEDSourcePixels(image.data, image.width, image.height, points, fixture.sampleRadius, source, fixture.samplingMode as WLEDColorSamplingMode);
      calibrateWLEDPixels(source, rgb, options, previous);
    }
    pixels.set(fixture.id, rgb);
  }
  const frame = buildPixelMapFrame(config, pixels);
  return {
    plan,
    pixels: Object.fromEntries([...pixels].map(([id, rgb]) => [id, hex(rgb)])),
    universes: frame.universes.map(u => ({ protocol: u.protocol, host: u.host, universe: u.universe, data: hex(u.data) })),
  };
}

/** pixelmap-output.cjs over a short run of frames, with a recording socket. */
async function outputScenario() {
  const sent: Array<{ port: string; host: string; packet: string }> = [];
  let time = 1000;
  const dgram = {
    createSocket() {
      return {
        on() {}, once() {}, off() {},
        bind(_port: number, callback: () => void) { queueMicrotask(callback); },
        setBroadcast() {},
        address() { return { port: 50123 }; },
        send(packet: Buffer, _o: number, _l: number, port: number, host: string, done: (error?: Error | null) => void) {
          sent.push({ port: port === 7000 ? 'artnet' : 'sacn', host, packet: hex(packet) });
          queueMicrotask(() => done(null));
        },
        close() {},
      };
    },
  };
  const output = createPixelMapOutput({ dgram, artnetPort: 7000, sacnPort: 7001, now: () => time, log: { warn() {} } });
  const random = rng(5);
  const data = (n: number) => Uint8Array.from(randomBytes(random, n));
  const sacn = { priority: 110, sourceName: 'Scenario', cid: CID };
  const frames = [
    { at: 0, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: data(512) }, { protocol: 'sacn', host: '127.0.0.1', universe: 1, data: data(510) }] },
    { at: 10, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: data(512) }] },
    { at: 25, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: data(512) }, { protocol: 'sacn', host: '127.0.0.1', universe: 1, data: data(510) }] },
    { at: 50, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: data(512) }] },
    { at: 75, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 0, data: data(512) }, { protocol: 'artnet', host: '127.0.0.1', universe: 1, data: data(3) }] },
    { at: 101, universes: [{ protocol: 'artnet', host: '127.0.0.1', universe: 1, data: data(3) }, { protocol: 'sacn', host: '127.0.0.1', universe: 2, data: data(100) }] },
  ];
  const results: unknown[] = [];
  for (const frame of frames) {
    time = 1000 + frame.at;
    const result = await output.sendFrame({ fps: 40, artSync: true, sacn, universes: frame.universes });
    await new Promise(resolve => setTimeout(resolve, 0));
    results.push({ at: frame.at, dropped: result.dropped === true });
  }
  const stopped = output.stop();
  return {
    frames: frames.map(frame => ({ at: frame.at, universes: frame.universes.map(u => ({ ...u, data: hex(u.data) })) })),
    results,
    terminated: stopped.terminated,
    sent,
  };
}

async function buildVectors() {
  const image = picture();
  return {
    note: 'Generated by src/lib/pixelmap/coreVectors.test.ts from the JS modules. Do not edit.',
    cid: CID,
    packets: packetVectors(),
    picture: { width: image.width, height: image.height, rgba: Buffer.from(image.data).toString('base64') },
    sampling: samplingVectors(image),
    calibration: calibrationVectors(),
    patterns: patternVectors(),
    endToEnd: endToEnd(image),
    output: await outputScenario(),
  };
}

describe('render core pixel-map reference vectors', () => {
  it('match the checked-in file the native tests read', async () => {
    const vectors = JSON.stringify(await buildVectors(), null, 1) + '\n';
    if (process.env.GA_WRITE_PIXELMAP_VECTORS === '1') {
      fs.mkdirSync(path.dirname(VECTORS), { recursive: true });
      fs.writeFileSync(VECTORS, vectors);
    }
    expect(fs.readFileSync(VECTORS, 'utf8')).toBe(vectors);
  });
});
