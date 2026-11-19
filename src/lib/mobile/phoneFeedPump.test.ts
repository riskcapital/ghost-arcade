import { describe, expect, it, vi } from 'vitest';
import { PhoneFeedPump, phoneFeedFitSize, PUMP_STATS_WINDOW } from './phoneFeedPump';
import { fakeCore, fakeFrame, fakeFrameSource, flush } from './phoneFeedTestKit';

function pump(options: { wanted?: () => boolean; maxEdge?: number; scale?: any; now?: () => number } = {}) {
  const frames = fakeFrameSource();
  const core = fakeCore();
  const shown = vi.fn();
  const onFrame = vi.fn();
  let clock = 0;
  const p = new PhoneFeedPump({
    sourceId: 'phone-feed:dual',
    frames,
    sink: core.sink,
    maxEdge: () => options.maxEdge ?? 2048,
    wanted: options.wanted ?? (() => true),
    now: options.now ?? (() => clock),
    onShown: shown,
    onFrame,
    scale: options.scale,
  });
  return { p, frames, core, shown, onFrame, tick: (ms: number) => { clock += ms; } };
}

describe('PhoneFeedPump', () => {
  it('sends each frame once, as RGBA written into the slot as sent, and says when the core shows it', async () => {
    const { p, frames, core, shown } = pump();
    const frame = fakeFrame(64, 32);
    frames.push(frame);
    await flush(); await flush();
    expect(core.uploads).toHaveLength(1);
    expect(core.uploads[0]).toMatchObject({ type: 'upload_source_frame', source_id: 'phone-feed:dual', width: 64, height: 32, placement: 'rect' });
    expect((core.uploads[0] as any).rgba_buffer.byteLength).toBe(64 * 32 * 4);
    expect(frame.closed).toBe(true);
    expect(shown).toHaveBeenCalledTimes(1);
    expect(p.hasShownFrame).toBe(true);
    p.stop();
  });

  it('never queues: a frame that arrives while one is in flight is dropped (paced by the phone, never faster)', async () => {
    const { p, frames, core, tick } = pump();
    core.holdUploads();
    const sent = fakeFrame();
    frames.push(sent); await flush();
    const late = [fakeFrame(), fakeFrame(), fakeFrame()];
    for (const frame of late) { tick(42); frames.push(frame); await flush(); }
    expect(late.every((f) => f.closed && f.copies === 0)).toBe(true);
    core.releaseUploads(); await flush(); await flush();
    expect(core.uploads).toHaveLength(1);
    expect(p.stats()).toMatchObject({ framesIn: 4, uploads: 1, dropped: 3 });
    p.stop();
  });

  it('sequence numbers only grow, so the core never drops a newer frame', async () => {
    const { p, frames, core } = pump();
    for (let i = 0; i < 3; i++) { frames.push(fakeFrame()); await flush(); await flush(); }
    const seqs = core.uploads.map((u) => u.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(3);
    p.stop();
  });

  it('once shown, sends frames only while a visible layer shows the feed', async () => {
    let wanted = false;
    const { p, frames, core } = pump({ wanted: () => wanted });
    frames.push(fakeFrame()); await flush(); await flush(); // first frame goes up regardless (acknowledgement)
    expect(core.uploads).toHaveLength(1);
    const idle = fakeFrame();
    frames.push(idle); await flush(); await flush();
    expect(core.uploads).toHaveLength(1);
    expect(idle.closed).toBe(true);
    wanted = true;
    frames.push(fakeFrame()); await flush(); await flush();
    expect(core.uploads).toHaveLength(2);
    expect(p.stats()).toMatchObject({ idle: 1 });
    p.stop();
  });

  it('scales a picture larger than the core slot down to fit, keeping its shape', async () => {
    expect(phoneFeedFitSize(3840, 1440, 2048)).toEqual({ width: 2048, height: 768 });
    expect(phoneFeedFitSize(1080, 1920, 1024)).toEqual({ width: 576, height: 1024 });
    expect(phoneFeedFitSize(1280, 480, 2048)).toEqual({ width: 1280, height: 480 });
    const scale = vi.fn(async (_frame, w: number, h: number, out: Uint8Array) => { expect(out.byteLength).toBe(w * h * 4); return true; });
    const { p, frames, core } = pump({ maxEdge: 2048, scale });
    const big = fakeFrame(3840, 1440);
    frames.push(big); await flush(); await flush();
    expect(scale).toHaveBeenCalledTimes(1);
    expect(big.copies).toBe(0);
    expect(core.uploads[0]).toMatchObject({ width: 2048, height: 768 });
    p.stop();
  });

  it('keeps one pixel buffer per picture size (bounded memory)', async () => {
    const { p, frames, core } = pump();
    const buffers = new Set<unknown>();
    for (let i = 0; i < 5; i++) { frames.push(fakeFrame(64, 32)); await flush(); await flush(); buffers.add((p as any).buffer); }
    // The upload is cloned at send time (IPC); the pump's own buffer is reused.
    expect(buffers.size).toBe(1);
    frames.push(fakeFrame(32, 32)); await flush(); await flush();
    expect((p as any).buffer.byteLength).toBe(32 * 32 * 4);
    expect(core.uploads).toHaveLength(6);
    p.stop();
    expect((p as any).buffer).toBeNull();
  });

  it('reports frame pacing and latency from the last few seconds only', async () => {
    const { p, frames, tick } = pump();
    for (let i = 0; i < PUMP_STATS_WINDOW + 30; i++) { tick(41.7); frames.push(fakeFrame()); await flush(); await flush(); }
    const stats = p.stats();
    expect(stats.arrivalMs?.n).toBe(PUMP_STATS_WINDOW);
    expect(stats.arrivalMs?.avg).toBeCloseTo(41.7, 0);
    expect(stats.receiveToCoreMs?.n).toBe(PUMP_STATS_WINDOW);
    p.stop();
  });

  it('a refused upload is counted and the feed is not called shown', async () => {
    const { p, frames, core, shown } = pump();
    core.refuse();
    frames.push(fakeFrame()); await flush(); await flush();
    expect(shown).not.toHaveBeenCalled();
    expect(p.stats().errors).toBe(1);
    p.stop();
  });

  it('stops reading when the track ends, and stop() cancels the reader', async () => {
    const { p, frames } = pump();
    frames.push(null);
    await p.done;
    const second = pump();
    second.p.stop();
    expect(second.frames.cancelled()).toBe(true);
    await second.p.done;
    expect(p).toBeTruthy();
  });
});
