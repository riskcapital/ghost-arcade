import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../stores/layers', async () => {
  const { writable } = await import('svelte/store');
  return { project: writable({ compositions: [{ id: 'c1', name: 'Look' }] }) };
});
vi.mock('../../recording/recorder', () => ({ muxSidecarAudio: vi.fn(), startRecordingAudioSidecar: vi.fn(() => null) }));
vi.mock('../../audio/clipAudioBus', () => ({ clipAudioBus: { setOutputDelay: vi.fn() } }));
vi.mock('../showAudioExport', () => ({ showMuxTracks: vi.fn(() => []) }));
vi.mock('../../bridge', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), invoke: vi.fn() }));

import { showTimeline } from '../../stores/showTimeline';
import { cueList } from '../cueList';
import { createRehearsalPublisher, installEditorRehearsal } from './editorRehearsal';
import { liveTakeover } from '../takeover/liveTakeover';
import { takeoverRenderHeld } from '../../stores/takeoverFrame';
import type { RehearsalAudioDelay, RehearsalMessage } from './rehearsalBridge';

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('editor: show publish to the stage window', () => {
  it('sends the arrangement once, then the playhead; a change sends it again under a new version', async () => {
    let now = 1000;
    const sent: RehearsalMessage[] = [];
    const delay: RehearsalAudioDelay = { enabled: false, seconds: 0 };
    const pub = createRehearsalPublisher((m) => sent.push(m), () => delay, () => now);

    // Calls in one task go out as one message.
    pub.publish(); pub.publish(); pub.publish();
    await flushMicrotasks();
    expect(sent.map((m) => m.type)).toEqual(['show-state']);
    const v1 = (sent[0] as Extract<RehearsalMessage, { type: 'show-state' }>).version;

    now += 50;
    pub.publish();
    await flushMicrotasks();
    expect(sent[1]).toMatchObject({ type: 'show-tick', version: v1 });
    const tick = (sent[1] as Extract<RehearsalMessage, { type: 'show-tick' }>).tick;
    expect(Object.keys(tick).sort()).toEqual(['at', 'chasing', 'currentTime', 'isPlaying', 'seekGeneration']);
    expect(tick.at).toBe(now);

    // A marker added: the arrangement changed.
    const id = cueList.addMarker(3, null, 'drop');
    now += 50;
    pub.publish();
    await flushMicrotasks();
    expect(sent[2]).toMatchObject({ type: 'show-state' });
    const s2 = sent[2] as Extract<RehearsalMessage, { type: 'show-state' }>;
    expect(s2.version).not.toBe(v1);
    expect(s2.state.markers.some((m) => m.id === id && m.label === 'drop')).toBe(true);

    // Loop toggled: also the arrangement.
    showTimeline.setLoop(!get(showTimeline).loop);
    now += 50;
    pub.publish();
    await flushMicrotasks();
    expect(sent[3].type).toBe('show-state');
    const v3 = (sent[3] as Extract<RehearsalMessage, { type: 'show-state' }>).version;

    // The stage window has this one: ticks only. A different one: resend.
    expect(pub.stageHas(v3)).toBe(false);
    now += 50; pub.publish(); await flushMicrotasks();
    expect(sent[4].type).toBe('show-tick');
    expect(pub.stageHas('old')).toBe(true);
    now += 50; pub.publish(); await flushMicrotasks();
    expect(sent[5]).toMatchObject({ type: 'show-state', version: v3 });

    // An edit made in place (no new array) still goes out within a second.
    const markers = cueList.state.markers;
    (markers.find((m) => m.id === id) as { label: string }).label = 'renamed in place';
    now += 50; pub.publish(); await flushMicrotasks();
    expect(sent[6].type).toBe('show-tick');
    now += 1000; pub.publish(); await flushMicrotasks();
    expect(sent[7].type).toBe('show-state');
    expect((sent[7] as Extract<RehearsalMessage, { type: 'show-state' }>).state.markers.find((m) => m.id === id)?.label).toBe('renamed in place');
    // Nothing changed at the next check: a tick, same version.
    now += 1000; pub.publish(); await flushMicrotasks();
    expect(sent[8]).toMatchObject({ type: 'show-tick', version: (sent[7] as any).version });
    cueList.removeMarker(id);
  });
});

describe('editor: the takeover and the stage window', () => {
  function fakeChannel() {
    const sent: RehearsalMessage[] = [];
    let instance: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
    class FakeChannel {
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor() { instance = this; }
      postMessage(m: RehearsalMessage) { sent.push(m); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const uninstall = installEditorRehearsal();
    const receive = (data: RehearsalMessage) => instance!.onmessage!({ data } as MessageEvent);
    return { sent, receive, uninstall };
  }

  it('sends the LIVE pill as soon as a takeover changes, not on the next 20 Hz publish', async () => {
    const { sent, receive, uninstall } = fakeChannel();
    try {
      receive({ type: 'stage-hello', at: Date.now() });
      await flushMicrotasks();
      sent.length = 0;
      liveTakeover.engage('wall', { kind: 'black' }, { trackId: 't1' });
      await Promise.resolve();
      await Promise.resolve();
      const state = sent.find((m) => m.type === 'show-state') as Extract<RehearsalMessage, { type: 'show-state' }> | undefined;
      expect(state?.state.takeover).toMatchObject({ active: true, count: 1 });
      sent.length = 0;
      liveTakeover.release('all', { mode: 'instant' });
      await Promise.resolve();
      await Promise.resolve();
      const after = sent.find((m) => m.type === 'show-state') as Extract<RehearsalMessage, { type: 'show-state' }> | undefined;
      expect(after?.state.takeover).toBeNull();
    } finally {
      liveTakeover.reset();
      uninstall();
      vi.unstubAllGlobals();
    }
  });

  it('a Render rehearsal recording keeps a live takeover out of the picture until it finishes, is cancelled or the stage goes', () => {
    const { receive, uninstall } = fakeChannel();
    try {
      receive({ type: 'stage-hello', at: Date.now() });
      // A plain Rec records the live picture, takeover and all.
      receive({ type: 'rec-audio-start', id: 'rec-live', at: Date.now() });
      expect(get(takeoverRenderHeld)).toBe(false);
      receive({ type: 'rec-audio-cancel', id: 'rec-live' });
      receive({ type: 'rec-audio-start', id: 'rec-a', at: Date.now(), render: true });
      expect(get(takeoverRenderHeld)).toBe(true);
      receive({ type: 'rec-audio-cancel', id: 'rec-a' });
      expect(get(takeoverRenderHeld)).toBe(false);
      receive({ type: 'rec-audio-start', id: 'rec-b', at: Date.now(), render: true });
      expect(get(takeoverRenderHeld)).toBe(true);
      receive({ type: 'stage-bye' });
      expect(get(takeoverRenderHeld)).toBe(false);
      receive({ type: 'stage-hello', at: Date.now() });
      receive({ type: 'rec-audio-start', id: 'rec-c', at: Date.now(), render: true });
      expect(get(takeoverRenderHeld)).toBe(true);
    } finally {
      uninstall();
      vi.unstubAllGlobals();
    }
    // Uninstalling the editor side lets go too.
    expect(get(takeoverRenderHeld)).toBe(false);
  });
});
