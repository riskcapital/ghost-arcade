import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/bridge', () => ({ invoke: vi.fn(), isElectron: false }));

import {
  holdStageCapture,
  installStageRehearsal,
  stageRecordingMaxDim,
  stageRehearsalRender,
  stageShow,
  stageWindowVisible,
} from './stageRehearsal';
import { REHEARSAL_CHANNEL, type RehearsalMessage, type RehearsalShowState } from './rehearsalBridge';

const settle = () => new Promise((r) => setTimeout(r, 20));

function showState(over: Partial<RehearsalShowState> = {}): RehearsalShowState {
  return {
    hasShow: true, currentTime: 1, at: Date.now(), isPlaying: true, duration: 30, loop: false, seekGeneration: 1, chasing: false,
    tempo: null, hasAudio: false,
    presets: [{ id: 'p1', start: 0, duration: 4, label: 'A' }, { id: 'p2', start: 4, duration: 4, label: 'B' }],
    markers: [{ id: 'm1', time: 2, label: 'drop' }],
    cameraLane: [], audioDelay: { enabled: false, seconds: 0 }, takeover: null,
    ...over,
  };
}

describe('stage window: show mirror', () => {
  let editor: BroadcastChannel;
  let heard: RehearsalMessage[];
  let uninstall: () => void;
  let visibility: ((p: { visible?: boolean }) => void) | null;
  beforeEach(() => {
    visibility = null;
    (globalThis as any).electronAPI = { on: (channel: string, cb: (p: { visible?: boolean }) => void) => { if (channel === 'stage3d-visibility-changed') visibility = cb; return () => { visibility = null; }; } };
    heard = [];
    editor = new BroadcastChannel(REHEARSAL_CHANNEL);
    editor.onmessage = (e: MessageEvent<RehearsalMessage>) => heard.push(e.data);
    uninstall = installStageRehearsal();
  });
  afterEach(() => {
    uninstall();
    editor.close();
    delete (globalThis as any).electronAPI;
    stageWindowVisible.set(true);
    stageRecordingMaxDim.set(null);
  });

  it('ticks move the playhead and keep the arrangement as it was', async () => {
    editor.postMessage({ type: 'show-state', state: showState(), version: 'e.1' });
    await settle();
    const first = get(stageShow)!;
    expect(first.presets.map((p) => p.id)).toEqual(['p1', 'p2']);
    editor.postMessage({ type: 'show-tick', tick: { currentTime: 5, at: 123, isPlaying: false, seekGeneration: 4, chasing: true }, version: 'e.1' });
    await settle();
    const ticked = get(stageShow)!;
    expect(ticked).toMatchObject({ currentTime: 5, at: 123, isPlaying: false, seekGeneration: 4, chasing: true });
    expect(ticked.presets).toBe(first.presets);
    expect(ticked.markers).toBe(first.markers);
    expect(ticked.cameraLane).toBe(first.cameraLane);
    // The whole state again with the same version (a resend): same identity.
    editor.postMessage({ type: 'show-state', state: showState({ currentTime: 7 }), version: 'e.1' });
    await settle();
    expect(get(stageShow)!.currentTime).toBe(7);
    expect(get(stageShow)!.presets).toBe(first.presets);
    // A new arrangement replaces it.
    editor.postMessage({ type: 'show-state', state: showState({ presets: [{ id: 'p3', start: 0, duration: 2, label: 'C' }] }), version: 'e.2' });
    await settle();
    expect(get(stageShow)!.presets.map((p) => p.id)).toEqual(['p3']);
    // A tick for an arrangement this window does not have is ignored.
    editor.postMessage({ type: 'show-tick', tick: { currentTime: 99, at: 1, isPlaying: true, seekGeneration: 9, chasing: false }, version: 'e.1' });
    await settle();
    expect(get(stageShow)!.currentTime).not.toBe(99);
  });

  it('says which arrangement it has, so the editor resends only a different one', async () => {
    await settle();
    const hello = heard.find((m) => m.type === 'stage-hello') as Extract<RehearsalMessage, { type: 'stage-hello' }>;
    expect(hello.stateVersion).toBeNull();
    // A tick before any state shows nothing.
    editor.postMessage({ type: 'show-tick', tick: { currentTime: 3, at: 1, isPlaying: true, seekGeneration: 1, chasing: false }, version: 'e.1' });
    await settle();
    expect(get(stageShow)).toBeNull();
  });

  it('minimised and not capturing: no 60 fps boost and next to no core feed', async () => {
    editor.postMessage({ type: 'show-state', state: showState({ isPlaying: true }), version: 'e.1' });
    await settle();
    expect(get(stageRehearsalRender)).toMatchObject({ boost: true, fps: 60, maxDim: 960, hidden: false });
    visibility!({ visible: false });
    expect(get(stageWindowVisible)).toBe(false);
    expect(get(stageRehearsalRender)).toMatchObject({ boost: false, fps: 1, maxDim: 1280, hidden: true });
    // Recording (Rec, a streamed reel, Render rehearsal) keeps the full rate.
    stageRecordingMaxDim.set(1280);
    expect(get(stageRehearsalRender)).toMatchObject({ boost: true, fps: 60, maxDim: 1280, hidden: false });
    stageRecordingMaxDim.set(null);
    // So does any other capture that holds it.
    const release = holdStageCapture();
    expect(get(stageRehearsalRender)).toMatchObject({ boost: true, fps: 60, hidden: false });
    release();
    release();
    expect(get(stageRehearsalRender).hidden).toBe(true);
    visibility!({ visible: true });
    expect(get(stageRehearsalRender)).toMatchObject({ boost: true, fps: 60, maxDim: 960, hidden: false });
  });
});
