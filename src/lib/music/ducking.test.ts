import { describe, expect, it, vi } from 'vitest';
import { DUCKED_INSTRUMENTS, DUCK_ATTACK_SECONDS, Ducker, duckFloor, duckGainAt, nextDuck, releaseConstant } from './ducking';

describe('duck envelope', () => {
  it('goes down by the depth on a hard kick, a little less on a soft one, never on depth 0', () => {
    expect(duckFloor(0.5, 1)).toBeCloseTo(0.5);
    expect(duckFloor(1, 1)).toBeCloseTo(0);
    expect(duckFloor(0.5, 0)).toBeCloseTo(0.7);
    expect(duckFloor(0, 1)).toBe(1);
    expect(nextDuck(null, 0, 0, 1, 0.25)).toBeNull();
  });

  it('is down after the attack and nearly back after the release', () => {
    const env = nextDuck(null, 10, 0.6, 1, 0.4)!;
    expect(duckGainAt(env, 9)).toBe(1);
    expect(duckGainAt(env, 10)).toBe(1);
    expect(duckGainAt(env, 10 + DUCK_ATTACK_SECONDS / 2)).toBeCloseTo(0.7);
    expect(duckGainAt(env, 10 + DUCK_ATTACK_SECONDS)).toBeCloseTo(0.4);
    const back = duckGainAt(env, 10 + DUCK_ATTACK_SECONDS + 0.4);
    expect(back).toBeGreaterThan(0.98);
    expect(back).toBeLessThan(1);
    // Half way through the release it is still on its way up.
    const mid = duckGainAt(env, 10 + DUCK_ATTACK_SECONDS + 0.1);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.9);
    expect(releaseConstant(0.4)).toBeCloseTo(0.1);
  });

  it('starts a second kick from where the first left the gain', () => {
    const first = nextDuck(null, 0, 0.8, 1, 0.5)!;
    const at = 0.05;
    const second = nextDuck(first, at, 0.8, 1, 0.5)!;
    expect(second.from).toBeCloseTo(duckGainAt(first, at));
    expect(second.floor).toBeCloseTo(0.2);
  });

  it('never lifts the gain for a softer kick while a hard one is down', () => {
    const hard = nextDuck(null, 0, 1, 1, 1)!;
    const soft = nextDuck(hard, 0.01, 0.2, 0.2, 1)!;
    expect(soft.floor).toBeCloseTo(duckGainAt(hard, 0.01));
    expect(soft.floor).toBeLessThan(duckFloor(0.2, 0.2));
  });

  it('ducks the drone, bowls, FX pads and synth', () => {
    expect([...DUCKED_INSTRUMENTS].sort()).toEqual(['bowls', 'drone', 'shots', 'synth']);
  });
});

describe('Ducker', () => {
  function fakeParam() {
    return { cancelAndHoldAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), value: 1 };
  }

  function fakeContext() {
    const gains: Array<{ gain: ReturnType<typeof fakeParam>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const ctx = {
      currentTime: 2,
      createGain: () => {
        const g = { gain: fakeParam(), connect: vi.fn(), disconnect: vi.fn() };
        gains.push(g);
        return g;
      },
    };
    return { ctx: ctx as unknown as BaseAudioContext, gains };
  }

  it('schedules the dip at the hit on every ducked gain, and lets go of them', () => {
    const { ctx, gains } = fakeContext();
    const ducker = new Ducker(ctx);
    const bus = { connect: vi.fn() } as unknown as AudioNode;
    const a = ducker.after(bus);
    ducker.after(bus);
    expect((bus.connect as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(a);
    ducker.duck(0.5, 1, 0.2, 3);
    for (const g of gains) {
      expect(g.gain.cancelAndHoldAtTime).toHaveBeenCalledWith(3);
      expect(g.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 3 + DUCK_ATTACK_SECONDS);
      expect(g.gain.setTargetAtTime).toHaveBeenCalledWith(1, 3 + DUCK_ATTACK_SECONDS, releaseConstant(0.2));
    }
    ducker.dispose();
    for (const g of gains) expect(g.disconnect).toHaveBeenCalled();
  });

  it('does nothing with ducking off', () => {
    const { ctx, gains } = fakeContext();
    const ducker = new Ducker(ctx);
    ducker.after({ connect: vi.fn() } as unknown as AudioNode);
    ducker.duck(0, 1, 0.2);
    expect(gains[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
  });
});
