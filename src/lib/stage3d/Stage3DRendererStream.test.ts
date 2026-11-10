import { describe, expect, it, vi } from 'vitest';
import { Stage3DRenderer } from './Stage3DRenderer';
import type { StageFrameSink } from './store';

/** Just enough of the renderer for its live frame stream (no WebGL2 here, so
 *  frames take the synchronous path, stubbed). */
function streamTarget(): any {
  const r: any = Object.create(Stage3DRenderer.prototype);
  r.canvas = { width: 1920, height: 1080, clientWidth: 960, clientHeight: 540 };
  r.frameStream = null;
  r.streamTag = undefined;
  r.frameReader = null;
  r.frameReaderGl = null;
  r.pendingCapture = null;
  let n = 0;
  r.captureCanvasFrame = vi.fn((w: number, h: number) => ({ data: new Uint8Array([++n]), width: w, height: h }));
  return r;
}

const renderer = { getContext: () => ({}) } as any;

function sink(over: Partial<StageFrameSink> = {}) {
  const frames: [number, unknown][] = [];
  const errors: string[] = [];
  const s: StageFrameSink = {
    beforeRender: () => null,
    frame: (f, tag) => frames.push([f.data[0], tag]),
    error: (e) => errors.push(e.message),
    ...over,
  };
  return { s, frames, errors };
}

describe('Stage 3D live frame stream', () => {
  it('hands the kept render to the sink with its tag, at the stream size', () => {
    const r = streamTarget();
    const { s, frames } = sink();
    r.streamFrames(1280.4, 720, s);
    r.streamTag = { slot: 4 };
    r.fulfillCapture(renderer, 1920, 1080);
    expect(frames).toEqual([[1, { slot: 4 }]]);
    expect(r.captureCanvasFrame).toHaveBeenCalledWith(1280, 720);
    // The tag is used once.
    r.fulfillCapture(renderer, 1920, 1080);
    expect(frames.length).toBe(1);
  });

  it('stops taking frames once stopped; a new stream supersedes the old', () => {
    const r = streamTarget();
    const a = sink();
    const stopA = r.streamFrames(64, 36, a.s);
    const b = sink();
    r.streamFrames(64, 36, b.s);
    expect(a.errors).toEqual(['superseded']);
    stopA(); // stale stop does not end the new stream
    expect(r.frameStream?.sink).toBe(b.s);
    r.streamTag = 1;
    r.fulfillCapture(renderer, 1920, 1080);
    expect(b.frames.length).toBe(1);
    expect(a.frames.length).toBe(0);
  });

  it('a sink that throws ends the stream with an error, once', () => {
    const r = streamTarget();
    const { s, errors } = sink({ frame: () => { throw new Error('encoder gone'); } });
    r.streamFrames(64, 36, s);
    r.streamTag = 1;
    r.fulfillCapture(renderer, 1920, 1080);
    expect(errors).toEqual(['encoder gone']);
    expect(r.frameStream).toBeNull();
    r.failStream({ sink: s, failed: true }, new Error('again'));
    expect(errors.length).toBe(1);
  });
});
