import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const storage = vi.hoisted(() => {
  const data = new Map<string, string>([['ghost-arcade_midi_device', 'chosen']]);
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
vi.mock('./midiRouter', () => ({ midiRouter: { dispatchPath: vi.fn(), routeMessage: vi.fn(), releaseInputs: vi.fn() } }));
vi.mock('../stores/audio', () => ({ audioStore: { setManualBPM: vi.fn(), subscribe: () => () => {} } }));

import { ClockTempoTracker, MidiManager } from './midiManager';
import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';
import { midiInputsInUse, onBandKeys, setMidiInputSetup } from './midiInputs';
import { audioStore } from '../stores/audio';

/** Deterministic jitter in [-1, 1). */
function jitter(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x40000000 - 1;
  };
}

/** Tick times for `seconds` of clock at `bpm`, each off by up to `jitterMs`. */
function clockTicks(bpm: number, seconds: number, jitterMs: number, startMs = 1000, seed = 7): number[] {
  const rand = jitter(seed);
  const tickMs = 60000 / (24 * bpm);
  const count = Math.round(seconds * 1000 / tickMs);
  return Array.from({ length: count }, (_, i) => startMs + i * tickMs + rand() * jitterMs);
}

describe('MIDI clock tempo', () => {
  it('publishes a steady clock once instead of on every tick', () => {
    const tracker = new ClockTempoTracker();
    const published: number[] = [];
    for (const t of clockTicks(120, 10, 2)) {
      const bpm = tracker.tick(t);
      if (bpm !== null) published.push(bpm);
    }
    expect(published.length).toBeGreaterThanOrEqual(1);
    expect(published.length).toBeLessThanOrEqual(2);
    expect(Math.abs(published[published.length - 1] - 120)).toBeLessThan(0.3);
  });

  it('follows a real tempo change quickly, at most four times a second', () => {
    const tracker = new ClockTempoTracker();
    const published: { bpm: number; at: number }[] = [];
    const before = clockTicks(120, 4, 1);
    const last = before[before.length - 1];
    const after = clockTicks(128, 4, 1, last + 60000 / (24 * 128), 11);
    for (const t of [...before, ...after]) {
      const bpm = tracker.tick(t);
      if (bpm !== null) published.push({ bpm, at: t });
    }
    const final = published[published.length - 1];
    expect(Math.abs(final.bpm - 128)).toBeLessThan(0.3);
    const settled = published.find(p => Math.abs(p.bpm - 128) < 0.3)!;
    expect(settled.at - after[0]).toBeLessThan(1500);
    for (let i = 1; i < published.length; i++) {
      expect(published[i].at - published[i - 1].at).toBeGreaterThanOrEqual(ClockTempoTracker.MIN_INTERVAL_MS - 1e-6);
    }
  });

  it('picks up a small lasting tempo offset', () => {
    const tracker = new ClockTempoTracker();
    let latest: number | null = null;
    const before = clockTicks(120, 3, 0);
    const after = clockTicks(120.2, 4, 0, before[before.length - 1] + 60000 / (24 * 120.2));
    for (const t of [...before, ...after]) latest = tracker.tick(t) ?? latest;
    expect(latest).toBe(120.2);
  });

  it('times ticks by the MIDI event, not by when the handler ran', () => {
    vi.useFakeTimers();
    try {
      const manager = new MidiManager();
      midiStore.setClockInEnabled(true);
      const updates: (number | null)[] = [];
      const unsubscribe = midiStore.subscribe(s => updates.push(s.clockInBPM));
      updates.length = 0;
      // Handler time is bursty (a busy main thread); event times are steady.
      const ticks = clockTicks(124, 6, 0.5);
      ticks.forEach((t, i) => {
        vi.advanceTimersByTime(i % 5 === 0 ? 70 : 1);
        (manager as any).handleClockByte(0xF8, t);
      });
      unsubscribe();
      const changes = updates.filter((v, i) => i === 0 || v !== updates[i - 1]);
      expect(changes.length).toBeLessThanOrEqual(2);
      expect(Math.abs((get(midiStore).clockInBPM ?? 0) - 124)).toBeLessThan(0.3);
      manager.setClockInEnabled(false);
      expect(get(midiStore).clockInBPM).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not notify subscribers when the tempo is unchanged', () => {
    midiStore.setClockInBPM(121);
    let calls = 0;
    const unsubscribe = midiStore.subscribe(() => { calls++; });
    midiStore.setClockInBPM(121);
    midiStore.setClockInBPM(121);
    unsubscribe();
    expect(calls).toBe(1);
    midiStore.setClockInBPM(null);
  });
});

describe('MIDI input unplug and replug', () => {
  let access: any;
  let chosen: any;
  let other: any;
  let manager: MidiManager;
  const port = (id: string, name: string) => ({ id, name, manufacturer: 'Test', state: 'connected', onmidimessage: null as any });

  beforeEach(async () => {
    vi.clearAllMocks();
    storage.set('ghost-arcade_midi_device', 'chosen');
    midiStore.selectDevice('chosen');
    chosen = port('chosen', 'Launch Control');
    other = port('other', 'Keyboard');
    access = { inputs: new Map([['chosen', chosen], ['other', other]]), outputs: new Map(), sysexEnabled: false, onstatechange: null };
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(async () => access) });
    manager = new MidiManager();
    expect(await manager.init()).toBe(true);
  });
  afterEach(() => { manager.destroy(); vi.unstubAllGlobals(); });

  it('uses another input while the chosen one is unplugged, without saving it', () => {
    expect(get(midiStore).selectedDeviceId).toBe('chosen');
    expect(chosen.onmidimessage).toBeTypeOf('function');
    chosen.state = 'disconnected';
    access.onstatechange();
    expect(get(midiStore).selectedDeviceId).toBe('other');
    expect(other.onmidimessage).toBeTypeOf('function');
    expect(storage.get('ghost-arcade_midi_device')).toBe('chosen');
  });

  it('goes back to the chosen input when it is plugged in again', () => {
    chosen.state = 'disconnected';
    access.onstatechange();
    chosen.state = 'connected';
    access.onstatechange();
    expect(get(midiStore).selectedDeviceId).toBe('chosen');
    expect(chosen.onmidimessage).toBeTypeOf('function');
    expect(other.onmidimessage).toBe(null);
    expect(storage.get('ghost-arcade_midi_device')).toBe('chosen');
  });

  it('a new pick by the user is saved and followed', () => {
    manager.selectDevice('other');
    expect(storage.get('ghost-arcade_midi_device')).toBe('other');
    other.state = 'disconnected';
    access.onstatechange();
    expect(get(midiStore).selectedDeviceId).toBe('chosen');
    other.state = 'connected';
    access.onstatechange();
    expect(get(midiStore).selectedDeviceId).toBe('other');
    expect(storage.get('ghost-arcade_midi_device')).toBe('other');
  });

  it('still bridges clock tempo into the audio store', () => {
    midiStore.setClockInEnabled(true);
    for (const t of clockTicks(126, 2, 0)) (manager as any).handleClockByte(0xF8, t);
    expect(audioStore.setManualBPM).toHaveBeenCalledTimes(1);
    expect(audioStore.setManualBPM).toHaveBeenCalledWith(126);
    manager.setClockInEnabled(false);
  });
});

