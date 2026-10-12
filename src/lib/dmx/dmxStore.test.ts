import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

const dispatched: Array<{ path: string; value: number; inputId?: string }> = [];
const released: string[] = [];

vi.mock('../midi/midiRouter', () => ({
  midiRouter: {
    dispatchPath: (path: string, value: number, opts: { inputId?: string } = {}) => dispatched.push({ path, value, inputId: opts.inputId }),
    releaseInputs: (prefix: string) => released.push(prefix),
  },
}));

const midiState = writable({ learn: { active: false, targetPath: null as string | null, targetLabel: null as string | null, targetMin: 0, targetMax: 1, targetStep: 0, targetMode: 'absolute' as string } });
const midiCancel = vi.fn(() => midiState.update(s => ({ ...s, learn: { ...s.learn, active: false, targetPath: null } })));
vi.mock('../midi/midiStore', () => ({
  midiStore: { subscribe: (fn: (value: unknown) => void) => midiState.subscribe(fn), cancelLearn: () => midiCancel() },
}));

const { dmxStore } = await import('./dmxStore');

function changes(protocol: 'artnet' | 'sacn', universe: number, pairs: Record<number, number>) {
  const flat: number[] = [];
  for (const [channel, value] of Object.entries(pairs)) flat.push(Number(channel) - 1, value);
  dmxStore._handleChanges({ universes: [{ protocol, universe, changes: flat }] });
}

describe('dmxStore routing', () => {
  beforeEach(() => {
    dmxStore._resetForTests();
    dispatched.length = 0;
    released.length = 0;
  });

  it('dispatches a continuous binding only when its value changes', () => {
    dmxStore.addBinding({ protocol: 'artnet', universe: 0, channel: 3, mode: '8bit', path: 'vj:0:opacity', min: 0, max: 1, invert: false, threshold: 128, hysteresis: 16 });
    changes('artnet', 0, { 3: 255 });
    changes('artnet', 0, { 4: 99 }); // other channel: not dispatched
    changes('artnet', 1, { 3: 10 }); // other universe
    changes('sacn', 0, { 3: 10 }); // other protocol
    changes('artnet', 0, { 3: 0 });
    expect(dispatched.map(entry => entry.value)).toEqual([1, 0]);
    expect(dispatched[0].path).toBe('vj:0:opacity');
    expect(dispatched[0].inputId).toMatch(/^dmx:/);
  });

  it('fires a clip once per press and releases with hysteresis', () => {
    dmxStore.addBinding({ protocol: 'artnet', universe: 0, channel: 1, mode: 'trigger', path: 'vj:0:trigger:2', min: 0, max: 1, invert: false, threshold: 128, hysteresis: 16 });
    for (const value of [0, 200, 255, 120, 130, 100, 255]) changes('artnet', 0, { 1: value });
    expect(dispatched.map(entry => `${entry.path}=${entry.value}`)).toEqual([
      'vj:0:trigger:2=1', 'vj:0:trigger:2=0', 'vj:0:trigger:2=1',
    ]);
  });

  it('re-evaluates a 16-bit binding when either channel moves', () => {
    dmxStore.addBinding({ protocol: 'sacn', universe: 2, channel: 10, fineChannel: 11, mode: '16bit', path: 'vj:crossfader:value', min: 0, max: 1, invert: false, threshold: 128, hysteresis: 16 });
    changes('sacn', 2, { 10: 0x80 });
    changes('sacn', 2, { 11: 0x01 });
    expect(dispatched.map(entry => entry.value)).toEqual([0x8000 / 65535, 0x8001 / 65535]);
  });

  it('learns the wiggled channel and ignores one that was already moving', async () => {
    changes('artnet', 1, { 7: 10 }); // a running chase just before learn
    dmxStore.startLearn('vj:0:opacity', { label: 'Layer 1 opacity' });
    changes('artnet', 1, { 7: 250 }); // chase keeps going: ignored
    changes('artnet', 1, { 12: 5 });
    expect(get(dmxStore).learn).not.toBeNull();
    changes('artnet', 1, { 12: 90 }); // the desk fader
    const state = get(dmxStore);
    expect(state.learn).toBeNull();
    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0]).toMatchObject({ protocol: 'artnet', universe: 1, channel: 12, mode: '8bit', path: 'vj:0:opacity', label: 'Layer 1 opacity' });
    expect(state.lastLearnedId).toBe(state.bindings[0].id);
    expect(dispatched).toHaveLength(0); // nothing moved while learning
    changes('artnet', 1, { 12: 255 });
    expect(dispatched.at(-1)).toMatchObject({ path: 'vj:0:opacity', value: 1 });
  });

  it('learned triggers do not fire on the release that ends the wiggle', () => {
    dmxStore.startLearn('vj:0:trigger:0');
    changes('artnet', 0, { 5: 255 });
    expect(get(dmxStore).bindings[0]).toMatchObject({ mode: 'trigger', channel: 5 });
    changes('artnet', 0, { 5: 0 });
    expect(dispatched.map(entry => entry.value)).toEqual([0]);
    changes('artnet', 0, { 5: 255 });
    expect(dispatched.map(entry => entry.value)).toEqual([0, 1]);
  });

  it('removing a held trigger binding releases its input', () => {
    const id = dmxStore.addBinding({ protocol: 'artnet', universe: 0, channel: 1, mode: 'trigger', path: 'vj:0:trigger:0', min: 0, max: 1, invert: false, threshold: 128, hysteresis: 16 })!;
    changes('artnet', 0, { 1: 255 });
    dmxStore.removeBinding(id);
    expect(released).toContain(`dmx:${id}`);
  });

  it('serializes and hydrates project data, dropping junk', () => {
    dmxStore.addBinding({ protocol: 'sacn', universe: 4, channel: 20, mode: '16bit', fineChannel: 30, path: 'vj:master:opacity', min: 0.1, max: 0.9, invert: true, threshold: 128, hysteresis: 16 });
    const saved = JSON.parse(JSON.stringify({ ...dmxStore.serialize(), universes: [1, 4], mergeMode: 'ltp', timeoutMs: 4000 }));
    dmxStore._resetForTests();
    dmxStore.hydrate({ ...saved, bindings: [...saved.bindings, { path: '' }, 'junk'] });
    const state = get(dmxStore);
    expect(state).toMatchObject({ universes: [1, 4], mergeMode: 'ltp', timeoutMs: 4000 });
    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0]).toMatchObject({ protocol: 'sacn', universe: 4, channel: 20, fineChannel: 30, mode: '16bit', invert: true, min: 0.1, max: 0.9 });
    dmxStore.reset();
    expect(get(dmxStore).bindings).toHaveLength(0);
  });

  it('ignores malformed change batches', () => {
    dmxStore.addBinding({ protocol: 'artnet', universe: 0, channel: 1, mode: '8bit', path: 'vj:0:opacity', min: 0, max: 1, invert: false, threshold: 128, hysteresis: 16 });
    dmxStore._handleChanges({ universes: [{ protocol: 'artnet', universe: 0, changes: [0, 999, -1, 5, 600, 5, 0.5, 5] }] });
    dmxStore._handleChanges({ universes: [{ protocol: 'bogus' as never, universe: 0, changes: [0, 5] }] });
    dmxStore._handleChanges({} as never);
    expect(dispatched).toHaveLength(0);
  });
});
