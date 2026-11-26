/**
 * Ring-buffer spawn window shared by the GPU particle brushes
 * (WebGPUPaintDrip, WebGPUAdvLightPaint).
 *
 * Each frame the CPU advances a cursor by `perFrame`; the compute shader
 * lets a dead particle respawn only when its slot falls inside the window
 * [cursor, cursor + perFrame) modulo the pool size. Over successive frames
 * the window sweeps the whole pool, so every slot gets its turn instead of
 * only the first `perFrame` slots ever spawning.
 *
 * The WGSL in both renderers mirrors `spawnWindowOffset` exactly.
 */

/** Offset of slot `i` inside the spawn window, or -1 when outside it. */
export function spawnWindowOffset(i: number, cursor: number, perFrame: number, count: number): number {
  if (count <= 0) return -1;
  const k = (i + count - (cursor % count)) % count;
  return k < Math.min(perFrame, count) ? k : -1;
}

/** Cursor for the next frame. */
export function advanceSpawnCursor(cursor: number, perFrame: number, count: number): number {
  if (count <= 0) return 0;
  return (cursor + perFrame) % count;
}
