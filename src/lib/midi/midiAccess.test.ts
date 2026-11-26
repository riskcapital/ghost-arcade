import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true, writable: true });
  return data;
});

vi.mock('../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  return { vjClipLauncher: writable({ isOpen: false, pendingTriggers: [] }) };
});
vi.mock('./midiRouter', () => ({ midiRouter: { dispatchPath: vi.fn(), routeMessage: vi.fn(), releaseInputs: vi.fn(), routeShowReleases: vi.fn() } }));
vi.mock('../stores/audio', () => ({ audioStore: { setManualBPM: vi.fn(), subscribe: () => () => {} } }));

import {
  midiBackendInfo,
  NATIVE_MIDI_SETTING_KEY,
  NativeMidiSession,
  requestMidiAccess,
  setNativeMidiBackendForTests,
  type NativeMidiBackend,
  type NativeMidiPortList,
  type NativeMidiWireMessage,
} from './midiAccess';
import { MidiManager } from './midiManager';
import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';

const ORIGIN = 1_700_000_000_000;

class FakeNativeBackend implements NativeMidiBackend {
  envOptIn = true;
  available = true;
  startOk = true;
  sent: { id: string; data: number[] }[] = [];
  private messageListeners = new Set<(m: NativeMidiWireMessage[]) => void>();
  private portListeners = new Set<(p: NativeMidiPortList) => void>();
  constructor(public ports: NativeMidiPortList) {}
  async status() { return { available: this.available, envOptIn: this.envOptIn, virtualPortsSupported: true }; }
  async start() { return this.startOk ? { ok: true, virtual: true, ports: this.ports } : { ok: false, error: 'boom' }; }
  send(id: string, data: Uint8Array) { this.sent.push({ id, data: Array.from(data) }); }
  onMessages(cb: (m: NativeMidiWireMessage[]) => void) { this.messageListeners.add(cb); return () => this.messageListeners.delete(cb); }
  onPorts(cb: (p: NativeMidiPortList) => void) { this.portListeners.add(cb); return () => this.portListeners.delete(cb); }
  timeOrigin() { return ORIGIN; }
  // Driving it, as the main process would.
  emit(port: string, bytes: number[], atMs = 5) { for (const cb of this.messageListeners) cb([{ port, data: Uint8Array.from(bytes), t: ORIGIN + atMs }]); }
  setPorts(ports: NativeMidiPortList) { this.ports = ports; for (const cb of this.portListeners) cb(ports); }
}

const info = (id: string, name: string, virtual = false) => ({ id, name, manufacturer: 'Test', virtual });

describe('native MIDI access (Web MIDI-shaped)', () => {
  let backend: FakeNativeBackend;
  beforeEach(() => {
    backend = new FakeNativeBackend({ inputs: [info('in-1', 'Pads')], outputs: [info('out-1', 'Pads'), info('virtual-out', 'Ghost Arcade', true)] });
    setNativeMidiBackendForTests(() => backend);
  });
  afterEach(() => { setNativeMidiBackendForTests(null); vi.unstubAllGlobals(); });

  it('lists ports and delivers messages with Web MIDI event fields', async () => {
    const access = await requestMidiAccess({ sysex: false });
    expect([...access.inputs.keys()]).toEqual(['in-1']);
    expect([...access.outputs.values()].map(o => o.name)).toEqual(['Pads', 'Ghost Arcade']);
    const input = access.inputs.get('in-1')!;
    expect(input).toMatchObject({ id: 'in-1', name: 'Pads', manufacturer: 'Test', type: 'input', state: 'connected' });
    const seen: { data: number[]; timeStamp: number; target: unknown }[] = [];
    input.onmidimessage = (e: MIDIMessageEvent) => seen.push({ data: Array.from(e.data!), timeStamp: e.timeStamp, target: e.currentTarget });
    expect(input.connection).toBe('open');
    backend.emit('in-1', [0x90, 60, 100], 12.5);
    // Epoch time from main becomes this page's performance.now() time.
    expect(seen).toEqual([{ data: [0x90, 60, 100], timeStamp: 12.5, target: input }]);
    expect(get(midiBackendInfo).backend).toBe('native');
  });

  it('reports hot-plug as statechange, keeping a gone port as disconnected', async () => {
    const access = await requestMidiAccess();
    const events: string[] = [];
    access.onstatechange = (e: MIDIConnectionEvent) => events.push(`${e.port!.id}:${e.port!.state}`);
    const pads = access.inputs.get('in-1')!;
    backend.setPorts({ inputs: [info('in-2', 'Keys')], outputs: backend.ports.outputs });
    expect(events).toEqual(['in-2:connected', 'in-1:disconnected']);
    expect(pads.state).toBe('disconnected');
    expect(access.inputs.get('in-1')).toBe(pads);
    events.length = 0;
    backend.setPorts({ inputs: [info('in-1', 'Pads'), info('in-2', 'Keys')], outputs: backend.ports.outputs });
    expect(events).toEqual(['in-1:connected']);
    expect(access.inputs.get('in-1')).toBe(pads);
  });

  it('keeps SysEx back unless it was asked for, as Web MIDI does', async () => {
    const plain = await requestMidiAccess({ sysex: false });
    const withSysex = await requestMidiAccess({ sysex: true });
    const a: number[][] = [], b: number[][] = [];
    plain.inputs.get('in-1')!.onmidimessage = (e: MIDIMessageEvent) => a.push(Array.from(e.data!));
    withSysex.inputs.get('in-1')!.addEventListener('midimessage', (e) => b.push(Array.from((e as MIDIMessageEvent).data!)));
    backend.emit('in-1', [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7]);
    backend.emit('in-1', [0xF8]);
    expect(a).toEqual([[0xF8]]);
    expect(b).toEqual([[0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7], [0xF8]]);
    expect(() => plain.outputs.get('out-1')!.send([0xF0, 0x01, 0xF7])).toThrow(/System exclusive/);
    withSysex.outputs.get('out-1')!.send([0xF0, 0x01, 0xF7]);
    expect(() => plain.outputs.get('out-1')!.send([0x90, 300, 1])).toThrow(TypeError);
    plain.outputs.get('virtual-out')!.send([0x90, 1, 2]);
    expect(backend.sent).toEqual([{ id: 'out-1', data: [0xF0, 0x01, 0xF7] }, { id: 'virtual-out', data: [0x90, 1, 2] }]);
  });

  it('only delivers to inputs that are listened to', async () => {
    const access = await requestMidiAccess();
    const input = access.inputs.get('in-1')!;
    const heard: number[] = [];
    const listener = () => heard.push(1);
    input.addEventListener('midimessage', listener);
    backend.emit('in-1', [0xB0, 1, 2]);
    input.removeEventListener('midimessage', listener);
    backend.emit('in-1', [0xB0, 1, 3]);
    expect(heard).toEqual([1]);
  });
});

