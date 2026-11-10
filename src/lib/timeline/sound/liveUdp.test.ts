/**
 * Live clip blocks over the real wire: the scheduler's requests go through
 * the app's own UDP bridge (electron/ableton-bridge.cjs) to a fake Live
 * script listening on loopback, in real time. Ports are moved with
 * GA_ABLETON_APP_PORT / GA_ABLETON_SCRIPT_PORT so nothing reaches a real
 * Live set on this machine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';
import { createTempoMap } from '../../show/tempoMap';
import { fireLead, LiveClipScheduler, type LiveCommand } from './liveSchedule';

const require = createRequire(import.meta.url);
const APP_PORT = 42000 + Math.floor(Math.random() * 2000);
const SCRIPT_PORT = APP_PORT + 1;

interface Received { at: number; msg: Record<string, unknown> }

let bridge: { start(win: unknown): Promise<{ ok: boolean }>; stop(): void; send(m: unknown): { ok: boolean }; SCRIPT_PORT: number; APP_PORT: number };
let peer: dgram.Socket;
const received: Received[] = [];
let t0 = 0;
const showTime = () => (performance.now() - t0) / 1000;

beforeAll(async () => {
  process.env.GA_ABLETON_APP_PORT = String(APP_PORT);
  process.env.GA_ABLETON_SCRIPT_PORT = String(SCRIPT_PORT);
  bridge = require('../../../../electron/ableton-bridge.cjs');
  expect(bridge.APP_PORT).toBe(APP_PORT);
  expect(bridge.SCRIPT_PORT).toBe(SCRIPT_PORT);
  peer = dgram.createSocket('udp4');
  peer.on('message', (buf) => received.push({ at: showTime(), msg: JSON.parse(buf.toString('utf8')) }));
  await new Promise<void>((resolve) => peer.bind(SCRIPT_PORT, '127.0.0.1', () => resolve()));
  const fakeWindow = { isDestroyed: () => false, webContents: { send() {} } };
  const started = await bridge.start(fakeWindow);
  expect(started.ok).toBe(true);
});

afterAll(() => {
  bridge?.stop();
  peer?.close();
  delete process.env.GA_ABLETON_APP_PORT;
  delete process.env.GA_ABLETON_SCRIPT_PORT;
});

describe('Live clip blocks against a fake Live script (UDP)', () => {
  it('two Live rows, clips at bar 1 and bar 3: fires arrive one grid step ahead, stops at the end, stop all on Stop', async () => {
    // 240 BPM: a beat is 0.25 s, a bar 1 s. Drums from bar 1, bass from bar 3, both to bar 5.
    const tempo = createTempoMap(240, 0);
    const scheduler = new LiveClipScheduler({ send: (cmd: LiveCommand) => bridge.send(cmd) });
    scheduler.setEnv({ tempo, setQuantize: 4, numerator: 4, denominator: 4, protocol: 5 });
    scheduler.setBlocks(
      [
        { rowId: 'drums', track: 0, launch: 'beat', latency: 0.02, audible: true },
        { rowId: 'bass', track: 1, launch: 'beat', latency: 0.02, audible: true },
      ],
      [
        { id: 'd', rowId: 'drums', start: 0, end: 4, slot: 0 },
        { id: 'b', rowId: 'bass', start: 2, end: 4, slot: 3 },
      ],
    );
    // The show starts half a second before bar 1 and plays past bar 5.
    t0 = performance.now() + 500;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const t = showTime();
        scheduler.tick(t, true, 0);
        if (t > 4.3) {
          clearInterval(timer);
          scheduler.tick(t, false, 0);
          resolve();
        }
      }, 1000 / 60);
    });
    await new Promise((r) => setTimeout(r, 50));

    const lead = fireLead(0.25, 0.02);
    const fires = received.filter((r) => r.msg.t === 'fire_clip');
    expect(fires.map((f) => [f.msg.i, f.msg.s, f.msg.q])).toEqual([[0, 0, 7], [1, 3, 7]]);
    // Each fire arrives inside the beat before its block, early enough for a
    // script tick (0.1 s) — so Live starts it exactly on the block's beat.
    for (const [fire, start] of [[fires[0], 0], [fires[1], 2]] as const) {
      expect(fire.at).toBeGreaterThan(start - 0.25);
      expect(start - fire.at).toBeGreaterThan(0.1);
      expect(Math.abs(fire.at - (start - lead))).toBeLessThan(0.05);
    }
    const stops = received.filter((r) => r.msg.t === 'stop_track');
    expect(stops.map((s) => s.msg.i).sort()).toEqual([0, 1]);
    for (const s of stops) expect(Math.abs(s.at - (4 - 0.07))).toBeLessThan(0.05);
    const last = received[received.length - 1];
    expect(last.msg).toEqual({ t: 'stop_all', q: 0 });
  }, 15000);
});
