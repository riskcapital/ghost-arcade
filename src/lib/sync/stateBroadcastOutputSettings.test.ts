import { afterEach, describe, expect, it, vi } from 'vitest';

// The sender's output-settings sync, against a fake BroadcastChannel. The
// stores it reads are stand-ins: only settings.output matters here.
const stores = vi.hoisted(() => ({ settings: null as any }));

vi.mock('$lib/stores/settings', async () => {
  const { writable } = await import('svelte/store');
  stores.settings = writable({ output: { brightness: 1 } });
  return { settings: stores.settings };
});
vi.mock('$lib/stores/layers', async () => {
  const { writable } = await import('svelte/store');
  const project = writable({ layers: [] });
  return { project: { ...project, exportProject: () => ({ project: { layers: [] } }) } };
});
vi.mock('$lib/stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  return { vjClipLauncher: writable({}), vjCrossfader: writable(0), vjClipLauncherNow: () => ({}) };
});
vi.mock('$lib/stores/vjLayerSequencer', async () => {
  const { writable } = await import('svelte/store');
  return { vjLayerSequencer: { ...writable({}), getTransportTimeSec: () => 0, hydrate: () => {} } };
});
vi.mock('$lib/stage3d/store', async () => {
  const { writable } = await import('svelte/store');
  return { stage3dScene: writable(null) };
});
vi.mock('$lib/bridge', () => ({ invoke: async () => false, isDesktopApp: false }));

class FakeChannel {
  static last: FakeChannel | null = null;
  sent: any[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() { FakeChannel.last = this; }
  postMessage(message: any) { this.sent.push(message); }
  close() {}
  receive(type: string) { this.onmessage?.({ data: { type } } as MessageEvent); }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('output settings sync to the output windows', () => {
  it('re-sends a setting changed and changed back across a broadcast pause', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const { initStateBroadcast, destroyStateBroadcast } = await import('./stateBroadcast');
    initStateBroadcast('sender');
    const channel = FakeChannel.last!;
    const settingsSent = () => channel.sent.filter((m) => m.type === 'settings-update').map((m) => m.data.output.brightness);
    const fullSent = () => channel.sent.filter((m) => m.type === 'project-state').map((m) => m.data.settings.output.brightness);

    channel.receive('osr-request-state');
    stores.settings.set({ output: { brightness: 0.5 } }); // A
    vi.advanceTimersByTime(20);
    expect(settingsSent()).toEqual([0.5]);

    // No receiver answers for a while: the sender pauses.
    vi.advanceTimersByTime(20_000);
    stores.settings.set({ output: { brightness: 0.2 } }); // B, while paused
    // The output window wakes up and gets everything, B included.
    channel.receive('osr-alive');
    expect(fullSent().at(-1)).toBe(0.2);
    // Back to A: the outputs have B, so this has to go out.
    stores.settings.set({ output: { brightness: 0.5 } });
    vi.advanceTimersByTime(20);
    expect(settingsSent()).toEqual([0.5, 0.5]);
    destroyStateBroadcast();
  });
});
