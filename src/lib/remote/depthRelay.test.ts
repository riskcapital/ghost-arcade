import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importPhoneServer, type PhoneServer } from './phoneServerUnderTest';
import { WebSocket } from 'ws';
import { createRequire } from 'node:module';
import { dirInProjector, inProjector } from '../scene3d/roomFixtures';
import { add, cross, dot, facePoint, faceNormal, length, normalize, scale, sub, type RoomFace } from '../scene3d/roomModel';
import { roomFromCapture } from '../scene3d/roomPhone';
import { projectorBasis, projectPoint } from '../scene3d/worldGeometry';
import type { Vec3 } from '../scene3d/sceneModel';
import { parseDepthCaptureOffer } from '../mobile/studio/depthCaptureOffer';
import { answersDepthScan, scanPhones, stepDepthScan, type DepthScanFlow } from '../mobile/studio/depthScanFlow';

/**
 * A room scan for Depth mode over the real pairing server: the desktop asks
 * a phone for it, the phone reports progress and sends it, the desktop solves
 * it. The scan is synthetic: one 1 m box on the floor, three faces seen by a
 * projector whose place and lens are known, measured in a phone frame that is
 * turned and moved against the room (as ARKit's is).
 */
const require = createRequire(import.meta.url);
const { depthMessageAllowed, depthMessageEnds, HOST_MESSAGES } = require('../../../server/remote-access.cjs');

const TOKEN = 'ABCD0EFGH1JKMN2P';
const HOST = 'host-secret-'.repeat(6);
const ASPECT = 16 / 9;
let server: PhoneServer;
let wsPort = 0;
let host: WebSocket;
const toDesktop: any[] = [];
const quiet: Array<{ mockRestore(): void }> = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?pair=${TOKEN}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
const inbox = (ws: WebSocket) => {
  const got: any[] = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  return got;
};
async function until<T>(find: () => T | undefined, ms = 2000): Promise<T> {
  for (let t = 0; t < ms; t += 20) {
    const hit = find();
    if (hit !== undefined) return hit;
    await pause(20);
  }
  throw new Error('timed out');
}

// ── The synthetic scan ────────────────────────────────────────────────────

/** A rigid turn (about an axis, degrees) and move: the phone's world against the room's. */
function rigid(axis: Vec3, deg: number, move: Vec3) {
  const k = normalize(axis), a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const turn = (v: Vec3): Vec3 => add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  return { point: (p: Vec3) => add(turn(p), move), dir: turn };
}
const TRUTH = { position: [1.6, 2.1, 3.4] as Vec3, target: [0, 0.45, 0] as Vec3, fov: 32, shift: [0.05, 0.3] as [number, number] };
function boxScan() {
  const pr = projectorBasis(TRUTH.position, TRUTH.target, TRUTH.fov, ASPECT, TRUTH.shift);
  const sq = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
  const faces: RoomFace[] = [
    { surfaceId: 'top', role: 'top', origin: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], points: sq, depth: 1 },
    { surfaceId: 'front', role: 'side', origin: [0, 0.5, 0.5], u: [1, 0, 0], v: [0, 1, 0], points: sq, depth: 1 },
    { surfaceId: 'right', role: 'side', origin: [0.5, 0.5, 0], u: [0, 0, -1], v: [0, 1, 0], points: sq, depth: 1 },
  ];
  // All three face the projector.
  for (const f of faces) expect(dot(faceNormal(f), sub(TRUTH.position, f.origin))).toBeGreaterThan(0.1);
  const phone = rigid([0.3, 1, -0.2], 117, [-0.8, 0.35, 2.2]);
  const surfaces = faces.map((f) => {
    const samples: { p: Vec3; uv: { x: number; y: number } }[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
      const at = facePoint(f, { x: -0.45 + (i * 0.9) / 19, y: -0.45 + (j * 0.9) / 19 });
      samples.push({ p: phone.point(at), uv: projectPoint(pr, at) });
    }
    return { id: f.surfaceId, name: f.surfaceId, outline: f.points.map((p) => projectPoint(pr, facePoint(f, p))), samples };
  });
  return { pr, faces, capture: { version: 1, down: phone.dir([0, -1, 0]), surfaces, source: { device: 'Test iPhone', screen: { id: 'screen-1', width: 1920, height: 1080 }, capturedAt: '2026-11-14T21:00:00Z' } } };
}