describe('choosing the backend', () => {
  const webAccess = { inputs: new Map(), outputs: new Map(), sysexEnabled: false, onstatechange: null };
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(async () => webAccess) });
  });
  afterEach(() => { setNativeMidiBackendForTests(null); vi.unstubAllGlobals(); });

  it('stays on Web MIDI when native is not opted into', async () => {
    const backend = new FakeNativeBackend({ inputs: [], outputs: [] });
    backend.envOptIn = false;
    setNativeMidiBackendForTests(() => backend);
    expect(await requestMidiAccess()).toBe(webAccess);
    expect(get(midiBackendInfo)).toMatchObject({ backend: 'web', nativeAvailable: true });
  });

  it('the setting opts in without the environment variable', async () => {
    const backend = new FakeNativeBackend({ inputs: [], outputs: [] });
    backend.envOptIn = false;
    storage.set(NATIVE_MIDI_SETTING_KEY, '1');
    setNativeMidiBackendForTests(() => backend);
    expect(await requestMidiAccess()).not.toBe(webAccess);
    expect(get(midiBackendInfo).backend).toBe('native');
  });

  it('falls back to Web MIDI when the addon is missing or does not start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = new FakeNativeBackend({ inputs: [], outputs: [] });
    missing.available = false;
    setNativeMidiBackendForTests(() => missing);
    expect(await requestMidiAccess()).toBe(webAccess);
    const broken = new FakeNativeBackend({ inputs: [], outputs: [] });
    broken.startOk = false;
    setNativeMidiBackendForTests(() => broken);
    expect(await requestMidiAccess()).toBe(webAccess);
    expect(get(midiBackendInfo).error).toBe('boom');
    setNativeMidiBackendForTests(() => null);
    expect(await requestMidiAccess()).toBe(webAccess);
    warn.mockRestore();
  });
});

