/**
 * Auto on the VJ crossfader keeps its playhead in the player: the settings
 * object the panel holds is never written per frame.
 */
import { describe, expect, it } from 'vitest';
import { CrossfaderAutoPlayer, crossfaderAutoValue } from './crossfaderAuto';
import type { AutoConfig } from '../types';

function harness(enabled = true) {
  const frames = new Map<number, (now: number) => void>();
  let id = 0;
  let now = 1000;
  const values: number[] = [];
  const player = new CrossfaderAutoPlayer({
    setValue: (v) => values.push(v),
    enabled: () => enabled,
    requestFrame: (cb) => { frames.set(++id, cb); return id; },
    cancelFrame: (n) => frames.delete(n),
  });
  const step = (n: number, ms = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      now += ms;
      const due = [...frames.values()];
      frames.clear();
      due.forEach((cb) => cb(now));
    }
  };
  return { player, values, step, pending: () => frames.size };
}

const auto = (over: Partial<AutoConfig> = {}): AutoConfig => Object.freeze({ phase: 0.25, mode: 'loop', speedHz: 0.5, min: 0, max: 1, playing: true, ...over }) as AutoConfig;

describe('crossfader Auto', () => {
  it('moves the fader every frame without writing its settings', () => {
    const { player, values, step } = harness();
    const config = auto();
    const before = JSON.stringify(config);
    // Frozen: an in-place write would throw.
    player.setConfig(config);
    step(61);
    expect(values.length).toBe(60);
    expect(new Set(values.map((v) => v.toFixed(3))).size).toBeGreaterThan(50);
    expect(JSON.stringify(config)).toBe(before);
    // Started at the saved phase, half a cycle a second.
    expect(player.playhead()).toBeCloseTo(0.75, 2);
    expect(values.at(-1)).toBeCloseTo(crossfaderAutoValue(config, player.playhead()), 6);
  });

  it('keeps the playhead through an edit, and starts a new Auto at its saved phase', () => {
    const { player, step } = harness();
    player.setConfig(auto());
    step(31);
    const head = player.playhead();
    player.setConfig(auto({ max: 0.8 }));
    expect(player.playhead()).toBe(head);
    player.setConfig(undefined);
    player.setConfig(auto({ phase: 0.1 }));
    expect(player.playhead()).toBe(0.1);
  });

  it('stops asking for frames when paused or removed, and holds while the crossfader is off', () => {
    const paused = harness();
    paused.player.setConfig(auto({ playing: false }));
    expect(paused.pending()).toBe(0);
    paused.player.setConfig(auto());
    expect(paused.pending()).toBe(1);
    paused.player.setConfig(undefined);
    expect(paused.pending()).toBe(0);

    const off = harness(false);
    off.player.setConfig(auto());
    off.step(30);
    expect(off.values).toEqual([]);
    expect(off.player.playhead()).toBe(0.25);
  });

  it('shapes ping-pong and keeps inside min..max', () => {
    expect(crossfaderAutoValue(auto({ mode: 'pingpong' }), 0.75)).toBeCloseTo(0.5);
    expect(crossfaderAutoValue(auto({ min: 0.8, max: 0.2 }), 0)).toBeCloseTo(0.2);
    expect(crossfaderAutoValue(auto({ min: -1, max: 2 }), 1)).toBe(1);
  });
});
