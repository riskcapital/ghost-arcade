import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '$lib/bridge';
import { audioStore } from '../stores/audio';
import { abletonLink } from './abletonLink';

vi.mock('$lib/bridge', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/bridge')>()), isElectron: true, invoke: vi.fn() }));
vi.mock('../stores/audio', async () => {
  const { writable } = await import('svelte/store');
  const state = writable({ manualBPM: 120, bpm: 120 });
  return { audioStore: { ...state, setManualBPM: vi.fn((bpm: number) => state.update(s => ({ ...s, manualBPM: bpm }))) } };
});
vi.mock('../midi/midiStore', async () => {
  const { writable } = await import('svelte/store');
  return { midiStore: writable({ clockInEnabled: false, clockInRunning: false }) };
});

afterEach(async () => {
  await abletonLink.disable();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Link launch beat position', () => {
  it('adopts the session on join without broadcasting the old tempo, then sends user edits', async () => {
    vi.useFakeTimers();
    audioStore.setManualBPM(120);
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable') return { ok: true } as any;
      return { enabled: true, peers: 1, beat: 8, phase: 0, quantum: 4, tempo: 92 } as any;
    });
    await abletonLink.enable();
    expect(invoke).not.toHaveBeenCalledWith('link_set_tempo', expect.anything());
    audioStore.setManualBPM(98);
    expect(invoke).toHaveBeenCalledWith('link_set_tempo', { bpm: 98 });
  });
  it('keeps continuous multi-bar position while display phase wraps', async () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable') return { ok: true } as any;
      return { enabled: true, peers: 1, beat: 7.5, phase: 3.5, quantum: 4, tempo: 120 } as any;
    });
    expect(await abletonLink.enable()).toBe(true);
    expect(abletonLink.beatNow()).toBe(7.5);
    expect(abletonLink.phaseNow()).toBe(3.5);
    now += 500;
    expect(abletonLink.beatNow()).toBe(8.5);
    expect(abletonLink.phaseNow()).toBe(0.5);
    // Re-anchor from the next native poll without losing whole bars.
    vi.mocked(invoke).mockResolvedValue({ enabled: true, peers: 1, beat: 24.25, phase: 0.25, quantum: 4, tempo: 120 } as any);
    await vi.advanceTimersByTimeAsync(250);
    expect(abletonLink.beatNow()).toBe(24.25);
    await abletonLink.disable();
    expect(abletonLink.beatNow()).toBe(0);
  });
});

describe('Link phase anchor and output trim', () => {
  it('stamps the session state at the middle of the round trip, not on arrival', async () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable') return { ok: true } as any;
      // The reply takes 8 ms to come back.
      now += 8;
      return { enabled: true, peers: 1, beat: 16, phase: 0, quantum: 4, tempo: 120 } as any;
    });
    expect(await abletonLink.enable()).toBe(true);
    // Read 4 ms before it arrived: 4 ms at 120 BPM is 0.008 beats on from 16.
    expect(abletonLink.beatNow()).toBeCloseTo(16.008, 9);
  });

  it('keeps the trim within ±100 ms and remembers it', () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    expect(abletonLink.setOffsetMs(250)).toBe(100);
    expect(abletonLink.setOffsetMs(-12.4)).toBe(-12);
    expect(get(abletonLink).offsetMs).toBe(-12);
    expect(localStorage.getItem('ghost-arcade-ableton-link-offset-ms')).toBe('-12');
    expect(abletonLink.setOffsetMs(Number.NaN)).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('Link start/stop', () => {
  it('hears a start pushed from the main process at once, with its bar and its time on this clock', async () => {
    vi.useFakeTimers();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let push: ((ev: any) => void) | null = null;
    vi.stubGlobal('window', { electronAPI: { on: (channel: string, cb: (ev: any) => void) => { if (channel === 'link-event') push = cb; return () => { push = null; }; } } });
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable') return { ok: true } as any;
      // Link's clock reads 50 s while this one reads 1000 ms (a 2 ms round trip).
      now += 2;
      return { enabled: true, peers: 1, beat: 30, phase: 2, quantum: 4, tempo: 120, playing: false, micros: 50_000_000, playingMicros: 40_000_000, playingBeat: 10 } as any;
    });
    const heard: any[] = [];
    const off = abletonLink.onTransport((c) => heard.push(c));
    expect(await abletonLink.enable()).toBe(true);
    // Where the session already is is not a change.
    expect(heard).toEqual([]);
    expect(push).not.toBeNull();
    // Live starts on beat 32, 1 s on (Link 51 s), heard 0.4 ms after.
    now = 2001.4;
    push!({ type: 'startStop', enabled: true, peers: 1, beat: 32.0008, phase: 0.0008, quantum: 4, tempo: 120, playing: true, micros: 51_000_400, playingMicros: 51_000_000, playingBeat: 32 });
    expect(heard).toHaveLength(1);
    expect(heard[0].playing).toBe(true);
    expect(heard[0].beat).toBe(32);
    expect(heard[0].atMs).toBeCloseTo(2001, 6);
    expect(get(abletonLink).playing).toBe(true);
    // The next poll reads the same start: not told twice.
    vi.mocked(invoke).mockResolvedValue({ enabled: true, peers: 1, beat: 32.5, phase: 0.5, quantum: 4, tempo: 120, playing: true, micros: 51_250_000, playingMicros: 51_000_000, playingBeat: 32 } as any);
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toHaveLength(1);
    off();
    await abletonLink.disable();
    expect(push).toBeNull();
    vi.unstubAllGlobals();
  });

  it('a poll tells a stop when no push came (an older addon)', async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable') return { ok: true } as any;
      return { enabled: true, peers: 1, beat: 8, phase: 0, quantum: 4, tempo: 120, playing: true } as any;
    });
    const heard: any[] = [];
    const off = abletonLink.onTransport((c) => heard.push(c));
    await abletonLink.enable();
    vi.mocked(invoke).mockResolvedValue({ enabled: true, peers: 1, beat: 9, phase: 1, quantum: 4, tempo: 120, playing: false } as any);
    await vi.advanceTimersByTimeAsync(250);
    expect(heard).toEqual([{ playing: false, beat: null, atMs: null, peers: 1 }]);
    off();
  });

  it('starts the session on a bar, stops it, and remembers the setting', async () => {
    const kept = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => kept.set(k, v) });
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'link_enable' || command.startsWith('link_set_playing')) return { ok: true } as any;
      return { enabled: true, peers: 1, beat: 8, phase: 0, quantum: 4, tempo: 120 } as any;
    });
    expect(await abletonLink.setPlaying(true, 16)).toBe(false); // Link off: nothing is sent
    await abletonLink.enable();
    vi.mocked(invoke).mockClear();
    expect(await abletonLink.setPlaying(true, 16)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('link_set_playing_at_beat', { playing: true, beat: 16, quantum: 4 });
    expect(await abletonLink.setPlaying(false)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('link_set_playing', { playing: false });
    abletonLink.setStartStopSync(true);
    expect(get(abletonLink).startStopSync).toBe(true);
    expect(kept.get('ghost-arcade-ableton-link-start-stop-sync')).toBe('1');
    abletonLink.setStartStopSync(false);
    expect(kept.get('ghost-arcade-ableton-link-start-stop-sync')).toBe('0');
    vi.unstubAllGlobals();
  });
});
