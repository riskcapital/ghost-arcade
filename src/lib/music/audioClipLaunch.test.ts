import { describe, expect, it } from 'vitest';
import { launchAudioClip, type AudioClipLaunch } from './audioClipLaunch';

function harness(opts: { ok: boolean; decodedAt: number; current?: boolean }) {
  let clock = 0;
  const log: string[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const l: AudioClipLaunch = {
    now: () => clock,
    play: async (at) => { log.push(`play@${at}`); clock = opts.decodedAt; return opts.ok; },
    current: () => opts.current ?? true,
    handOver: (at) => log.push(`handOver@${at}`),
    announce: () => log.push(`announce@${clock}`),
    failed: () => log.push('failed'),
    later: (fn, ms) => timers.push({ fn, ms }),
  };
  return { l, log, timers, tick: (t: number) => { clock = t; for (const x of timers.splice(0)) x.fn(); } };
}

describe('launching an audio clip', () => {
  it('hands over at the one deadline and announces then, not a full delay after decoding', async () => {
    const h = harness({ ok: true, decodedAt: 0.5 });
    expect(await launchAudioClip(2, h.l)).toBe(true);
    expect(h.log).toEqual(['play@2', 'handOver@2']);
    expect(h.timers[0].ms).toBeCloseTo(1500);
    h.tick(2);
    expect(h.log).toContain('announce@2');
  });

  it('starts at once when decoding ran past the deadline', async () => {
    const h = harness({ ok: true, decodedAt: 3 });
    await launchAudioClip(2, h.l);
    expect(h.log).toEqual(['play@2', 'handOver@3', 'announce@3']);
  });

  it('keeps the old clip and clears the queue when the new one cannot load', async () => {
    const h = harness({ ok: false, decodedAt: 0.5 });
    expect(await launchAudioClip(2, h.l)).toBe(false);
    expect(h.log).toEqual(['play@2', 'failed']);
  });

  it('does nothing once another launch or a stop took the part', async () => {
    const h = harness({ ok: false, decodedAt: 0.5, current: false });
    await launchAudioClip(2, h.l);
    expect(h.log).toEqual(['play@2']);
  });
});
