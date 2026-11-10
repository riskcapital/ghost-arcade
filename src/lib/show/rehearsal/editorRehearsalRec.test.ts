import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const h = vi.hoisted(() => ({
  discards: [] as string[],
  sidecars: 0,
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => ({ success: true })),
  setOutputDelay: vi.fn(),
}));

vi.mock('../../stores/showTimeline', async () => {
  const { writable } = await import('svelte/store');
  const store = writable({
    duration: 60, currentTime: 0, isPlaying: false, loop: false, tempo: null,
    audioTracks: [{ id: 'a', url: 'file:///song.wav', muted: false, volume: 1, startTime: 0, duration: 600, offset: 0 }],
    presetClips: [], cameraLane: [],
  });
  let gen = 1;
  return {
    showTimeline: {
      subscribe: store.subscribe,
      set: (patch: Record<string, unknown>) => store.update((s) => ({ ...s, ...patch })),
      seekGeneration: () => gen,
      bumpGeneration: () => { gen++; },
      isChasing: () => false,
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), setLoop: vi.fn(),
    },
  };
});
vi.mock('../../stores/layers', async () => {
  const { writable } = await import('svelte/store');
  return { project: writable({ compositions: [] }) };
});
vi.mock('../../recording/recorder', () => ({
  muxSidecarAudio: vi.fn(async () => true),
  startRecordingAudioSidecar: vi.fn(() => {
    const id = `sidecar-${++h.sidecars}`;
    return { stop: async () => null, discard: () => h.discards.push(id) };
  }),
}));
vi.mock('../../audio/clipAudioBus', () => ({ clipAudioBus: { setOutputDelay: h.setOutputDelay } }));
vi.mock('../showAudioExport', () => ({ showMuxTracks: vi.fn(() => [{ path: '/song.wav', startTime: 0, offset: 0, duration: 600, volume: 1 }]) }));
vi.mock('../../bridge', () => ({ invoke: h.invoke, isElectron: true }));

import { showTimeline } from '../../stores/showTimeline';
import { startRecordingAudioSidecar } from '../../recording/recorder';
import { installEditorRehearsal, rehearsalAudioDelayActive } from './editorRehearsal';
import { REHEARSAL_CHANNEL, epochNow, type RecAudioResult, type RehearsalMessage } from './rehearsalBridge';

