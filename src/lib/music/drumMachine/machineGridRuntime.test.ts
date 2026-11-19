import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const clock = vi.hoisted(() => ({ beat: 0, beatMs: 500 }));
vi.mock('../../stores/launchClock', () => ({ launchClockPosition: () => ({ ...clock }) }));
vi.mock('../musicRuntime', () => ({ auditionMachineSound: () => {}, musicNow: () => 0, sendMachineHit: () => {}, setMachineHooks: () => {}, setMachineSound: () => {} }));
const { musicStudio, normalizeProjectState, sceneSound } = await import('../musicStudioStore');
const { emptyPart, starterBeat } = await import('./machineBeat');
const { loadBeat, machineTransport, playPad, setMachineMode, startMachine, stopMachine } = await import('./machineRuntime');

beforeEach(() => {
  vi.useFakeTimers();
  clock.beat = 0;
  stopMachine();
  setMachineMode('part');
});
afterEach(() => { stopMachine(); vi.useRealTimers(); });

describe('fine-grid recording on the running drum machine', () => {
  it('records separate 1/64 pad hits and keeps them after project serialization', () => {
    const b = starterBeat('mk.boom-box');
    b.parts = [emptyPart('Fine', 'loop', 1, 64)];
    b.song = [];
    loadBeat(b);
    startMachine();
    machineTransport.update(t => ({ ...t, record: true }));
    clock.beat = 0.0625;
    playPad(0, 0.6);
    clock.beat = 0.125;
    playPad(0, 0.9);
    const p = get(musicStudio).machine.parts[0];
    expect(p.tracks[0].vel.slice(0, 4)).toEqual([0, 0.6, 0.9, 0]);
    const restored = normalizeProjectState(JSON.parse(JSON.stringify(musicStudio.serialize())));
    expect(restored.machine.parts[0]).toEqual(p);
  });

  it('records onto the right mixed-grid song part with a nonzero song origin', () => {
    const b = starterBeat('mk.boom-box');
    const a = emptyPart('A', 'loop', 1, 16);
    const c = emptyPart('B', 'loop', 1, 64);
    b.parts = [a, c];
    b.song = [{ id: 'a', partId: a.id, bars: 1 }, { id: 'b', partId: c.id, bars: 1 }];
    loadBeat(b);
    setMachineMode('song');
    clock.beat = 12;
    startMachine();
    machineTransport.update(t => ({ ...t, record: true }));
    clock.beat = 16.0625;
    playPad(0, 0.8);
    const parts = get(musicStudio).machine.parts;
    expect(parts[0].tracks[0].vel.every(v => v === 0)).toBe(true);
    expect(parts[1].tracks[0].vel[1]).toBe(0.8);
  });

  it('keeps the acid rate in project and scene sound settings', () => {
    musicStudio.setAcidRate(64);
    const project = normalizeProjectState(JSON.parse(JSON.stringify(musicStudio.serialize())));
    expect(project.acidRate).toBe(64);
    expect(sceneSound(project).acidRate).toBe(64);
    expect(normalizeProjectState({ acidSteps: project.acidSteps }).acidRate).toBe(16);
  });
});
