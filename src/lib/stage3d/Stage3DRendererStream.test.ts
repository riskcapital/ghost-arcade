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

  it('a second stream is refused while one runs (it used to end the first and delete its file)', async () => {
    const r = streamTarget();
    const a = sink();
    const stopA = r.streamFrames(64, 36, a.s);
    const b = sink();
    const stopB = r.streamFrames(64, 36, b.s);
    await Promise.resolve();
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual(['Another recording is using the stage view.']);
    stopB(); // the refused stream's stop does not end the running one
    expect(r.frameStream?.sink).toBe(a.s);
    r.streamTag = 1;
    r.fulfillCapture(renderer, 1920, 1080);
    expect(a.frames.length).toBe(1);
    expect(b.frames.length).toBe(0);
    // Once the first stops, a new one may start.
    stopA();
    const c = sink();
    r.streamFrames(64, 36, c.s);
    await Promise.resolve();
    expect(c.errors).toEqual([]);
    expect(r.frameStream?.sink).toBe(c.s);
  });

  it('a kept render that never reached its capture is reported lost at the next render', () => {
    const r = streamTarget();
    const lost: unknown[] = [];
    const { s } = sink({ lost: (tag) => lost.push(tag) });
    r.streamFrames(64, 36, s);
    r.streamTag = { slot: 7 };
    // The render threw before fulfillCapture; the next render starts.
    r.streamLost(r.streamTag);
    expect(lost).toEqual([{ slot: 7 }]);
  });

  it('a lost WebGL context drops the frame reader without GL calls and keeps no renders until it is back', () => {
    const r = streamTarget();
    r.contextLossSeen = false;
    let isLost = false;
    const gl = { isContextLost: () => isLost };
    const ctxRenderer = { getContext: () => gl } as any;
    const abandon = vi.fn();
    r.frameReader = { abandon };
    r.frameReaderGl = gl;
    expect(r.checkContextLoss(ctxRenderer)).toBe(false);
    expect(abandon).not.toHaveBeenCalled();
    isLost = true;
    expect(r.checkContextLoss(ctxRenderer)).toBe(true);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(r.frameReader).toBeNull();
    // Restored: a fresh reader is made on the next read (the old one's objects are dead).
    r.frameReader = { abandon: vi.fn() };
    r.frameReaderGl = gl;
    isLost = false;
    expect(r.checkContextLoss(ctxRenderer)).toBe(false);
    expect(r.frameReader).toBeNull();
    expect(r.frameReaderGl).toBeNull();
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

  it('lets the frame reader go once no stream is left', () => {
    const r = streamTarget();
    r.frameReader = { releaseWhenIdle: vi.fn() };
    const stop = r.streamFrames(64, 36, sink().s);
    expect(r.frameReader.releaseWhenIdle).not.toHaveBeenCalled();
    stop();
    expect(r.frameReader.releaseWhenIdle).toHaveBeenCalledTimes(1);
    stop(); // a stale stop does nothing more
    expect(r.frameReader.releaseWhenIdle).toHaveBeenCalledTimes(1);
    // A failed stream lets it go too.
    const { s, errors } = sink();
    r.streamFrames(64, 36, s);
    r.failStream(r.frameStream, new Error('gone'));
    expect(errors).toEqual(['gone']);
    expect(r.frameReader.releaseWhenIdle).toHaveBeenCalledTimes(2);
  });
});

