/**
 * Where lines and LED rows through the Timeline: the store evaluates, the
 * where runtime decorates the frame, the scene dresses only the lit pieces,
 * and the WLED sender puts the LED rows on the wire. Packets are checked on
 * a real UDP listener (a fake WLED controller) at set show times.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { createRequire } from 'node:module';
import dgram from 'node:dgram';

vi.mock('../../stores/layers', () => ({ project: writable({ layers: [], wledControllers: [] }) }));
vi.mock('../../stores/audio', () => ({ audioStore: writable({ bpm: 120, manualBPM: null }) }));
vi.mock('../../bridge', () => ({ invoke: vi.fn() }));

import { project } from '../../stores/layers';
import { invoke } from '../../bridge';
import { showTimeline, setShowCompositionLoader, setShowTrackFrameSink, currentShowTrackFrame } from '../../stores/showTimeline';
import { buildShowTrackScene, showWhereLayerId } from '../../show/tracks/showTrackScene';
import type { ShowTrackFrame } from '../../show/tracks/showTrackEval';
import type { Layer, WLEDController } from '../../types';
import { installWhereRuntime, applyContentWhere, motionContext } from './whereRuntime';
import { pieceSpots } from './spatialOrder';
import { startWLEDSenders, stopWLEDSenders, tickWLEDSenders, setWLEDForceBlack } from '../../wled/sender';
import { currentLedTimeline } from '../leds/ledRuntime';
import { normalizeWhere } from './whereModel';

const require = createRequire(import.meta.url);
const { createWledLinks } = require('../../../../electron/wled-link.cjs');
const { buildWLEDRealtimePacket } = require('../../../../electron/wled-packet.cjs');

/** A piece covering [x0, x1] of the output, full height (corners y up). */
function piece(id: string, x0: number, x1: number): Layer {
  return {
    id, name: id, type: 'shader', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null,
    corners: { topLeft: { x: x0, y: 1 }, topRight: { x: x1, y: 1 }, bottomLeft: { x: x0, y: 0 }, bottomRight: { x: x1, y: 0 } },
    layerShape: null,
  } as unknown as Layer;
}
const pieces = [piece('Right', 0.7, 1), piece('Left', 0, 0.3), piece('Middle', 0.35, 0.65)];

function controller(fields: Partial<WLEDController> = {}): WLEDController {
  return {
    id: 'strip', name: 'Strip', ipAddr: '127.0.0.1', port: 0, enabled: true, ledCount: 10, brightness: 1, gamma: 1,
    samplingMode: 'exact',
    mapping: { mode: 'strip', axis: 'horizontal', sourceRegion: { x: 0, y: 0, width: 1, height: 1 }, sampleRadius: 0 },
    ...fields,
  } as WLEDController;
}

// ── A fake WLED controller and the main process's send path ────────────────

let listener: dgram.Socket;
let listenPort = 0;
const packets: Buffer[] = [];
let links: ReturnType<typeof createWledLinks>;

beforeAll(async () => {
  listener = dgram.createSocket('udp4');
  listener.on('message', (m) => packets.push(m));
  await new Promise<void>((r) => listener.bind(0, '127.0.0.1', () => r()));
  listenPort = listener.address().port;
  links = createWledLinks({ confirmMs: 300 });
});
afterAll(async () => {
  links.closeAll();
  await new Promise<void>((r) => listener.close(() => r()));
});

// The stage picture the sender taps: left half green, right half blue.
const tap = {
  width: 0, height: 0,
  getContext: () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, drawImage() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (x < w / 2) data.set([0, 255, 0, 255], o);
        else data.set([0, 0, 255, 255], o);
      }
      return { data, width: w, height: h };
    },
  }),
};
const source = { width: 160, height: 90, isConnected: true } as unknown as HTMLCanvasElement;

