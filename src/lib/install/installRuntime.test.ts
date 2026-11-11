/**
 * The install runtime's show handling with a fake transport: a playlist
 * advance still loading when install mode is left does not start the next
 * item; the off time stops the document that was started even if Play was
 * changed since; a show following timecode is not restarted (nor logged)
 * every few seconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const logs: string[] = [];
vi.mock('../bridge', () => ({
  isDesktopApp: false,
  invoke: vi.fn(async (cmd: string, args?: { kind?: string; message?: string }) => {
    if (cmd === 'install_log' && args) logs.push(`${args.kind}: ${args.message}`);
    return null;
  }),
}));
vi.mock('../show/cueList', () => ({ cueList: { go: vi.fn(), stop: vi.fn() } }));
vi.mock('../show/projectors', () => ({ projectors: { ...writable({ projectors: [], status: {} }), command: vi.fn() } }));
vi.mock('../show/showControlRuntime', () => ({ setBlackout: vi.fn() }));
vi.mock('../wled/sender', () => ({ setWLEDForceBlack: vi.fn() }));
vi.mock('../stores/screens', () => ({ screens: writable([]) }));
const startupInfo = writable<unknown>(null);
vi.mock('../show/showStartup', () => ({ showStartupInfo: startupInfo }));

const { startInstallRuntime } = await import('./installRuntime');
const { setInstallTransport } = await import('./installTransport');
import type { InstallDocument, InstallTransport } from './installTransport';
import type { ShowStartupConfig } from '../show/showStartup';

function transport() {
  const st = { show: { playing: false, time: 0, duration: 30, loop: false }, timeline: { playing: false, time: 0, duration: 30, loop: false } };
  let follows = false;
  const t: InstallTransport & { played: InstallDocument[]; stopped: InstallDocument[]; st: typeof st; follow: (v: boolean) => void } = {
    played: [], stopped: [], st,
    follow: (v) => { follows = v; },
    setActiveDocument: () => {},
    play: (d) => { t.played.push(d); st[d].playing = true; },
    stop: (d) => { t.stopped.push(d); st[d].playing = false; },
    seek: (d, s) => { st[d].time = s; },
    setLoop: (d, l) => { st[d].loop = l; },
    state: (d) => ({ ...st[d] }),
    controllable: () => !follows,
  };
  return t;
}

const base = (over: Partial<ShowStartupConfig>): ShowStartupConfig => ({
  launchAtLogin: false, showMode: true, projectPath: '', openOutputs: false, autoStart: 'timeline', suppressPrompts: true,
  document: 'timeline', playlist: [], loopShow: true, schedule: { enabled: false } as never, watchdog: true, relaunchOnCrash: true,
  resume: 'start', hideCursor: true, quitProtection: 'confirm', ...over,
});

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  logs.length = 0;
  startupInfo.set(null);
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
});
afterEach(() => {
  vi.restoreAllMocks();
  setInstallTransport(null);
  vi.useRealTimers();
});

describe('install runtime', () => {
  it('leaving install mode while the next playlist item loads does not start it', async () => {
    const t = transport();
    setInstallTransport(t);
    let release!: (ok: boolean) => void;
    let calls = 0;
    const openProject = vi.fn(() => (++calls === 1 ? Promise.resolve(true) : new Promise<boolean>((r) => { release = r; })));
    const stop = startInstallRuntime(base({ autoStart: 'playlist', playlist: [{ path: '/a.gaproj', document: 'timeline' }, { path: '/b.gaproj', document: 'show' }] }), { openProject, openMainOutput: async () => {} });
    await vi.advanceTimersByTimeAsync(300);
    await flush();
    expect(t.played).toEqual(['timeline']);
    // Item 1 ends.
    t.st.timeline.playing = false;
    t.st.timeline.time = 30;
    await vi.advanceTimersByTimeAsync(1000);
    expect(openProject).toHaveBeenCalledTimes(2);
    stop();
    release(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.played).toEqual(['timeline']);
  });

  it('the document started is the one stopped, even after Play was changed', async () => {
    const t = transport();
    setInstallTransport(t);
    const stop = startInstallRuntime(base({ autoStart: 'timeline', document: 'timeline' }), { openProject: async () => true, openMainOutput: async () => {} });
    await vi.advanceTimersByTimeAsync(300);
    expect(t.played).toEqual(['timeline']);
    startupInfo.set({ config: base({ autoStart: 'nothing' as never }) });
    // Off for the night: what the runner does at the off time.
    const runtime = stop as unknown as () => void;
    startupInfo.set({ config: base({ autoStart: 'nothing' as never, schedule: { enabled: true, days: Array.from({ length: 7 }, () => ({ enabled: false, on: '00:00', off: '00:00' })), projectorPower: false, shutter: false, warmupSeconds: 0 } as never }) });
    await vi.advanceTimersByTimeAsync(1100);
    expect(t.stopped).toContain('timeline');
    runtime();
  });

  it('a show following timecode is neither restarted nor logged every few seconds', async () => {
    const t = transport();
    t.follow(true);
    setInstallTransport(t);
    const stop = startInstallRuntime(base({ autoStart: 'timeline' }), { openProject: async () => true, openMainOutput: async () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.played).toEqual([]);
    expect(logs.filter((l) => /follows timecode/.test(l)).length).toBeLessThanOrEqual(1);
    expect(logs.filter((l) => /starting it again/.test(l))).toEqual([]);
    stop();
  });
});
