import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

/*
 * vjClipLauncher pulls in the settings store, which paints CSS variables onto
 * document.documentElement at import time. There is no DOM environment in this
 * suite (no jsdom), so stand up just enough of one to get through the import
 * rather than adding a dependency for a clock test.
 */
if (typeof globalThis.document === 'undefined') {
  const noopStyle = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' };
  (globalThis as any).document = {
    documentElement: { style: noopStyle, classList: { add() {}, remove() {}, toggle() {} } },
    body: { style: noopStyle },
    createElement: () => ({ style: noopStyle, setAttribute() {}, appendChild() {} }),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

/**
 * Clip launch quantization must follow Ableton Link's PHASE, not just its
 * tempo.
 *
 * Reported by a Traktor user: the BPM matched the Link session exactly, but
 * clips fired off the beat, and there was no way to tell whether the phase,
 * the quantum or an offset was at fault. The cause was that Link bridged only
 * its tempo into the app; the quantization clock still anchored to the app's
 * own audio-detected beat, or to an arbitrary epoch when audio was off. Two
 * clocks at the same speed with unrelated downbeats.
 */

const linkState = writable({
  available: true,
  enabled: false,
  peers: 0,
  tempo: 120,
  playing: true,
  phase: 0,
  quantum: 4,
  error: null as string | null,
});
let linkPhaseNow = 0;

vi.mock('../sync/abletonLink', () => ({
  abletonLink: {
    subscribe: (run: (v: unknown) => void) => linkState.subscribe(run),
    phaseNow: () => linkPhaseNow,
  },
}));

const audioState = writable({
  isActive: false,
  bpm: 0,
  manualBPM: null as number | null,
  beat: { beatCount: 0, timeSinceLastBeat: -1 },
});

// vjLayerSequencer (pulled in transitively) also imports currentBPM, so the
// mock has to cover the module's real surface, not just what we assert on.
vi.mock('./audio', () => {
  const audioStore = { subscribe: (run: (v: unknown) => void) => audioState.subscribe(run) };
  const bpm = writable(120);
  return {
    audioStore,
    currentBPM: { subscribe: (run: (v: number) => void) => bpm.subscribe(run) },
    isBeat: { subscribe: (run: (v: boolean) => void) => writable(false).subscribe(run) },
    beatPhase: { subscribe: (run: (v: number) => void) => writable(0).subscribe(run) },
    audioBands: { subscribe: (run: (v: unknown) => void) => writable({}).subscribe(run) },
    getLastRawAnalysis: () => null,
  };
});

const { nextQuantumWallTime } = await import('./vjClipLauncher');

function setLink(patch: Record<string, unknown>) {
  linkState.update((s) => ({ ...s, ...patch }));
}

describe('clip quantization under Ableton Link', () => {
  beforeEach(() => {
    linkPhaseNow = 0;
    setLink({ enabled: false, peers: 0, tempo: 120, quantum: 4 });
    audioState.set({
      isActive: false,
      bpm: 0,
      manualBPM: null,
      beat: { beatCount: 0, timeSinceLastBeat: -1 },
    });
  });

  it('uses the session tempo, not the local one, for the grid', () => {
    audioState.update((a) => ({ ...a, manualBPM: 90 }));
    setLink({ enabled: true, peers: 2, tempo: 128, quantum: 4 });
    linkPhaseNow = 0;

    const now = performance.now();
    // One beat at 128 BPM is 468.75ms; at the local 90 BPM it would be 666ms.
    const wait = nextQuantumWallTime('1/4') - now;
    expect(wait).toBeGreaterThan(400);
    expect(wait).toBeLessThan(520);
  });

  it('fires on the session downbeat when a bar is requested', () => {
    setLink({ enabled: true, peers: 1, tempo: 120, quantum: 4 });
    // Three beats into a four-beat bar: one beat left until the downbeat.
    linkPhaseNow = 3;

    const now = performance.now();
    const wait = nextQuantumWallTime('1bar') - now;
    // 500ms per beat at 120 BPM.
    expect(wait).toBeGreaterThan(400);
    expect(wait).toBeLessThan(600);
  });

  it('waits nearly a full bar when the downbeat has just passed', () => {
    setLink({ enabled: true, peers: 1, tempo: 120, quantum: 4 });
    linkPhaseNow = 0.05;

    const wait = nextQuantumWallTime('1bar') - performance.now();
    expect(wait).toBeGreaterThan(1800);
    expect(wait).toBeLessThan(2100);
  });

  it('ignores Link when it is enabled but has no peers', () => {
    // Enabled with nobody to sync to is not a session; the local clock is
    // still the best available answer.
    audioState.update((a) => ({ ...a, manualBPM: 60 }));
    setLink({ enabled: true, peers: 0, tempo: 128 });
    linkPhaseNow = 3.9;

    const wait = nextQuantumWallTime('1/4') - performance.now();
    // A 60 BPM beat is 1000ms, so this cannot have come from Link's 128.
    expect(wait).toBeGreaterThan(520);
  });

  it('returns immediately when quantization is off', () => {
    setLink({ enabled: true, peers: 2, tempo: 128 });
    expect(nextQuantumWallTime('off') - performance.now()).toBeLessThan(2);
  });
});