let now = 1000;
let stopWhere: (() => void) | null = null;

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  showTimeline.activateDoc('timeline', { quiet: true });
  stopWhere = installWhereRuntime();
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { createElement: () => tap });
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string, args: any) => {
    if (command !== 'wled_send_frame') return { ok: true };
    return links.send({ controllerId: args.controllerId, name: args.name, ip: args.ip, port: args.port, packet: buildWLEDRealtimePacket(args.pixels) });
  });
});
afterEach(() => {
  stopWhere?.();
  setShowTrackFrameSink(null);
  setWLEDForceBlack(false);
  stopWLEDSenders(source);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Let the sender run a few frames and return the last packet's LEDs. */
async function lastPacketAt(t: number): Promise<number[][]> {
  showTimeline.seek(t);
  packets.length = 0;
  for (let i = 0; i < 6; i++) {
    now += 1100; // past the keepalive, so a frame always goes out
    tickWLEDSenders(source);
    await new Promise((r) => setTimeout(r, 15));
  }
  expect(packets.length).toBeGreaterThan(0);
  const p = packets[packets.length - 1];
  expect(p[0]).toBe(2); // DRGB
  const leds: number[][] = [];
  for (let i = 2; i + 2 < p.length; i += 3) leds.push([p[i], p[i + 1], p[i + 2]]);
  return leds;
}

describe('LED rows on the wire', () => {
  it('a colour block, then follow the stage, then dark; install mode black wins', async () => {
    project.set({ layers: pieces, wledControllers: [controller({ port: listenPort })] } as never);
    startWLEDSenders(source, 'native');
    showTimeline.addLedClip('led:strip', 0, { kind: 'colour', color: '#ff0000', duration: 4 });
    showTimeline.addLedClip('led:strip', 4, { kind: 'follow', duration: 4 });
    showTimeline.addLedClip('led:strip', 10, { kind: 'colour', color: '#ffffff', duration: 2 });

    const red = await lastPacketAt(1);
    expect(red).toHaveLength(10);
    expect(red.every((c) => c[0] === 255 && c[1] === 0 && c[2] === 0)).toBe(true);

    const follow = await lastPacketAt(5);
    expect(follow.slice(0, 5).every((c) => c[0] === 0 && c[1] === 255 && c[2] === 0)).toBe(true);
    expect(follow.slice(5).every((c) => c[0] === 0 && c[1] === 0 && c[2] === 255)).toBe(true);

    const after = await lastPacketAt(9);
    expect(after.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0)).toBe(true);

    setWLEDForceBlack(true);
    const blackout = await lastPacketAt(1);
    expect(blackout.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0)).toBe(true);
  });

  it('without LED blocks the controller keeps the project output', async () => {
    project.set({ layers: pieces, wledControllers: [controller({ port: listenPort })] } as never);
    startWLEDSenders(source, 'native');
    expect(currentLedTimeline()).toBeNull();
    const leds = await lastPacketAt(1);
    expect(leds[0]).toEqual([0, 255, 0]);
    expect(leds[9]).toEqual([0, 0, 255]);
  });
});

