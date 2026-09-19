import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { writable, get } from 'svelte/store';
const harness = vi.hoisted(() => ({ midi: null as any, vj: null as any }));
vi.mock('./midiStore', async () => {
  const { writable } = await import('svelte/store');
  harness.midi = writable({});
  const patch = (p: any) => harness.midi.update((s: any) => ({ ...s, ...p }));
  return { midiStore: { ...harness.midi,
    setAvailable: (available: boolean) => patch({ available }), setDevices: (devices: any) => patch({ devices }),
    setOutputDevices: (outputDevices: any) => patch({ outputDevices }), selectDevice: (selectedDeviceId: any) => patch({ selectedDeviceId }),
    setClockInRunning: (clockInRunning: boolean) => patch({ clockInRunning }), setLastMessage: vi.fn(), completeLearn: vi.fn() } };
});
vi.mock('../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store'); harness.vj = writable({});
  return { vjClipLauncher: harness.vj };
});
vi.mock('./midiRouter', () => ({ midiRouter: { dispatchPath: vi.fn(), routeMessage: vi.fn(), releaseInputs: vi.fn() } }));
vi.mock('../stores/audio', () => ({ audioStore: { setManualBPM: vi.fn() } }));
import { MidiManager } from './midiManager';
import { midiRouter } from './midiRouter';
import { midiStore } from './midiStore';
import { controllerLightsStore } from './controllerLightsStore';

describe('controller lights through simulated Web MIDI', () => {
  let manager: MidiManager;
  let input: any, output: any, access: any;
  let frames: Map<number, FrameRequestCallback>, id: number;
  let quit: (() => void) | undefined;
  let unsubscribeQuit: ReturnType<typeof vi.fn>;
  const frame = () => { const calls = [...frames.values()]; frames.clear(); calls.forEach(fn => fn(0)); };
  const send = (note: number, velocity: number) => input.onmidimessage({ data: [0x90, note, velocity], currentTarget: input });
  beforeEach(async () => {
    vi.useFakeTimers(); vi.clearAllMocks();
    frames = new Map(); id = 0;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
    vi.stubGlobal('cancelAnimationFrame', (i: number) => frames.delete(i));
    quit = undefined; unsubscribeQuit = vi.fn();
    vi.stubGlobal('window', { location: { search: '' }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      electronAPI: { on: vi.fn((event: string, callback: () => void) => {
        if (event === 'app-before-quit') quit = callback;
        return unsubscribeQuit;
      }) } });
    input = { id: 'input', name: 'APC mini mk2', manufacturer: 'Akai', state: 'connected', onmidimessage: null };
    output = { id: 'output', name: 'APC mini mk2', manufacturer: 'Akai', state: 'connected', send: vi.fn() };
    access = { inputs: new Map([['input', input]]), outputs: new Map([['output', output]]), sysexEnabled: false, onstatechange: null };
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn(async ({ sysex }) => { access.sysexEnabled = sysex; return access; }) });
    harness.midi.set({ devices: [], mappings: [], selectedDeviceId: null, selectedClockInputId: null,
      selectedOutputId: null, clockInEnabled: false, learn: { active: false }, editMode: false, identifyMode: false });
    harness.vj.set({ isOpen: true, isLive: true, selectedDeck: 'A', crossfaderEnabled: true,
      clipGrid: [[{ id: 'red' }]], bankBClipGrid: [], layerStates: [{ activeClip: null }], bankBLayerStates: [], pendingTriggers: [] });
    controllerLightsStore.configure({ enabled: false, outputId: null, profile: 'auto', gridInput: true, deck: 'selected', columnPage: 0, rowPage: 0 });
    manager = new MidiManager(); expect(await manager.init()).toBe(true);
  });
  afterEach(() => { manager.destroy(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('requests setup access only on enable, batches lights, and preserves a held pad address across deck/page changes', async () => {
    expect(navigator.requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    frame(); expect(output.send).not.toHaveBeenCalled();
    await manager.enableControllerLights(true); frame();
    expect(output.send).toHaveBeenCalledTimes(64);
    send(56, 127);
    expect(midiRouter.dispatchPath).toHaveBeenLastCalledWith('vj:0:trigger:0', 1, { inputId: 'midi:grid:0:56' });
    harness.vj.update((s: any) => ({ ...s, selectedDeck: 'B' }));
    controllerLightsStore.configure({ columnPage: 1 });
    send(56, 0);
    expect(midiRouter.dispatchPath).toHaveBeenLastCalledWith('vj:0:trigger:0', 0, { inputId: 'midi:grid:0:56' });
    send(56, 127);
    expect(midiRouter.dispatchPath).toHaveBeenLastCalledWith('vj-b:0:trigger:8', 1, { inputId: 'midi:grid:0:56' });
  });
  it('gives learned mappings priority and preserves learn/identify suppression', async () => {
    await manager.enableControllerLights(true);
    harness.midi.update((s: any) => ({ ...s, mappings: [{ type: 'note', number: 56, channel: -1, path: 'vj:mode' }] }));
    send(56, 127);
    expect(midiRouter.routeMessage).toHaveBeenCalledWith(0, 'note', 56, 127);
    expect(midiRouter.dispatchPath).not.toHaveBeenCalled();
    harness.midi.update((s: any) => ({ ...s, mappings: [], identifyMode: true }));
    send(56, 127); expect(midiRouter.dispatchPath).not.toHaveBeenCalled();
    harness.midi.update((s: any) => ({ ...s, identifyMode: false, learn: { active: true, targetPath: 'vj:mode' } }));
    send(56, 127); expect(midiStore.completeLearn).toHaveBeenCalledWith(0, 'note', 56);
  });
  it('clears and redraws on hot-plug and releases held controls on disable', async () => {
    await manager.enableControllerLights(true); frame(); send(56, 127);
    input.state = 'disconnected'; output.state = 'disconnected'; access.onstatechange(); frame();
    expect(midiRouter.releaseInputs).toHaveBeenCalledWith('midi:');
    input.state = 'connected'; output.state = 'connected'; access.onstatechange(); output.send.mockClear(); frame();
    expect(output.send).toHaveBeenCalledTimes(64);
    await manager.enableControllerLights(false);
    expect(midiRouter.releaseInputs).toHaveBeenCalledWith('midi:grid:');
    expect(get(controllerLightsStore).enabled).toBe(false);
  });
  it('turns off controller pads and releases held inputs before Electron quits', async () => {
    await manager.enableControllerLights(true); frame(); send(56, 127);
    output.send.mockClear();
    expect(quit).toBeTypeOf('function');
    quit!();
    expect(output.send).toHaveBeenCalled();
    expect(output.send.mock.calls.every(([bytes]: [number[]]) => bytes[2] === 0)).toBe(true);
    expect(midiRouter.releaseInputs).toHaveBeenCalledWith('midi:grid:');
    manager.destroy();
    expect(unsubscribeQuit).toHaveBeenCalledTimes(1);
  });
});