beforeAll(async () => {
  vi.stubEnv('GA_REMOTE_BIND_HOST', '127.0.0.1');
  vi.stubEnv('WS_PORT', '0');
  vi.stubEnv('HTTP_PORT', '0');
  vi.stubEnv('GA_PAIRING_TOKEN', '');
  quiet.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  quiet.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
  server = await importPhoneServer();
  ({ wsPort } = await server.listening);
  await server.setDesktopCredential(HOST);
  await server.setPairingToken(TOKEN);
  host = await open();
  host.on('message', (d) => toDesktop.push(JSON.parse(d.toString())));
  host.send(JSON.stringify({ type: 'register_desktop', credential: HOST }));
  await until(() => toDesktop.find((m) => m.type === 'desktop_registered'));
});

afterAll(() => {
  server?.shutdownServer({ force: true });
  for (const spy of quiet) spy.mockRestore();
  vi.unstubAllEnvs();
});

describe('the depth messages', () => {
  it('only the desktop may answer or ask; sizes and stages are checked', () => {
    expect(HOST_MESSAGES.has('studio_depth_capture_status')).toBe(true);
    expect(HOST_MESSAGES.has('studio_depth_scan_request')).toBe(true);
    expect(HOST_MESSAGES.has('studio_depth_capture_offer')).toBe(false);
    expect(depthMessageAllowed({ type: 'studio_depth_capture_offer', requestId: 'a', capture: {} }, 100)).toBe(true);
    expect(depthMessageAllowed({ type: 'studio_depth_capture_offer', requestId: 'a', capture: {} }, 8_000_001)).toBe(false);
    expect(depthMessageAllowed({ type: 'studio_depth_capture_offer', requestId: 'a b', capture: {} }, 1)).toBe(false);
    expect(depthMessageAllowed({ type: 'studio_depth_scan_progress', requestId: 'a', stage: 'patterns', pct: 30 }, 0)).toBe(true);
    expect(depthMessageAllowed({ type: 'studio_depth_scan_progress', requestId: 'a', stage: 'nope' }, 0)).toBe(false);
    expect(depthMessageAllowed({ type: 'studio_depth_scan_request', requestId: 'a', to: 'p', layerId: 'L', output: { width: 1920, height: 1080 } }, 0)).toBe(true);
    expect(depthMessageAllowed({ type: 'studio_depth_scan_request', requestId: 'a', to: 'p', layerId: 'L', output: { width: 0, height: 1080 } }, 0)).toBe(false);
    expect(depthMessageEnds({ type: 'studio_depth_capture_status', state: 'received' })).toBe(false);
    expect(depthMessageEnds({ type: 'studio_depth_capture_status', state: 'applied' })).toBe(true);
  });
});