const st = showTimeline as unknown as { set(p: Record<string, unknown>): void; bumpGeneration(): void };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('editor: stage recording sound', () => {
  let stage: BroadcastChannel;
  let heard: RehearsalMessage[];
  let uninstall: () => void;
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    h.discards.length = 0;
    h.invoke.mockClear();
    h.setOutputDelay.mockClear();
    vi.mocked(startRecordingAudioSidecar).mockClear();
    st.set({ duration: 60, currentTime: 0, isPlaying: false });
    heard = [];
    stage = new BroadcastChannel(REHEARSAL_CHANNEL);
    stage.onmessage = (e: MessageEvent<RehearsalMessage>) => heard.push(e.data);
    uninstall = installEditorRehearsal();
  });
  afterEach(() => {
    uninstall();
    stage.close();
    vi.unstubAllGlobals();
  });

  /** The stage window's clock is `skewMs` behind the editor's. */
  async function recordWhilePlaying(skewMs: number, id: string): Promise<RecAudioResult> {
    const stageNow = () => epochNow() - skewMs;
    stage.postMessage({ type: 'stage-hello', at: stageNow(), stateVersion: null, instance: 'page-1' });
    await wait(20);
    // The show plays from 10 s; the recording starts with it.
    st.bumpGeneration();
    const playAt = epochNow();
    st.set({ isPlaying: true, currentTime: 10 });
    const startedAt = stageNow();
    stage.postMessage({ type: 'rec-audio-start', id, at: startedAt, instance: 'page-1' });
    for (let i = 0; i < 40; i++) {
      await wait(20);
      st.set({ currentTime: 10 + (epochNow() - playAt) / 1000 });
    }
    const durationSeconds = (stageNow() - startedAt) / 1000;
    stage.postMessage({ type: 'rec-audio-finish', id, videoPath: '/v.mp4', startedAt, durationSeconds, latencySeconds: 0 });
    for (let i = 0; i < 100; i++) {
      await wait(10);
      const r = heard.find((m) => m.type === 'rec-audio-result' && m.id === id) as Extract<RehearsalMessage, { type: 'rec-audio-result' }> | undefined;
      if (r) return r.result;
    }
    throw new Error('no result');
  }

  it('clocks in step: the soundtrack comes straight from the song file at the right place', async () => {
    const result = await recordWhilePlaying(0, 'rec-ok');
    expect(result.mode).toBe('exact');
    const call = h.invoke.mock.calls.find((c) => c[0] === 'show_audio_mux') as unknown as [string, { tracks: { offset: number }[] }];
    expect(call).toBeTruthy();
    // The file starts where the show was: 10 s into the song.
    expect(call[1].tracks[0].offset).toBeGreaterThan(9.9);
    expect(call[1].tracks[0].offset).toBeLessThan(10.2);
  });

  it('a stage window clock 120 s off (opened after a laptop sleep) falls back to the live capture', async () => {
    // The editor opened before the sleep: its old clock ran 120 s behind
    // the stage window's, and the song was muxed from 130 s instead of 10 s.
    const result = await recordWhilePlaying(-120_000, 'rec-skew');
    expect(result.mode).toBe('sidecar');
    expect(h.invoke.mock.calls.some((c) => c[0] === 'show_audio_mux')).toBe(false);
    // Behind instead of ahead: the same.
    h.invoke.mockClear();
    const behind = await recordWhilePlaying(120_000, 'rec-skew-2');
    expect(behind.mode).toBe('sidecar');
    expect(h.invoke.mock.calls.some((c) => c[0] === 'show_audio_mux')).toBe(false);
  });

  it('a reloaded stage page drops what the old page was recording (it recorded forever)', async () => {
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-1' });
    await wait(10);
    stage.postMessage({ type: 'rec-audio-start', id: 'rec-a', at: epochNow(), instance: 'page-1' });
    await wait(10);
    expect(h.sidecars).toBeGreaterThan(0);
    const before = h.discards.length;
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-2' });
    await wait(10);
    expect(h.discards.length).toBe(before + 1);
  });

  it('the stage window closing drops its recordings and the audio delay', async () => {
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-1' });
    await wait(10);
    stage.postMessage({ type: 'show-command', command: { op: 'audioDelay', enabled: true, seconds: 0.2 } });
    stage.postMessage({ type: 'rec-audio-start', id: 'rec-b', at: epochNow(), instance: 'page-1' });
    await wait(10);
    expect(h.setOutputDelay).toHaveBeenLastCalledWith(0.2);
    expect(get(rehearsalAudioDelayActive)).toBe(0.2);
    const before = h.discards.length;
    stage.postMessage({ type: 'stage-bye', instance: 'page-1' });
    await wait(10);
    expect(h.discards.length).toBe(before + 1);
    expect(h.setOutputDelay).toHaveBeenLastCalledWith(0);
    expect(get(rehearsalAudioDelayActive)).toBe(0);
    // Session-only: the next Stage Sim window starts with no delay.
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-3' });
    await wait(10);
    expect(h.setOutputDelay).toHaveBeenLastCalledWith(0);
  });

  it('the audio delay is never saved, and a delay saved by an older build is not applied', async () => {
    uninstall();
    store.set('ghostarcade-stage-audio-delay', JSON.stringify({ enabled: true, seconds: 0.5 }));
    uninstall = installEditorRehearsal();
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-1' });
    await wait(10);
    expect(h.setOutputDelay).toHaveBeenLastCalledWith(0);
    expect(store.has('ghostarcade-stage-audio-delay')).toBe(false);
    stage.postMessage({ type: 'show-command', command: { op: 'audioDelay', enabled: true, seconds: 0.3 } });
    await wait(10);
    expect(h.setOutputDelay).toHaveBeenLastCalledWith(0.3);
    expect(store.size).toBe(0);
  });

  it('no show: no live capture (it held only the microphone) and no sound claimed', async () => {
    st.set({ duration: 0 });
    stage.postMessage({ type: 'stage-hello', at: epochNow(), stateVersion: null, instance: 'page-1' });
    await wait(10);
    stage.postMessage({ type: 'rec-audio-start', id: 'rec-c', at: epochNow(), instance: 'page-1' });
    await wait(10);
    expect(startRecordingAudioSidecar).not.toHaveBeenCalled();
    stage.postMessage({ type: 'rec-audio-finish', id: 'rec-c', videoPath: '/v.mp4', startedAt: epochNow() - 1000, durationSeconds: 1, latencySeconds: 0 });
    await wait(30);
    const r = heard.find((m) => m.type === 'rec-audio-result') as Extract<RehearsalMessage, { type: 'rec-audio-result' }>;
    expect(r.result.mode).toBe('none');
  });
});
