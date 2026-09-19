import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ audio: null as any, link: null as any, beat: 0 }));
vi.mock('./audio', async () => {
  const { writable } = await import('svelte/store');
  harness.audio = writable({ manualBPM: 120, bpm: 120, isActive: false });
  return { audioStore: harness.audio };
});
vi.mock('../sync/abletonLink', async () => {
  const { writable } = await import('svelte/store');
  harness.link = writable({ enabled: false, peers: 0, tempo: 120 });
  return { abletonLink: { ...harness.link, beatNow: () => harness.beat } };
});
import { launchClockPosition, launchClockTempo, resyncLaunchClock, setTempoNudgeInput, releaseTempoNudgeInputs, nextLaunchBoundary } from './launchClock';
describe('shared launch clock', () => {
  let now = 10000;
  beforeEach(() => {
    now = 10000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    harness.link.set({ enabled: false, peers: 0, tempo: 120 });
    releaseTempoNudgeInputs('');
    harness.audio.set({ manualBPM: 120, bpm: 120, isActive: false });
    resyncLaunchClock();
  });
  afterEach(() => { releaseTempoNudgeInputs(''); vi.restoreAllMocks(); });
  it('changes tempo without jumping the accumulated beat phase', () => {
    now += 1000;
    expect(launchClockPosition().beat).toBeCloseTo(2);
    harness.audio.set({ manualBPM: 60, bpm: 60, isActive: false });
    expect(launchClockPosition().beat).toBeCloseTo(2);
    now += 1000;
    expect(launchClockPosition().beat).toBeCloseTo(3);
  });
  it('holds a 4% tempo bend then retains the phase gained after release', () => {
    setTempoNudgeInput('pointer', 1);
    expect(launchClockTempo()).toBeCloseTo(124.8);
    now += 1000;
    setTempoNudgeInput('pointer', 0);
    expect(launchClockTempo()).toBe(120);
    expect(launchClockPosition().beat).toBeCloseTo(2.08);
    now += 1000;
    expect(launchClockPosition().beat).toBeCloseTo(4.08);
  });
  it('retains independent input ownership', () => {
    setTempoNudgeInput('key', 1); setTempoNudgeInput('midi', -1);
    setTempoNudgeInput('key', 0);
    expect(launchClockTempo()).toBeCloseTo(115.2);
    releaseTempoNudgeInputs('midi');
    expect(launchClockTempo()).toBe(120);
  });
  it('resync makes now the downbeat and the next bar remains a full bar away', () => {
    now += 1234;
    resyncLaunchClock();
    expect(launchClockPosition().beat).toBe(0);
    expect(nextLaunchBoundary(4)).toBe(now + 2000);
  });
  it('uses continuous Link beats, disables nudge/resync and drops held nudges on connection', () => {
    setTempoNudgeInput('key', 1);
    harness.beat = 9;
    harness.link.set({ enabled: true, peers: 1, tempo: 120 });
    expect(resyncLaunchClock()).toBe(false);
    setTempoNudgeInput('key', -1);
    expect(launchClockPosition().beat).toBe(9);
    expect(nextLaunchBoundary(8)).toBe(now + 3500);
    harness.link.set({ enabled: false, peers: 0, tempo: 120 });
    expect(launchClockTempo()).toBe(120);
  });
});
