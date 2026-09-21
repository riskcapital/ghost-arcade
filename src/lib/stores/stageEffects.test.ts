import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
const harness = vi.hoisted(() => ({ audio: null as any, beat: 0 }));
vi.mock('./audio', async () => {
  const { writable } = await import('svelte/store');
  harness.audio = writable({ isActive: false });
  return { audioStore: harness.audio };
});
vi.mock('./launchClock', () => ({ launchClockPosition: () => ({ beat: harness.beat, beatMs: 500 }), launchClockFollowsLink: () => false }));
vi.mock('../audio/visualAudio', () => ({ getVisualAudioSnapshot: () => ({ level: 0 }) }));
import { evaluateStageEffectForScreen, clearScreenStageEffectState, syncStageEffectsFromSurfaces,
  setStageEffectsManualTime, stageEffectsRuntime } from './stageEffects';

afterEach(() => {
  syncStageEffectsFromSurfaces([]);
  setStageEffectsManualTime(null);
  clearScreenStageEffectState('test');
  harness.audio.set({ isActive: false });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Stage FX triggers', () => {
  it('pulses and decays on the shared tempo when audio is off', () => {
    const sample = () => evaluateStageEffectForScreen('test', 'beat-pulse', { decay: 0.25 }, 0.5, 0.5, 10);
    harness.beat = 8; expect(sample()).toBe(1);
    harness.beat = 8.25; expect(sample()).toBeCloseTo(0.5);
    harness.beat = 8.75; expect(sample()).toBe(0);
    harness.beat = 9; expect(sample()).toBe(1);
  });
  it('honors a selected manual tempo even with silent audio connected', () => {
    harness.audio.set({ isActive: true, rms: 0, manualBPM: 120 });
    harness.beat = 4;
    expect(evaluateStageEffectForScreen('test', 'beat-pulse', {}, 0.5, 0.5, 10)).toBe(1);
  });
  it('keeps audio onset triggering and decay independent of render wall time', () => {
    harness.audio.set({ isActive: true, rms: 0.2, beat: { isBeat: true } });
    const sample = (time: number) => evaluateStageEffectForScreen('test', 'beat-pulse', { decay: 0.25 }, 0.5, 0.5, time);
    expect(sample(10)).toBe(1);
    harness.audio.set({ isActive: true, rms: 0.2, beat: { isBeat: false } });
    expect(sample(10.125)).toBeCloseTo(0.5);
    expect(sample(10.3)).toBe(0);
  });
  it('gives every surface slice a random-hit opportunity in the same frame', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    syncStageEffectsFromSurfaces([{
      id: 'test-surface', width: 100, height: 100, activeEffectId: 'test-random',
      effects: [{ id: 'test-random', type: 'random-hits', enabled: true, opacity: 1, params: { rate: 20, duration: 0.2 } }],
      slices: [0, 1, 2].map(i => ({ id: `slice-${i}`, polygon: [
        { x: i * 20, y: 0 }, { x: i * 20 + 10, y: 0 }, { x: i * 20 + 10, y: 10 },
      ] })),
    } as any]);
    setStageEffectsManualTime(0);
    setStageEffectsManualTime(0.1);
    expect([...get(stageEffectsRuntime).sliceOutputs.values()]).toEqual([1, 1, 1]);
    vi.mocked(Math.random).mockReturnValue(1);
    setStageEffectsManualTime(0.2);
    for (const output of get(stageEffectsRuntime).sliceOutputs.values()) expect(output).toBeCloseTo(0.25);
    setStageEffectsManualTime(0.4);
    expect([...get(stageEffectsRuntime).sliceOutputs.values()]).toEqual([0, 0, 0]);
  });
});