describe('several MIDI inputs at once', () => {
  let access: any;
  let pads: any;
  let knobs: any;
  let nord: any;
  let manager: MidiManager;
  const port = (id: string, name: string) => ({ id, name, manufacturer: 'Test', state: 'connected', onmidimessage: null as any });
  const send = (input: any, bytes: number[]) => input.onmidimessage({ data: new Uint8Array(bytes), currentTarget: input });

  beforeEach(async () => {
    vi.clearAllMocks();
    // The single choice saved before several inputs could be used.
    storage.set('ghost-arcade_midi_device', 'pads');
    midiStore.selectDevice('pads');
    pads = port('pads', 'Pads');
    knobs = port('knobs', 'Knobs');
    nord = port('nord', 'Nord');
    access = { inputs: new Map([['pads', pads], ['knobs', knobs], ['nord', nord]]), outputs: new Map(), sysexEnabled: false, onstatechange: null };
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(async () => access) });
    manager = new MidiManager();
    expect(await manager.init()).toBe(true);
  });
  afterEach(() => { manager.destroy(); vi.unstubAllGlobals(); });

  it('keeps the old saved input as a controller, now by name', () => {
    const saved = JSON.parse(storage.get('ghost-arcade_midi_inputs') ?? '[]');
    expect(saved).toContainEqual({ name: 'Pads', use: 'control' });
    expect(pads.onmidimessage).toBeTypeOf('function');
    expect(knobs.onmidimessage).toBe(null);
  });

  it('listens to every controller, and says which one a message came from', () => {
    setMidiInputSetup('Knobs', { use: 'control' });
    expect(get(midiInputsInUse).control).toEqual(['pads', 'knobs']);
    send(knobs, [0xB0, 74, 100]);
    expect(midiRouter.routeMessage).toHaveBeenLastCalledWith(0, 'cc', 74, 100, { id: 'knobs', name: 'Knobs' });
    send(pads, [0x90, 36, 90]);
    expect(midiRouter.routeMessage).toHaveBeenLastCalledWith(0, 'note', 36, 90, { id: 'pads', name: 'Pads' });
    expect(get(midiStore).selectedDeviceId).toBe('pads');
  });

  it('records the input a mapping is learned on', () => {
    setMidiInputSetup('Knobs', { use: 'control' });
    midiStore.startLearn('vj:0:opacity', 'Opacity', 0, 1, 0, 'absolute');
    send(knobs, [0xB0, 21, 64]);
    expect(get(midiStore).mappings.find((m) => m.path === 'vj:0:opacity')).toMatchObject({ type: 'cc', number: 21, device: 'Knobs' });
    midiStore.clearAllMappings();
  });

  it('lets go of only what an unplugged controller held', () => {
    setMidiInputSetup('Knobs', { use: 'control' });
    knobs.state = 'disconnected';
    access.onstatechange();
    expect(midiRouter.releaseInputs).toHaveBeenCalledWith('midi:knobs:');
    expect(midiRouter.releaseInputs).not.toHaveBeenCalledWith('midi:pads:');
    expect(knobs.onmidimessage).toBe(null);
    expect(pads.onmidimessage).toBeTypeOf('function');
  });

  it("plays the band's keys into their own listener, never into the mappings", () => {
    const heard: { bytes: number[]; role?: string }[] = [];
    const released: string[] = [];
    const stop = onBandKeys({ message: (data, setup) => heard.push({ bytes: Array.from(data), role: setup.role }), release: (name) => released.push(name) });
    setMidiInputSetup('Nord', { use: 'keys', role: 'bass' });
    expect(get(midiInputsInUse).keys).toEqual(['nord']);
    send(nord, [0x90, 40, 100]);
    expect(heard).toEqual([{ bytes: [0x90, 40, 100], role: 'bass' }]);
    expect(midiRouter.routeMessage).not.toHaveBeenCalled();
    // Off: its notes are let go of, and it is no longer listened to.
    setMidiInputSetup('Nord', { use: 'off' });
    expect(released).toEqual(['Nord']);
    expect(nord.onmidimessage).toBe(null);
    stop();
  });
});
