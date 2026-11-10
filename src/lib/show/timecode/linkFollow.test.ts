/**
 * Following Ableton Link through the chase controller, against a fake
 * session behind `link_get_state`: Stop in quantised start returns to the
 * top and stays there, a parked show can be moved, Play without a session
 * to start says why nothing happens, and the beat is read against the
 * show's bar length.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const session = { playing: true, tempo: 240, peers: 1, beatAt0: 0, t0: 0, latencyMs: 20 };
const calls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('../../bridge', () => ({
  isElectron: true,
  invoke: vi.fn(async (cmd: string, args?: { quantum?: number }) => {
    calls.push({ cmd, args });
    if (cmd !== 'link_get_state') return { ok: true };
    // An IPC round trip: the state is read half way through it.
    await new Promise((r) => setTimeout(r, session.latencyMs / 2));
    const quantum = args?.quantum ?? 4;
    const beat = session.beatAt0 + ((performance.now() - session.t0) / 60000) * session.tempo;
    const state = { enabled: true, beat, tempo: session.tempo, playing: session.playing, peers: session.peers, quantum };
    await new Promise((r) => setTimeout(r, session.latencyMs / 2));
    return state;
  }),
}));
vi.mock('../../sync/abletonLink', async () => {
  const { readable } = await import('svelte/store');
  return { abletonLink: Object.assign(readable({ enabled: true }), { enable: async () => true }) };
});

const { timecodeChase, normalizeTimecodeSettings } = await import('./timecodeChase');
const { showTimeline, setShowChaseTransportHandler } = await import('../../stores/showTimeline');
const { createTempoMap } = await import('../tempoMap');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw new Error('timed out');
    await sleep(10);
  }
}

function follow(map: ReturnType<typeof createTempoMap>, linkMode: 'startStop' | 'quantisedStart') {
  showTimeline.hydrate({ presetClips: [{ id: 'a', compositionId: 'A', startTime: 0, duration: 120, transitionIn: 'cut', transitionDuration: 0 }] });
  timecodeChase.setShowContext(() => ({ map, playhead: get(showTimeline).currentTime, playing: get(showTimeline).isPlaying }));
  timecodeChase.setSink((sample) => {
    if (sample.showTime !== null && (sample.lock === 'locked' || sample.lock === 'freewheel')) showTimeline.chase(sample.showTime, sample.running, sample.rate);
  });
  setShowChaseTransportHandler((op) => timecodeChase.transport(op));
  timecodeChase.configure({ source: 'link', linkMode });
}

/** Put the session `beatsToBar` beats before a bar line of `quantum`. */
function sessionNearBar(beatsToBar: number, quantum = 4) {
  session.t0 = performance.now();
  session.beatAt0 = 25 * quantum - beatsToBar;
}

beforeEach(() => {
  calls.length = 0;
  Object.assign(session, { playing: true, tempo: 240, peers: 1 });
  sessionNearBar(2);
});

afterEach(() => {
  timecodeChase.setSink(null);
  timecodeChase.setShowContext(null);
  setShowChaseTransportHandler(null);
  timecodeChase.shutdown();
  timecodeChase.settings.set(normalizeTimecodeSettings({}));
  showTimeline._resetForTest();
});

describe('Link through the chase controller', () => {
  it('quantised start: Stop goes back to the top and stays there', async () => {
    follow(createTempoMap(240, 0), 'quantisedStart');
    await sleep(80);
    showTimeline.seek(3);
    sessionNearBar(0.4);
    showTimeline.play();
    await until(() => get(showTimeline).isPlaying);
    await sleep(150);
    showTimeline.stop();
    expect(get(showTimeline)).toMatchObject({ isPlaying: false, currentTime: 0 });
    await sleep(250);
    expect(get(showTimeline)).toMatchObject({ isPlaying: false, currentTime: 0 });
  });

  it('parked: a seek is not pulled back by the polls', async () => {
    session.playing = false;
    follow(createTempoMap(120, 0), 'startStop');
    await sleep(150);
    showTimeline.seek(10);
    await sleep(250);
    expect(get(showTimeline).currentTime).toBe(10);
    showTimeline.seek(20);
    await sleep(100);
    expect(get(showTimeline).currentTime).toBe(20);
  });

  it('following the session start: Play says why nothing happens', async () => {
    session.playing = false;
    session.peers = 0;
    follow(createTempoMap(120, 0), 'startStop');
    await sleep(150);
    showTimeline.play();
    await until(() => get(timecodeChase.status).notice !== null);
    expect(get(timecodeChase.status).notice).toBe('linkNoPeers');
    expect(get(showTimeline).isPlaying).toBe(false);
    session.peers = 2;
    await sleep(150);
    showTimeline.play();
    await until(() => get(timecodeChase.status).notice === 'linkStartsWithSession');
    // The session starts: the notice goes.
    session.playing = true;
    await until(() => get(showTimeline).isPlaying);
    await until(() => get(timecodeChase.status).notice === null);
  });

  it('reads the beat against the show bar length (6/8: 3 quarters)', async () => {
    follow(createTempoMap(120, 0, 6, 8), 'startStop');
    await until(() => calls.some((c) => c.cmd === 'link_get_state'));
    const asked = calls.filter((c) => c.cmd === 'link_get_state').map((c) => (c.args as { quantum?: number })?.quantum);
    expect(asked[0]).toBe(3);
  });
});
