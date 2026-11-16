import { describe, expect, it } from 'vitest';
import { renderFrameProblem, VideoMotionWatch, type RenderFrameReport, type RenderFrameVideo } from './renderFrameHealth';

const W = 64;
const H = 36;
const expected = { width: W, height: H, pixelFormat: 'bgra' as const, manualClock: true };

/** A frame as the core reports it: opaque unless told otherwise. */
function frame(patch: Partial<RenderFrameReport> = {}): RenderFrameReport {
  return {
    width: W, height: H, format: 'Bgra8Unorm', byte_length: W * H * 4, bytes_written: W * H * 4,
    transparent_pixels: 0, average_luma: 0.4, max_luma: 1, nonzero_pixels: W * H,
    drawn: true, alpha_mode: 'opaque', render_clock: 'manual', layers: 2, ...patch,
  };
}

describe('a rendered frame is judged by whether the core made it, not by how dark it is', () => {
  it('black frames, a fade to black and a blackout pass', () => {
    // Fully black (a blackout), nearly black (the end of a fade), one dim shape.
    expect(renderFrameProblem(frame({ average_luma: 0, max_luma: 0, nonzero_pixels: 0 }), 0, expected)).toBeNull();
    expect(renderFrameProblem(frame({ average_luma: 0.002, max_luma: 0.01, nonzero_pixels: 3 }), 1, expected)).toBeNull();
    expect(renderFrameProblem(frame({ average_luma: 0.003, nonzero_pixels: 40, layers: 0 }), 2, expected)).toBeNull();
  });

  it('a frame the core never drew fails, saying so', () => {
    // A new texture nobody wrote: every byte zero, alpha included.
    const empty = frame({ transparent_pixels: W * H, average_luma: 0, max_luma: 0, nonzero_pixels: 0 });
    expect(renderFrameProblem(empty, 7, expected)).toMatch(/empty frame at 7: nothing was drawn/);
    expect(renderFrameProblem(frame({ drawn: false }), 8, expected)).toMatch(/did not draw frame 8/);
    // A core that restarted mid-render is back on the live clock.
    expect(renderFrameProblem(frame({ render_clock: 'live' }), 9, expected)).toMatch(/left the render's clock at frame 9/);
    // The live recorder is not on the render's clock.
    expect(renderFrameProblem(frame({ render_clock: 'live' }), 9, { ...expected, manualClock: false })).toBeNull();
  });

  it('a transparent target that may be empty on purpose is not an empty frame', () => {
    expect(renderFrameProblem(frame({ transparent_pixels: W * H, alpha_mode: 'straight' }), 0, expected)).toBeNull();
  });

  it('size, byte count and pixel format are still checked; an older core without the new fields still passes', () => {
    expect(renderFrameProblem(frame({ width: 32 }), 3, expected)).toMatch(/size mismatch/);
    expect(renderFrameProblem(frame({ bytes_written: 10 }), 3, expected)).toMatch(/byte count mismatch/);
    expect(renderFrameProblem(frame({ format: 'Rgba8Unorm' }), 3, expected)).toMatch(/format changed/);
    const old = frame({ average_luma: 0, nonzero_pixels: 0 });
    delete old.drawn; delete old.alpha_mode; delete old.render_clock;
    expect(renderFrameProblem(old, 0, expected)).toBeNull();
  });
});

describe('a playing video must keep moving in a render', () => {
  const video = (frame: number, patch: Partial<RenderFrameVideo> = {}): RenderFrameVideo => ({
    id: 'show:run-1', uri: 'ghost-asset://localhost/clips/My%20clip.mp4', time: frame / 30, frame, fps: 30, rate: 1, moving: true,
    anchor_time: 0, anchor_clock: 0, seek_generation: 3, ...patch,
  });

  it('a 30 fps clip at 120 fps (each frame four times) and at 24 fps passes', () => {
    for (const renderFps of [120, 24]) {
      const watch = new VideoMotionWatch(renderFps);
      for (let i = 0; i < renderFps * 3; i++) {
        const t = i / renderFps;
        expect(watch.check(t, [video(Math.floor(t * 30 + 1e-6))])).toBeNull();
      }
    }
  });

  it('a clip that stays on its first frame while playing fails within a few frames, naming it', () => {
    const watch = new VideoMotionWatch(30);
    let error: string | null = null;
    let at = -1;
    for (let i = 0; i < 30 && !error; i++) { error = watch.check(i / 30, [video(0)]); at = i; }
    expect(error).toMatch(/A video stopped moving in the render: My clip\.mp4 stayed on frame 0/);
    expect(at).toBeLessThanOrEqual(5);
  });

  it('paused, held at its end, slowed down or gone is not a stopped video', () => {
    const watch = new VideoMotionWatch(30);
    for (let i = 0; i < 90; i++) {
      const t = i / 30;
      expect(watch.check(t, [
        video(12, { id: 'paused', moving: false }),
        // A quarter speed: a new frame every 4 render frames.
        video(Math.floor(t * 30 * 0.25), { id: 'slow', rate: 0.25 }),
        ...(i < 45 ? [video(i, { id: 'leaves' })] : []),
      ])).toBeNull();
    }
    // A video that comes back starts its count again.
    expect(watch.check(3.1, [video(5, { id: 'leaves' })])).toBeNull();
    expect(watch.check(3.12, [video(5, { id: 'leaves' })])).toBeNull();
  });

  it('a video the core holds paused while the Timeline plays it counts as stopped', () => {
    const watch = new VideoMotionWatch(30);
    const playing = new Set(['show:run-1']);
    let error: string | null = null;
    for (let i = 0; i < 30 && !error; i++) error = watch.check(i / 30, [video(4, { moving: false, paused: true })], playing);
    expect(error).toMatch(/held paused while the Timeline plays it/);
    // Paused on the Timeline too (a stop or hold at its end): fine.
    const held = new VideoMotionWatch(30);
    for (let i = 0; i < 30; i++) expect(held.check(i / 30, [video(4, { moving: false, paused: true })], new Set())).toBeNull();
  });

  it('a file of unknown rate is followed by its media time', () => {
    const watch = new VideoMotionWatch(30);
    expect(watch.check(0, [video(0, { frame: null, fps: null, time: 1 })])).toBeNull();
    expect(watch.check(1 / 30, [video(0, { frame: null, fps: null, time: 1 + 1 / 30 })])).toBeNull();
    let error: string | null = null;
    for (let i = 2; i < 12 && !error; i++) error = watch.check(i / 30, [video(0, { frame: null, fps: null, time: 1 + 1 / 30 })]);
    expect(error).toMatch(/stayed on 1\.033 s/);
  });

  it('frames without a video report (other cores, the live recorder) are not checked', () => {
    const watch = new VideoMotionWatch(30);
    for (let i = 0; i < 30; i++) expect(watch.check(i / 30, undefined)).toBeNull();
  });
});
