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
import { launchClockPosition, launchClockTempo, resyncLaunchClock, setTempoNudgeInput, releaseTempoNudgeInputs, nextLaunchBoundary, setShowBeatSource, launchClockFollowsShow } from './launchClock';
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
  it('takes beats from the playing show below Link and above the local clock', () => {
    // Show at 90 BPM, 13.25 beats in, running on with the wall clock.
    const start = now;
    setShowBeatSource((at) => ({ beat: 13.25 + ((at - start) * 90) / 60000, bpm: 90 }));
    try {
      expect(launchClockFollowsShow()).toBe(true);
      expect(launchClockTempo()).toBe(90);
      expect(launchClockPosition().beat).toBeCloseTo(13.25);
      now += 1000;
      expect(launchClockPosition().beat).toBeCloseTo(14.75);
      expect(launchClockPosition().beatMs).toBeCloseTo(60000 / 90);
      // The next bar (beat 16) is 1.25 beats away at 90 BPM.
      expect(nextLaunchBoundary(4)).toBeCloseTo(now + (1.25 * 60000) / 90);
      // The show owns the phase: resync steps aside.
      expect(resyncLaunchClock()).toBe(false);
      // Link with peers outranks the show.
      harness.beat = 40;
      harness.link.set({ enabled: true, peers: 2, tempo: 128 });
      expect(launchClockFollowsShow()).toBe(false);
      expect(launchClockTempo()).toBe(128);
      expect(launchClockPosition().beat).toBe(40);
      harness.link.set({ enabled: false, peers: 0, tempo: 120 });
      // A paused show (source answers null) hands back to the local clock.
      setShowBeatSource(() => null);
      expect(launchClockFollowsShow()).toBe(false);
      expect(launchClockTempo()).toBe(120);
    } finally {
      setShowBeatSource(null);
    }
  });
  it('anchors to detected audio beats, counting the time since the last one in ms', () => {
    harness.audio.set({ manualBPM: null, bpm: 120, isActive: true, beat: { beatCount: 40, timeSinceLastBeat: 0 } });
    const onBeat = launchClockPosition().beat;
    harness.audio.set({ manualBPM: null, bpm: 120, isActive: true, beat: { beatCount: 40, timeSinceLastBeat: 250 } });
    // 250 ms at 120 BPM is half a beat past the detected beat.
    expect(launchClockPosition().beat - onBeat).toBeCloseTo(0.5, 6);
    harness.audio.set({ manualBPM: 120, bpm: 120, isActive: false });
  });
});