describe('the MIDI manager sees the same thing from either backend', () => {
  type Step = { kind: 'message'; port: string; bytes: number[] } | { kind: 'unplug'; port: string } | { kind: 'replug'; port: string };
  const script: Step[] = [
    { kind: 'message', port: 'pads', bytes: [0x90, 36, 90] },
    { kind: 'message', port: 'pads', bytes: [0x80, 36, 0] },
    { kind: 'message', port: 'pads', bytes: [0xB1, 74, 100] },
    { kind: 'message', port: 'pads', bytes: [0xE0, 0x00, 0x40] },
    { kind: 'message', port: 'pads', bytes: [0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7] },
    { kind: 'unplug', port: 'pads' },
    { kind: 'replug', port: 'pads' },
    { kind: 'message', port: 'pads', bytes: [0x90, 37, 64] },
  ];

  function calls() {
    return {
      route: vi.mocked(midiRouter.routeMessage).mock.calls.map(c => c.slice(0, 5)),
      release: vi.mocked(midiRouter.releaseInputs).mock.calls.map(c => c[0]),
      devices: get(midiStore).devices.map(d => `${d.id}:${d.name}:${d.state}`),
      selected: get(midiStore).selectedDeviceId,
    };
  }

  async function runWeb() {
    const listeners = new Map<string, any>();
    const port = (id: string, name: string) => ({ id, name, manufacturer: 'Test', state: 'connected', onmidimessage: null as any });
    const pads = port('pads', 'Pads');
    const access: any = { inputs: new Map([['pads', pads]]), outputs: new Map(), sysexEnabled: false, onstatechange: null };
    listeners.set('pads', pads);
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(async () => access) });
    setNativeMidiBackendForTests(() => null);
    const manager = new MidiManager();
    expect(await manager.init()).toBe(true);
    for (const step of script) {
      const p = listeners.get(step.port);
      if (step.kind === 'message') {
        // Chromium never delivers SysEx to an access without it.
        if (step.bytes[0] === 0xF0 && !access.sysexEnabled) continue;
        p.onmidimessage?.({ data: new Uint8Array(step.bytes), currentTarget: p, timeStamp: 1 });
      } else {
        p.state = step.kind === 'unplug' ? 'disconnected' : 'connected';
        access.onstatechange?.({ port: p });
      }
    }
    const result = calls();
    manager.destroy();
    vi.unstubAllGlobals();
    return result;
  }

  async function runNative() {
    const backend = new FakeNativeBackend({ inputs: [info('pads', 'Pads')], outputs: [] });
    setNativeMidiBackendForTests(() => backend);
    vi.stubGlobal('navigator', {});
    const manager = new MidiManager();
    expect(await manager.init()).toBe(true);
    for (const step of script) {
      if (step.kind === 'message') backend.emit(step.port, step.bytes);
      else backend.setPorts({ inputs: step.kind === 'unplug' ? [] : [info('pads', 'Pads')], outputs: [] });
    }
    const result = calls();
    manager.destroy();
    vi.unstubAllGlobals();
    setNativeMidiBackendForTests(null);
    return result;
  }

  beforeEach(() => {
    storage.clear();
    storage.set('ghost-arcade_midi_device', 'pads');
    midiStore.selectDevice('pads');
  });

  it('routes, releases and lists devices identically', async () => {
    vi.clearAllMocks();
    const web = await runWeb();
    vi.clearAllMocks();
    storage.set('ghost-arcade_midi_device', 'pads');
    midiStore.selectDevice('pads');
    const native = await runNative();
    expect(web.route).toEqual([
      [0, 'note', 36, 90, { id: 'pads', name: 'Pads' }],
      [0, 'note', 36, 0, { id: 'pads', name: 'Pads' }],
      [1, 'cc', 74, 100, { id: 'pads', name: 'Pads' }],
      [0, 'pitchbend', 0, 8192, { id: 'pads', name: 'Pads' }],
      [0, 'note', 37, 64, { id: 'pads', name: 'Pads' }],
    ]);
    expect(native).toEqual(web);
  });

  it('clock ticks keep their native times', async () => {
    const backend = new FakeNativeBackend({ inputs: [info('pads', 'Pads')], outputs: [] });
    setNativeMidiBackendForTests(() => backend);
    vi.stubGlobal('navigator', {});
    const manager = new MidiManager();
    await manager.init();
    midiStore.setClockInEnabled(true);
    // Delivered in one burst, timed 20.833 ms apart (120 BPM) by the driver.
    for (let i = 0; i < 48; i++) backend.emit('pads', [0xF8], 1000 + i * (60000 / (24 * 120)));
    expect(get(midiStore).clockInBPM).toBe(120);
    manager.setClockInEnabled(false);
    manager.destroy();
    vi.unstubAllGlobals();
    setNativeMidiBackendForTests(null);
  });
});

describe('native session', () => {
  it('drops accesses nobody holds', async () => {
    const backend = new FakeNativeBackend({ inputs: [info('a', 'A')], outputs: [] });
    const session = new NativeMidiSession(backend);
    expect(await session.start()).toBe(true);
    const access = session.access(false);
    const got: number[][] = [];
    access.inputs.get('a')!.onmidimessage = (e: MIDIMessageEvent) => got.push(Array.from(e.data!));
    backend.emit('a', [0xFA]);
    expect(got).toEqual([[0xFA]]);
    session.dispose();
    backend.emit('a', [0xFC]);
    expect(got).toEqual([[0xFA]]);
  });
});