describe('a room scan through the pairing server', () => {
  it('asked for by the desktop, measured by the phone, solves to the projector it came from', async () => {
    const phone = await open(), other = await open();
    const atPhone = inbox(phone), atOther = inbox(other);
    // The phone says what it is; the desktop lists it.
    phone.send(JSON.stringify({ type: 'studio_capabilities_request', clientId: 'ph1', client: { app: 'ios', version: '1.2', build: '9' } }));
    const peers = await until(() => toDesktop.findLast((m) => m.type === 'studio_peers' && m.peers.length));
    const [target] = scanPhones(peers.peers);
    expect(target.label).toBe('iPhone · app 1.2');
    // Start on phone.
    let flow: DepthScanFlow = stepDepthScan({ kind: 'idle' }, { type: 'start', requestId: 'depth-1', phone: target.id, target: 'L1', now: 0 }).flow;
    host.send(JSON.stringify({ type: 'studio_depth_scan_request', to: target.id, requestId: 'depth-1', layerId: 'L1', output: { width: 1920, height: 1080 } }));
    const asked = await until(() => atPhone.find((m) => m.type === 'studio_depth_scan_request'));
    expect(asked).toMatchObject({ requestId: 'depth-1', layerId: 'L1', output: { width: 1920, height: 1080 } });
    expect(atOther.some((m) => m.type === 'studio_depth_scan_request')).toBe(false);
    // Another phone cannot report on this scan or send it.
    other.send(JSON.stringify({ type: 'studio_depth_scan_progress', requestId: 'depth-1', stage: 'error', message: 'forged' }));
    phone.send(JSON.stringify({ type: 'studio_depth_scan_progress', requestId: 'depth-1', stage: 'patterns', pct: 40 }));
    const progress = await until(() => toDesktop.find((m) => m.type === 'studio_depth_scan_progress'));
    expect(progress).toMatchObject({ stage: 'patterns', pct: 40 });
    expect(toDesktop.filter((m) => m.type === 'studio_depth_scan_progress')).toHaveLength(1);
    flow = stepDepthScan(flow, { ...progress, type: 'progress', now: 1 }).flow;
    // The scan.
    const truth = boxScan();
    other.send(JSON.stringify({ type: 'studio_depth_capture_offer', requestId: 'depth-1', capture: truth.capture }));
    phone.send(JSON.stringify({ type: 'studio_depth_capture_offer', requestId: 'depth-1', clientId: 'ph1', capture: truth.capture }));
    const arrived = await until(() => toDesktop.find((m) => m.type === 'studio_depth_capture_offer'));
    await pause(60);
    expect(toDesktop.filter((m) => m.type === 'studio_depth_capture_offer')).toHaveLength(1);
    expect(arrived.from).toBe(target.id);
    // It is the scan the desktop asked for: applied without a prompt.
    expect(answersDepthScan(flow, arrived.requestId)).toBe(true);
    flow = stepDepthScan(flow, { type: 'offer', requestId: arrived.requestId }).flow;
    const offer = parseDepthCaptureOffer(arrived, JSON.stringify(arrived.capture).length);
    const { room, report } = roomFromCapture(offer.capture, ASPECT, (id) => `scan:${id}`);
    // The lens.
    expect(Math.abs(report.fov - TRUTH.fov)).toBeLessThan(0.01);
    expect(report.shift.x).toBeCloseTo(TRUTH.shift[0], 4);
    expect(report.shift.y).toBeCloseTo(TRUTH.shift[1], 4);
    expect(report.pixelError).toBeLessThan(0.01);
    expect(report.planeError).toBeLessThan(1e-6);
    // The pose: down, and every face's corners where they are as the projector sees them.
    const deg = (a: Vec3, b: Vec3) => (Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) * 180) / Math.PI;
    expect(deg(room.down, dirInProjector(truth.pr, [0, -1, 0]))).toBeLessThan(0.01);
    expect(room.faces.map((f) => [f.surfaceId, f.role])).toEqual([['scan:top', 'top'], ['scan:front', 'side'], ['scan:right', 'side']]);
    for (const f of truth.faces) {
      const solved = room.faces.find((x) => x.surfaceId === `scan:${f.surfaceId}`)!;
      expect(deg(faceNormal(solved), dirInProjector(truth.pr, faceNormal(f)))).toBeLessThan(0.01);
      solved.points.forEach((p, i) => expect(length(sub(facePoint(solved, p), inProjector(truth.pr, facePoint(f, f.points[i]))))).toBeLessThan(0.001));
    }
    // The projector's distance to the box, from the solve: 1 mm.
    expect(Math.abs(length(inProjector(truth.pr, [0, 0.5, 0])) - length(sub(TRUTH.position, [0, 0.5, 0])))).toBeLessThan(0.001);
    flow = stepDepthScan(flow, { type: 'applied', requestId: 'depth-1', summary: `Scanned ${room.faces.length} faces.` }).flow;
    expect(flow.kind).toBe('applied');
    // The phone hears the answer; the other phone does not.
    host.send(JSON.stringify({ type: 'studio_depth_capture_status', requestId: 'depth-1', state: 'applied', message: 'Scanned 3 faces.' }));
    expect(await until(() => atPhone.find((m) => m.type === 'studio_depth_capture_status'))).toMatchObject({ state: 'applied' });
    await pause(40);
    expect(atOther.some((m) => m.type === 'studio_depth_capture_status')).toBe(false);
    // A phone cannot forge the desktop's answer.
    phone.send(JSON.stringify({ type: 'studio_depth_capture_status', requestId: 'depth-1', state: 'applied' }));
    await pause(40);
    expect(toDesktop.some((m) => m.type === 'studio_depth_capture_status')).toBe(false);
    // The phone leaves: the desktop's list empties.
    phone.close();
    expect(await until(() => toDesktop.findLast((m) => m.type === 'studio_peers' && !m.peers.length))).toBeTruthy();
    other.close();
  });

  it('a scan started on the phone reaches the desktop stamped with who sent it; asking a phone that left fails at once', async () => {
    const phone = await open();
    const { capture } = boxScan();
    phone.send(JSON.stringify({ type: 'studio_depth_capture_offer', requestId: 'own-1', clientId: 'p2', capture }));
    const arrived = await until(() => toDesktop.find((m) => m.type === 'studio_depth_capture_offer' && m.requestId === 'own-1'));
    expect(arrived.from).toMatch(/:p2$/);
    host.send(JSON.stringify({ type: 'studio_depth_scan_request', to: 'gone:x', requestId: 'depth-2', layerId: 'L1', output: { width: 1920, height: 1080 } }));
    expect(await until(() => toDesktop.find((m) => m.type === 'studio_depth_scan_progress' && m.requestId === 'depth-2'))).toMatchObject({ stage: 'error' });
    phone.close();
  });
});
