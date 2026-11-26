import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { invoke } from '$lib/bridge';
import { audioStore } from '../stores/audio';
import { abletonLink } from './abletonLink';

vi.mock('$lib/bridge', () => ({ isElectron: true, invoke: vi.fn() }));
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
