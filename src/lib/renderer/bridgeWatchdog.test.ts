import { describe, expect, it } from 'vitest';
import { createBridgeWatchdog, type BridgeSample } from './bridgeWatchdog';

/** Drive the watchdog the way WebGPUCanvas does: a check every 500 ms. */
function run(samples: Array<Partial<BridgeSample> & { now: number }>) {
  const watchdog = createBridgeWatchdog();
  const verdicts = samples.map((s) => watchdog.check({ phase: 'presenting', visible: true, attempts: 0, presented: 0, ...s }));
  return verdicts.find((v) => v !== null) ?? null;
}

/** 60 fps of attempts, with `fps` of them reaching the screen, for `seconds`. */
function presenting(seconds: number, fps: number, from = { t: 0, attempts: 0, presented: 0 }) {
  const out: BridgeSample[] = [];
  for (let ms = 0; ms <= seconds * 1000; ms += 500) {
    out.push({
      now: from.t + ms,
      phase: 'presenting',
      visible: true,
      attempts: from.attempts + Math.round((ms / 1000) * 60),
      presented: from.presented + Math.round((ms / 1000) * fps),
    });
  }
  return out;
}

describe('editor GPU bridge watchdog', () => {
  it('leaves a bridge that draws alone', () => {
    expect(run(presenting(20, 60))).toBeNull();
  });

  it('gives up when nothing reaches the screen for 3 seconds', () => {
    expect(run(presenting(5, 0))).toEqual({ reason: 'no-frames' });
  });

  it('gives up when the bridge stops drawing later', () => {
    const good = presenting(5, 60);
    const last = good[good.length - 1];
    const stalled = presenting(5, 0, { t: last.now + 500, attempts: last.attempts, presented: last.presented });
    expect(run([...good, ...stalled])).toEqual({ reason: 'no-frames' });
  });

  it('does not judge a frame loop that is not running (hidden, minimised, frozen output)', () => {
    const idle = Array.from({ length: 20 }, (_, i) => ({ now: i * 500, attempts: 10, presented: 0 }));
    expect(run(idle)).toBeNull();
    const hidden = presenting(10, 0).map((s) => ({ ...s, visible: false }));
    expect(run(hidden)).toBeNull();
  });

  it('gives up at once when WebGPU could not start', () => {
    expect(run([{ now: 0, phase: 'failed' }])).toEqual({ reason: 'init-failed' });
  });

  it('gives up when WebGPU takes too long to start while the window is visible', () => {
    const starting = Array.from({ length: 20 }, (_, i) => ({ now: i * 500, phase: 'init' as const }));
    expect(run(starting)).toEqual({ reason: 'init-timeout' });
    expect(run(starting.map((s) => ({ ...s, visible: false })))).toBeNull();
  });

  it('reports once', () => {
    const watchdog = createBridgeWatchdog();
    expect(watchdog.check({ now: 0, phase: 'failed', visible: true, attempts: 0, presented: 0 })).not.toBeNull();
    expect(watchdog.check({ now: 1, phase: 'failed', visible: true, attempts: 0, presented: 0 })).toBeNull();
    expect(watchdog.tripped).toBe(true);
  });
});
