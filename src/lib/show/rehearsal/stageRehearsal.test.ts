import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/bridge', () => ({ invoke: vi.fn(), isElectron: false }));

import {
  createStageRehearsalRender,
  holdStageCapture,
  installStageRehearsal,
  stageLaneCameraAt,
  stageViewLatencySeconds,
  startStageRecAudio,
  stageRecordingMaxDim,
  stageRehearsalRender,
  stageShow,
  stageWindowVisible,
} from './stageRehearsal';
import { REHEARSAL_ALIVE_MS, REHEARSAL_CHANNEL, epochNow, type RehearsalMessage, type RehearsalShowState } from './rehearsalBridge';
import { demoReel, type DemoShot } from '../../stage3d/demoReel';

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

  it('the camera lane follows the screens, the view latency behind the editor (it ran 100-150 ms ahead)', async () => {
    const cam = (x: number) => ({ position: [x, 1, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 50 });
    const shot = { id: 's1', name: 'Pan', durationSec: 10, easing: 'linear', moveId: 'custom', from: cam(0), to: cam(10), arc: false, baseCamera: cam(0), stage: { nodes: [] } } as unknown as DemoShot;
    demoReel.adoptShots([shot]);
    const at = epochNow();
    editor.postMessage({ type: 'show-state', state: showState({ currentTime: 5, at, isPlaying: true, cameraLane: [{ id: 'c1', startTime: 0, duration: 10, shotId: 's1' }] }), version: 'e.1' });
    await settle();
    const latency = stageViewLatencySeconds();
    expect(latency).toBeGreaterThan(0.05);
    // At the instant the editor is at 5 s, the screens show 5 s - latency: so does the camera.
    const camera = stageLaneCameraAt(at)!;
    expect(camera.position[0]).toBeCloseTo(5 - latency, 3);
    demoReel.removeShot('s1');
  });

  it('Rec with an empty show asks the editor for no sound (the toast said "with the show\'s sound")', async () => {
    editor.postMessage({ type: 'show-state', state: showState({ hasShow: false, duration: 0, isPlaying: false }), version: 'e.1' });
    await settle();
    expect(startStageRecAudio()).toBeNull();
    expect(heard.some((m) => m.type === 'rec-audio-start')).toBe(false);
  });

  it('a reloaded editor answers a finished recording at once, not after 60 s', async () => {
    editor.postMessage({ type: 'show-state', state: showState(), version: 'ed1.1' });
    await settle();
    const rec = startStageRecAudio()!;
    expect(rec).not.toBeNull();
    await settle();
    const start = heard.find((m) => m.type === 'rec-audio-start') as Extract<RehearsalMessage, { type: 'rec-audio-start' }>;
    expect(start.instance).toMatch(/^stage-/);
    const done = rec.finish('/v.mp4');
    // The editor page reloads: a new instance's state arrives.
    editor.postMessage({ type: 'show-state', state: showState(), version: 'ed2.1' });
    const t0 = Date.now();
    const result = await done;
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(result).toMatchObject({ ok: false, mode: 'none' });
    expect(result.error).toMatch(/reloaded/);
  });

  it('an editor that went quiet answers for itself within a few seconds', async () => {
    editor.postMessage({ type: 'show-state', state: showState(), version: 'ed1.1' });
    await settle();
    const rec = startStageRecAudio()!;
    const t0 = Date.now();
    const result = await rec.finish('/v.mp4');
    expect(Date.now() - t0).toBeLessThan(REHEARSAL_ALIVE_MS + 1000);
    expect(result.error).toMatch(/went away/);
  }, 10_000);

  it('closing the window cancels its open recordings and says goodbye', async () => {
    uninstall();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, cb: () => void) => handlers.set(type, cb));
    vi.stubGlobal('removeEventListener', (type: string) => handlers.delete(type));
    uninstall = installStageRehearsal();
    editor.postMessage({ type: 'show-state', state: showState(), version: 'ed1.1' });
    await settle();
    const rec = startStageRecAudio()!;
    expect(rec).not.toBeNull();
    handlers.get('pagehide')!();
    await settle();
    const id = (heard.find((m) => m.type === 'rec-audio-start') as Extract<RehearsalMessage, { type: 'rec-audio-start' }>).id;
    expect(heard.some((m) => m.type === 'rec-audio-cancel' && m.id === id)).toBe(true);
    expect(heard.some((m) => m.type === 'stage-bye')).toBe(true);
    uninstall();
    vi.unstubAllGlobals();
    uninstall = installStageRehearsal();
  });

  it('closing the window during a Render rehearsal gives the editor its Loop back and stops it', async () => {
    uninstall();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, cb: () => void) => handlers.set(type, cb));
    vi.stubGlobal('removeEventListener', (type: string) => handlers.delete(type));
    uninstall = installStageRehearsal();
    editor.postMessage({ type: 'show-state', state: showState({ loop: true, isPlaying: false, currentTime: 0, seekGeneration: 1 }), version: 'r.1' });
    await settle();
    const render = createStageRehearsalRender()!;
    void render.begin().catch(() => {});
    await settle();
    editor.postMessage({ type: 'show-state', state: showState({ loop: false, isPlaying: true, currentTime: 0.2, seekGeneration: 2 }), version: 'r.2' });
    await settle();
    heard = [];
    handlers.get('pagehide')!();
    await settle();
    const cmds = heard.filter((m) => m.type === 'show-command').map((m) => (m as Extract<RehearsalMessage, { type: 'show-command' }>).command);
    expect(cmds).toEqual([{ op: 'pause' }, { op: 'loop', on: true }]);
    expect(heard.some((m) => m.type === 'rec-audio-cancel')).toBe(true);
    // Ending it again later (the reel's own cleanup) sends nothing more.
    heard = [];
    render.end();
    await settle();
    expect(heard.filter((m) => m.type === 'show-command')).toEqual([]);
    uninstall();
    vi.unstubAllGlobals();
    uninstall = installStageRehearsal();
  });

  it('Render rehearsal plays the show once with Loop off, from the epoch it hit 0, and gives Loop back', async () => {
    editor.postMessage({ type: 'show-state', state: showState({ loop: true, isPlaying: false, currentTime: 12, seekGeneration: 1 }), version: 'e.1' });
    await settle();
    const render = createStageRehearsalRender()!;
    const begun = render.begin();
    await settle();
    const cmds = heard.filter((m) => m.type === 'show-command').map((m) => (m as Extract<RehearsalMessage, { type: 'show-command' }>).command);
    expect(cmds).toEqual([{ op: 'loop', on: false }, { op: 'playFrom', seconds: 0 }]);
    // The editor plays from the top: at epoch 5000 it was 0.2 s in.
    editor.postMessage({ type: 'show-state', state: showState({ loop: false, isPlaying: true, currentTime: 0.2, at: 5000, seekGeneration: 2 }), version: 'e.2' });
    expect(await begun).toBeCloseTo(4800, 6);
    // Frame 0 is due when the stage view shows show time 0.
    expect(render.firstFrameAt(4800)).toBeCloseTo(4800 + stageViewLatencySeconds() * 1000, 6);
    render.end();
    await settle();
    const after = heard.filter((m) => m.type === 'show-command').map((m) => (m as Extract<RehearsalMessage, { type: 'show-command' }>).command);
    expect(after.slice(-2)).toEqual([{ op: 'pause' }, { op: 'loop', on: true }]);
  });
});
