import { describe, expect, it, vi } from 'vitest';
import { StageFrameReader } from './stageFrameReader';

const GL = {
  NO_ERROR: 0, SCISSOR_TEST: 0x0c11, READ_FRAMEBUFFER: 0x8ca8, DRAW_FRAMEBUFFER: 0x8ca9,
  COLOR_BUFFER_BIT: 0x4000, NEAREST: 0x2600, LINEAR: 0x2601, PIXEL_PACK_BUFFER: 0x88eb,
  PACK_ALIGNMENT: 0x0d05, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  SYNC_STATUS: 0x9114, SIGNALED: 0x9119, UNSIGNALED: 0x9118, STREAM_READ: 0x88e1,
  RENDERBUFFER: 0x8d41, RGBA8: 0x8058, COLOR_ATTACHMENT0: 0x8ce0,
};

/** Just enough WebGL2 to follow the reader: records blits, fences that the
 *  test signals, and buffers whose bytes say which read they belong to. */
function fakeGl(opts: { antialias?: boolean; error?: number; scissor?: boolean } = {}) {
  let nextId = 1;
  const blits: number[][] = [];
  const syncs: { id: number; signalled: boolean }[] = [];
  const bufferTag = new Map<number, number>();
  let packBuffer: number | null = null;
  let reads = 0;
  let error = opts.error ?? GL.NO_ERROR;
  const scissor = { on: !!opts.scissor };
  const gl = {
    ...GL,
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    getContextAttributes: () => ({ antialias: !!opts.antialias }),
    getError: () => { const e = error; error = GL.NO_ERROR; return e; },
    isEnabled: () => scissor.on,
    enable: vi.fn(() => { scissor.on = true; }),
    disable: vi.fn(() => { scissor.on = false; }),
    createFramebuffer: () => ({ id: nextId++ }),
    createRenderbuffer: () => ({ id: nextId++ }),
    createBuffer: () => ({ id: nextId++ }),
    bindFramebuffer: () => {},
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    framebufferRenderbuffer: () => {},
    blitFramebuffer: (...a: number[]) => { blits.push(a.slice(0, 8)); },
    bindBuffer: (_t: number, b: { id: number } | null) => { packBuffer = b?.id ?? null; },
    bufferData: vi.fn(),
    pixelStorei: () => {},
    readPixels: () => { if (packBuffer !== null) bufferTag.set(packBuffer, ++reads); },
    fenceSync: () => { const s = { id: nextId++, signalled: false }; syncs.push(s); return s; },
    flush: () => {},
    getSyncParameter: (s: { signalled: boolean }) => (s.signalled ? GL.SIGNALED : GL.UNSIGNALED),
    deleteSync: () => {},
    getBufferSubData: (_t: number, _o: number, dst: Uint8Array) => { dst.fill(bufferTag.get(packBuffer!) ?? 0); },
    deleteBuffer: () => {},
    deleteFramebuffer: () => {},
    deleteRenderbuffer: () => {},
  };
  return { gl: gl as unknown as WebGL2RenderingContext, raw: gl, blits, syncs, scissor };
}

describe('stage frame reader', () => {
  it('copies the crop flipped top-down and scales only when the size differs', () => {
    const f = fakeGl();
    const reader = new StageFrameReader(f.gl);
    expect(reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080, () => {}, () => {})).toBe(true);
    // Source in GL's bottom-up rows, destination rows reversed.
    expect(f.blits[0]).toEqual([0, 0, 1920, 1080, 0, 1080, 1920, 0]);
    // A centred crop of a wider view, scaled down.
    expect(reader.read({ x: 240, y: 0, w: 1440, h: 1080 }, 640, 360, () => {}, () => {})).toBe(true);
    expect(f.blits[1]).toEqual([240, 0, 1680, 1080, 0, 360, 640, 0]);
    // y crop: a 100 px band at the top of the canvas is the top of GL's rows.
    expect(reader.read({ x: 0, y: 0, w: 1920, h: 100 }, 1920, 100, () => {}, () => {})).toBe(true);
    expect(f.blits[2]).toEqual([0, 980, 1920, 1080, 0, 100, 1920, 0]);
    reader.dispose();
  });

  it('hands frames over in order once their fences signal, without waiting', () => {
    const f = fakeGl();
    const reader = new StageFrameReader(f.gl);
    const got: number[] = [];
    for (let i = 0; i < 3; i++) reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 4, 2, (fr) => got.push(fr.data[0]), () => {});
    reader.poll();
    expect(got).toEqual([]);
    // The second finishes first: nothing is handed over out of order.
    f.syncs[1].signalled = true;
    reader.poll();
    expect(got).toEqual([]);
    f.syncs[0].signalled = true;
    reader.poll();
    expect(got).toEqual([1, 2]);
    f.syncs[2].signalled = true;
    reader.poll();
    expect(got).toEqual([1, 2, 3]);
    expect(reader.pendingCount).toBe(0);
    reader.dispose();
  });

  it('reuses its pixel buffers and allocates only for a new size', () => {
    const f = fakeGl();
    const reader = new StageFrameReader(f.gl);
    for (let i = 0; i < 6; i++) {
      reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 8, 8, () => {}, () => {});
      f.syncs[i].signalled = true;
      reader.poll();
    }
    expect(f.raw.bufferData).toHaveBeenCalledTimes(1);
    reader.dispose();
  });

  it('flush copies out everything still queued; dispose fails what is left', () => {
    const f = fakeGl();
    const reader = new StageFrameReader(f.gl);
    const got: number[] = [];
    const failed: string[] = [];
    reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 2, 2, (fr) => got.push(fr.data[0]), () => {});
    reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 2, 2, (fr) => got.push(fr.data[0]), () => {});
    reader.flush();
    expect(got).toEqual([1, 2]);
    reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 2, 2, () => {}, (e) => failed.push(e.message));
    reader.dispose();
    expect(failed).toEqual(['stage frame reader disposed']);
    expect(reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 2, 2, () => {}, () => {})).toBe(false);
  });

  it('refuses when the GPU reports an error on the first copy at a size', () => {
    const f = fakeGl();
    const reader = new StageFrameReader(f.gl);
    // getError is read once to clear old errors and once after the copy.
    let calls = 0;
    f.raw.getError = () => (++calls === 2 ? 0x0502 : GL.NO_ERROR);
    expect(reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 4, 4, () => {}, () => {})).toBe(false);
    reader.dispose();
  });

  it('resolves a multisampled view before scaling, and leaves scissor as it was', () => {
    const f = fakeGl({ antialias: true, scissor: true });
    const reader = new StageFrameReader(f.gl);
    reader.read({ x: 0, y: 0, w: 1920, h: 1080 }, 960, 540, () => {}, () => {});
    expect(f.blits[0]).toEqual([0, 0, 1920, 1080, 0, 0, 1920, 1080]);
    expect(f.blits[1]).toEqual([0, 0, 1920, 1080, 0, 540, 960, 0]);
    expect(f.raw.disable).toHaveBeenCalledWith(GL.SCISSOR_TEST);
    expect(f.scissor.on).toBe(true);
    reader.dispose();
  });
});
