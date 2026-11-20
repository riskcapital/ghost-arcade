// Frame cadence over a window of time, for the welcome screen's measuring build.

export interface FrameStats {
  frames: number;
  fps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  /** Frames that took longer than two 60 Hz frames: what reads as a stutter. */
  over33Ms: number;
}

export function frameStats(durationMs: number, skipMs = 0): Promise<FrameStats> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = now + skipMs;
      if (now >= start) {
        if (last) deltas.push(now - last);
        last = now;
      }
      if (now - start < durationMs) {
        requestAnimationFrame(tick);
        return;
      }
      const sorted = [...deltas].sort((a, b) => a - b);
      const sum = deltas.reduce((a, b) => a + b, 0);
      const round = (v: number) => Math.round(v * 10) / 10;
      resolve({
        frames: deltas.length,
        fps: round(deltas.length / (sum / 1000 || 1)),
        meanMs: round(sum / (deltas.length || 1)),
        p95Ms: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
        maxMs: round(sorted[sorted.length - 1] ?? 0),
        over33Ms: deltas.filter((d) => d > 33.4).length,
      });
    };
    requestAnimationFrame(tick);
  });
}
