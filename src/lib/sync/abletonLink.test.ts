import { afterEach, describe, expect, it, vi } from 'vitest';
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
