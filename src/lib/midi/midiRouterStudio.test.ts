import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The studio's controls through the router: `studio:<id>` reaches the
// control the studio registered, buttons act on press and release edges,
// and a mapping learned on one controller stays quiet on another.
vi.mock('../stores/launchClock', () => ({ releaseTempoNudgeInputs: vi.fn(), setTempoNudgeInput: vi.fn(), resyncLaunchClock: vi.fn() }));
vi.mock('./midiStore', async () => {
  const { writable } = await import('svelte/store');
  return { midiStore: writable({ mappings: [] }) };
});
vi.mock('../stores/layers', async () => {
  const { writable } = await import('svelte/store');
  return { selectedLayer: writable(null), project: { subscribe: writable({ layers: [] }).subscribe } };
});
vi.mock('../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  return { vjClipLauncher: { ...writable({ layerStates: [], bankBLayerStates: [], groups: [] }), releaseInputs: vi.fn() } };
});
vi.mock('../renderer/nativeVideoScratch', () => ({ createNativeVideoScratchController: () => ({ seek: vi.fn(), cancel: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../stores/synthVision', () => ({ synthVisionStore: {} }));
vi.mock('../audio/modulation', () => ({ setBaseValue: vi.fn() }));
vi.mock('../plugins/registry', () => ({ getPluginByEffectType: vi.fn() }));
vi.mock('../stores/audio', () => ({ audioStore: {} }));

import { midiStore } from './midiStore';
import { midiRouter } from './midiRouter';
import { midiInputsInUse } from './midiInputs';
import { registerStudioControls } from '../music/studioControls';
import type { MidiMapping } from './midiTypes';

const store = midiStore as unknown as { set: (s: { mappings: MidiMapping[] }) => void };

function mapping(path: string, type: MidiMapping['type'], number: number, extra: Partial<MidiMapping> = {}): MidiMapping {
  return { id: `${path}-${number}`, channel: -1, type, number, path, min: 0, max: 1, step: 0, mode: 'absolute', label: path, ...extra };
}

describe('studio controls through the router', () => {
  const calls: string[] = [];
  let unregister: () => void;
  const pads = { id: 'pads', name: 'Pads' };
  const knobs = { id: 'knobs', name: 'Knobs' };

  beforeEach(() => {
    calls.length = 0;
    unregister = registerStudioControls([
      { id: 'test.throw', label: 'Throw', group: 'Band', kind: 'hold', run: (v) => calls.push(`throw ${v > 0 ? 'on' : 'off'}`) },
      { id: 'test.freeze', label: 'Freeze', group: 'Band', kind: 'toggle', run: () => calls.push('freeze') },
      { id: 'test.pad', label: 'Pad', group: 'Pads', kind: 'trigger', run: (v) => calls.push(`pad ${v.toFixed(2)}`) },
      { id: 'test.level', label: 'Level', group: 'Visuals', kind: 'value', run: (v) => calls.push(`level ${v.toFixed(2)}`) },
    ]);
    midiInputsInUse.set({ control: ['pads', 'knobs'], keys: [], standIn: null, controlNames: ['Pads', 'Knobs'] });
  });
  afterEach(() => {
    unregister();
    store.set({ mappings: [] });
  });

  it('holds a hold control while the pad is down and lets go on release', () => {
    store.set({ mappings: [mapping('studio:test.throw', 'note', 36, { mode: 'toggle' })] });
    midiRouter.routeMessage(0, 'note', 36, 100, pads);
    midiRouter.routeMessage(0, 'note', 36, 0, pads);
    midiRouter.routeMessage(0, 'note', 36, 20, pads);
    midiRouter.routeMessage(0, 'note', 36, 0, pads);
    expect(calls).toEqual(['throw on', 'throw off', 'throw on', 'throw off']);
  });

  it('flips a toggle once per press, from a note or a CC button', () => {
    store.set({ mappings: [mapping('studio:test.freeze', 'note', 40), mapping('studio:test.freeze', 'cc', 64, { mode: 'toggle' })] });
    midiRouter.routeMessage(0, 'note', 40, 90, pads);
    midiRouter.routeMessage(0, 'note', 40, 0, pads);
    midiRouter.routeMessage(0, 'cc', 64, 127, pads);
    midiRouter.routeMessage(0, 'cc', 64, 0, pads);
    expect(calls).toEqual(['freeze', 'freeze']);
  });

  it('fires a pad on every hit with its velocity, however fast they come', () => {
    store.set({ mappings: [mapping('studio:test.pad', 'note', 44)] });
    for (const velocity of [127, 0, 64, 0]) midiRouter.routeMessage(9, 'note', 44, velocity, pads);
    expect(calls).toEqual(['pad 1.00', 'pad 0.50']);
  });

  it('follows a knob', () => {
    store.set({ mappings: [mapping('studio:test.level', 'cc', 7)] });
    midiRouter.routeMessage(0, 'cc', 7, 127, knobs);
    expect(calls).toEqual(['level 1.00']);
  });

  it('gives a knob 0-1 across its range, whatever range the learned element had', () => {
    const seen: number[] = [];
    const off = registerStudioControls([{ id: 'test.release', label: 'Release', group: 'Band', kind: 'value', run: (v) => seen.push(v) }]);
    // The duck release knob is in seconds (0.05-1.2), so learning it records that range.
    store.set({ mappings: [mapping('studio:test.release', 'cc', 9, { min: 0.05, max: 1.2 })] });
    midiRouter.routeMessage(0, 'cc', 9, 64, knobs);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(64 / 127, 5);
  });

  it('keeps a mapping learned on one controller quiet on another', () => {
    store.set({ mappings: [mapping('studio:test.pad', 'note', 36, { device: 'Pads' }), mapping('studio:test.freeze', 'note', 36, { device: 'Knobs' })] });
    midiRouter.routeMessage(0, 'note', 36, 127, knobs);
    expect(calls).toEqual(['freeze']);
    // While the input it was learned on is away, any controller plays it.
    midiInputsInUse.set({ control: ['knobs'], keys: [], standIn: null, controlNames: ['Knobs'] });
    midiRouter.routeMessage(0, 'note', 36, 0, knobs);
    midiRouter.routeMessage(0, 'note', 36, 127, knobs);
    expect(calls).toEqual(['freeze', 'pad 1.00', 'freeze']);
  });

  it('lets go of what an unplugged controller holds, and only that', () => {
    store.set({ mappings: [mapping('studio:test.throw', 'note', 36)] });
    midiRouter.routeMessage(0, 'note', 36, 127, pads);
    midiRouter.releaseInputs('midi:knobs:');
    expect(calls).toEqual(['throw on']);
    midiRouter.releaseInputs('midi:pads:');
    expect(calls).toEqual(['throw on', 'throw off']);
  });

  it('plays studio paths from anything that drives the router', () => {
    midiRouter.dispatchPath('studio:test.level', 0.25);
    midiRouter.dispatchPath('studio:test.pad', 1);
    midiRouter.dispatchPath('studio:test.pad', 0);
    expect(calls).toEqual(['level 0.25', 'pad 1.00']);
  });
});