describe('where lines through the Timeline', () => {
  const frameAt = (t: number): ShowTrackFrame => {
    showTimeline.seek(t);
    return currentShowTrackFrame()!;
  };
  const wearing = (scene: Layer[], id: string) => {
    const l = scene.find((x) => x.id === id)!;
    if (!l.edgeEffects?.effects?.length) return 0;
    return Math.max(...l.edgeEffects.effects.map((e) => e.opacity ?? 1));
  };

  it('a look travels left → right across three pieces, one bar per pass', () => {
    project.set({ layers: pieces, wledControllers: [] } as never);
    const id = showTimeline.addLookClip('stripe-sweep', 'neon', 0, { duration: 12 })!;
    showTimeline.updateLookClip(id, { where: normalizeWhere({ order: 'left-right', motion: { kind: 'sweep', bars: 3 }, soft: 0, wrap: false }) }, { discrete: true });
    // 120 BPM: 3 bars = 6 s per pass, three pieces → one piece per 2 s band
    const lit = (t: number) => {
      const scene = buildShowTrackScene(pieces, frameAt(t), { sourceFor: () => null });
      return ['Left', 'Middle', 'Right'].map((p) => wearing(scene, p));
    };
    expect(lit(0.5)).toEqual([1, 0, 0]);
    expect(lit(3)).toEqual([0, 1, 0]);
    expect(lit(5.5)).toEqual([0, 0, 1]);
    // scrub back: the same picture
    expect(lit(3)).toEqual([0, 1, 0]);
  });

  it('a where line drawn as a control line drives the position', () => {
    project.set({ layers: pieces, wledControllers: [] } as never);
    const id = showTimeline.addLookClip('stripe-sweep', 'neon', 0, { duration: 12 })!;
    showTimeline.updateLookClip(id, { where: normalizeWhere({ motion: { kind: 'drawn' }, soft: 0, position: 1 }) }, { discrete: true });
    const scene = buildShowTrackScene(pieces, frameAt(1), { sourceFor: () => null });
    expect(['Left', 'Middle', 'Right'].map((p) => wearing(scene, p))).toEqual([0, 0, 1]);
  });

  it('a look reaches the LED strips after the pieces (projection + LEDs in one order)', async () => {
    project.set({ layers: pieces, wledControllers: [controller({ port: listenPort, mapping: { mode: 'strip', axis: 'horizontal', sourceRegion: { x: 0.9, y: 0.9, width: 0.1, height: 0.1 } } })] } as never);
    startWLEDSenders(source, 'native');
    const id = showTimeline.addLookClip('stripe-sweep', 'neon', 0, { duration: 16 })!;
    showTimeline.updateLookClip(id, { where: normalizeWhere({ order: 'left-right', members: 'both', motion: { kind: 'sweep', bars: 4 }, soft: 0 }) }, { discrete: true });
    // 4 slots (Left, Middle, Right, strip) over 8 s: 2 s each
    const scene = buildShowTrackScene(pieces, frameAt(1), { sourceFor: () => null });
    expect(wearing(scene, 'Left')).toBe(1);
    const dark = await lastPacketAt(1);
    expect(dark.every((c) => c.every((v) => v === 0))).toBe(true);
    const onStrip = await lastPacketAt(7);
    expect(onStrip.some((c) => c.some((v) => v > 0))).toBe(true);
    const scene7 = buildShowTrackScene(pieces, frameAt(7), { sourceFor: () => null });
    expect(['Left', 'Middle', 'Right'].map((p) => wearing(scene7, p))).toEqual([0, 0, 0]);
  });

  it('a content block with a where line goes over the other lit pieces, its own piece scaled', () => {
    const frame: ShowTrackFrame = {
      time: 1, playing: false, seekGeneration: 0, manualClock: false,
      tracks: [{
        trackId: 'row:Left', layerId: 'Left', layerName: 'Left', template: null, gap: 'hide', params: null, warm: null, opacity: 1,
        clip: { clipId: 'c1', runId: 'c1', runStart: 0, media: { kind: 'image', name: 'a', src: '/a.png' }, mediaTime: 1, paused: false, held: false, rate: 1, loopStart: 0, localTime: 1 },
      }],
    };
    const tracks = [{ id: 'row:Left', layerId: 'Left', clips: [{ id: 'c1', startTime: 0, duration: 10, where: normalizeWhere({ motion: { kind: 'drawn' }, position: 1, soft: 0 }) }] }] as never;
    applyContentWhere(frame, { time: 1, tracks, spots: pieceSpots(pieces), ctx: motionContext(null), lines: null });
    expect(frame.tracks[0].opacity).toBe(0);
    expect(frame.tracks[0].whereCopies).toEqual([{ pieceId: 'Right', opacity: 1 }]);
    const img = { id: 'img', type: 'image', src: '/a.png' } as never;
    const scene = buildShowTrackScene(pieces, frame, { sourceFor: () => img });
    const copy = scene.find((l) => l.id === showWhereLayerId('Right', 'c1'))!;
    expect(copy).toBeTruthy();
    expect(copy.source).toBe(img);
    expect(scene.indexOf(copy)).toBe(scene.findIndex((l) => l.id === 'Right') - 1); // directly over it
    expect(scene.find((l) => l.id === 'Left')!._showOpacityMul).toBe(0);
  });

  it('LED blocks, where lines and named orders save with the Timeline and undo', () => {
    showTimeline.addLedClip('led:strip', 2, { kind: 'chase', color: '#00ff00', where: { motion: { kind: 'random', every: 'bar', seed: 4 } } as never });
    showTimeline.setWhereOrders([{ id: 'n1', name: 'Facade', order: 'hand', hand: ['Left', 'Right'] }]);
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    expect(saved.version).toBe(7);
    expect(saved.timeline.ledClips).toHaveLength(1);
    expect(saved.timeline.ledClips[0].where.motion).toEqual({ kind: 'random', every: 'bar', seed: 4 });
    expect(saved.timeline.whereOrders[0].name).toBe('Facade');
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    showTimeline.activateDoc('timeline', { quiet: true });
    const s = (showTimeline as any);
    expect(s.findLedClip(saved.timeline.ledClips[0].id)?.kind).toBe('chase');
    // an old file (version 5) without them opens with none
    const old = { ...saved, version: 5, timeline: { ...saved.timeline, version: 5, ledClips: undefined, whereOrders: undefined } };
    showTimeline.hydrate(old);
    showTimeline.activateDoc('timeline', { quiet: true });
    expect(s.findLedClip(saved.timeline.ledClips[0].id)).toBeNull();
  });
});