describe('Stage 3D kept render with the editor helpers up', () => {
  function drawTarget(helpersVisible: boolean) {
    const r: any = Object.create(Stage3DRenderer.prototype);
    const helper = { visible: helpersVisible };
    const outline = { visible: helpersVisible };
    r.transformControls = { getHelper: () => helper };
    r.selectionOutlines = new Map([['screen:a', outline]]);
    r.pendingCapture = null;
    r.streamTag = undefined;
    const seen: boolean[] = [];
    r.renderScene = vi.fn(() => seen.push(helper.visible, outline.visible));
    r.renderEditorHelpersOver = vi.fn();
    return { r, helper, outline, seen };
  }

  it('draws the scene once for the capture (helpers hidden), then only the helpers over it', () => {
    const { r, helper, outline, seen } = drawTarget(true);
    r.streamTag = 1;
    r.drawFrame(renderer, 1920, 1080);
    expect(r.renderScene).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([false, false]);
    expect(r.renderEditorHelpersOver).toHaveBeenCalledWith(renderer, 1920, 1080, [helper, outline]);
    expect(helper.visible && outline.visible).toBe(true);
  });

  it('a render nobody keeps, or one with no helpers up, is a single plain render', () => {
    const a = drawTarget(true);
    a.r.drawFrame(renderer, 1920, 1080);
    expect(a.r.renderScene).toHaveBeenCalledTimes(1);
    expect(a.seen).toEqual([true, true]);
    expect(a.r.renderEditorHelpersOver).not.toHaveBeenCalled();
    const b = drawTarget(false);
    b.r.streamTag = 1;
    b.r.drawFrame(renderer, 1920, 1080);
    expect(b.r.renderScene).toHaveBeenCalledTimes(1);
    expect(b.r.renderEditorHelpersOver).not.toHaveBeenCalled();
  });

  function overlayTarget(target: unknown) {
    const r: any = Object.create(Stage3DRenderer.prototype);
    r.lastSceneTarget = target;
    r.scene = { fog: { density: 0.02 } };
    r.camera = { isCamera: true };
    r.outputPass = { render: vi.fn() };
    r.forceOpaqueAlpha = vi.fn();
    r.renderScene = vi.fn();
    const calls: string[] = [];
    const gl: any = {
      autoClear: true,
      setRenderTarget: vi.fn((t: unknown) => calls.push(`target:${t ? 'rt' : 'screen'}`)),
      setViewport: vi.fn(),
      render: vi.fn((obj: any, cam: unknown) => {
        calls.push(`render:${obj.name}:fog=${obj.fog === r.scene.fog}:autoClear=${gl.autoClear}:cam=${cam === r.camera}`);
      }),
    };
    r.outputPass.render.mockImplementation(() => calls.push('output'));
    return { r, gl, calls };
  }

  it('with bloom: helpers go into the picture before the output pass, which runs again', () => {
    const rt = { id: 'scene' };
    const { r, gl, calls } = overlayTarget(rt);
    const helpers = [{ name: 'gizmo' }, { name: 'outline' }] as any[];
    r.renderEditorHelpersOver(gl, 1920, 1080, helpers);
    expect(calls).toEqual([
      'target:rt',
      'render:gizmo:fog=true:autoClear=false:cam=true',
      'render:outline:fog=true:autoClear=false:cam=true',
      'output',
      'target:screen',
    ]);
    expect(r.outputPass.render).toHaveBeenCalledWith(gl, null, rt, 0, false);
    expect(gl.autoClear).toBe(true);
    expect(helpers.every((h) => !('fog' in h))).toBe(true);
    expect(r.forceOpaqueAlpha).toHaveBeenCalledTimes(1);
    expect(r.renderScene).not.toHaveBeenCalled();
  });

  it('without bloom: helpers go straight onto the screen over the scene', () => {
    const { r, gl, calls } = overlayTarget(null);
    r.renderEditorHelpersOver(gl, 1280, 720, [{ name: 'gizmo' }] as any[]);
    expect(calls).toEqual(['target:screen', 'render:gizmo:fog=true:autoClear=false:cam=true', 'target:screen']);
    expect(gl.setViewport).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(r.outputPass.render).not.toHaveBeenCalled();
    expect(gl.autoClear).toBe(true);
  });

  it('falls back to drawing the whole frame again if the helper pass fails', () => {
    const { r, gl } = overlayTarget(null);
    gl.render.mockImplementation(() => { throw new Error('lost'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    r.renderEditorHelpersOver(gl, 1280, 720, [{ name: 'gizmo' }] as any[]);
    warn.mockRestore();
    expect(r.renderScene).toHaveBeenCalledTimes(1);
    expect(gl.autoClear).toBe(true);
  });
});

