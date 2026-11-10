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
import { createRehearsalPublisher } from './editorRehearsal';
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
