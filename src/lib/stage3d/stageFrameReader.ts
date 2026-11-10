/**
 * Asynchronous readback of the stage view's just-drawn frame (WebGL2).
 *
 * The old capture copied the WebGL canvas into a CPU 2D canvas and called
 * getImageData: a synchronous GPU→CPU round trip on the render thread for
 * every recorded frame. Here the frame is blitted (cropped, scaled and
 * flipped top-down on the GPU) into a small framebuffer, read into a pixel
 * buffer object, and fenced. The bytes are copied out a frame or two later,
 * once the GPU says the copy is done, so the render loop never waits on it.
 */

export interface FrameCrop { x: number; y: number; w: number; h: number }

export interface StageReadback {
  data: Uint8Array;
  width: number;
  height: number;
}

interface Slot {
  pbo: WebGLBuffer;
  sync: WebGLSync | null;
  width: number;
  height: number;
  done: ((frame: StageReadback) => void) | null;
  fail: ((err: Error) => void) | null;
}

/** Reads queued at once before the oldest is copied out without waiting. */
const MAX_PENDING = 4;
/** How often pending reads are checked between renders (ms). */
const POLL_MS = 3;

export class StageFrameReader {
  private gl: WebGL2RenderingContext;
  private fbo: WebGLFramebuffer | null = null;
  private colour: WebGLRenderbuffer | null = null;
  private resolveFbo: WebGLFramebuffer | null = null;
  private resolveColour: WebGLRenderbuffer | null = null;
  private size = { w: 0, h: 0 };
  private resolveSize = { w: 0, h: 0 };
  private free: WebGLBuffer[] = [];
  private pending: Slot[] = [];
  private bufferBytes = new Map<WebGLBuffer, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private multisampled: boolean;
  /** Sizes whose first copy was checked for GL errors. getError waits for
   *  the GPU process, so later copies at a checked size skip it. */
  private checked = new Set<string>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.multisampled = !!gl.getContextAttributes()?.antialias;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Queue a copy of the default framebuffer, as drawn right now. `crop` is
   * in canvas pixels with a top-left origin; the result is `width`×`height`
   * RGBA with the first row at the top. Must run in the same task as the
   * draw (the canvas does not keep its drawing buffer). Returns false when
   * the GPU refused the copy; the caller then reads the frame another way.
   */
  read(
    crop: FrameCrop,
    width: number,
    height: number,
    done: (frame: StageReadback) => void,
    fail: (err: Error) => void,
  ): boolean {
    if (this.disposed) return false;
    const gl = this.gl;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const canvasH = gl.drawingBufferHeight;
    const canvasW = gl.drawingBufferWidth;
    // GL's origin is bottom-left.
    const sx0 = clampInt(crop.x, 0, canvasW);
    const sx1 = clampInt(crop.x + crop.w, 0, canvasW);
    const sy0 = clampInt(canvasH - (crop.y + crop.h), 0, canvasH);
    const sy1 = clampInt(canvasH - crop.y, 0, canvasH);
    if (sx1 <= sx0 || sy1 <= sy0) return false;
    while (this.pending.length >= MAX_PENDING) this.finishOldest(true);
    const key = `${canvasW}x${canvasH}>${w}x${h}`;
    const check = !this.checked.has(key);
    if (check) for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* clear stale errors */ }
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    try {
      if (scissor) gl.disable(gl.SCISSOR_TEST);
      this.ensureTarget(w, h);
      let readFbo: WebGLFramebuffer | null = null;
      // A multisampled drawing buffer cannot be scaled in one blit: resolve
      // it at its own size first.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      if (this.multisampled) {
        this.ensureResolve(canvasW, canvasH);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
        gl.blitFramebuffer(0, 0, canvasW, canvasH, 0, 0, canvasW, canvasH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        readFbo = this.resolveFbo;
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
      const sameSize = sx1 - sx0 === w && sy1 - sy0 === h;
      // Destination rows reversed: the copy comes out top-down.
      gl.blitFramebuffer(sx0, sy0, sx1, sy1, 0, h, w, 0, gl.COLOR_BUFFER_BIT, sameSize ? gl.NEAREST : gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
      const pbo = this.takeBuffer(w * h * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      if (!sync || (check && gl.getError() !== gl.NO_ERROR)) {
        if (sync) gl.deleteSync(sync);
        this.free.push(pbo);
        return false;
      }
      if (check) this.checked.add(key);
      this.pending.push({ pbo, sync, width: w, height: h, done, fail });
      this.schedulePoll();
      return true;
    } catch {
      return false;
    } finally {
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
  }

  /** Hand over every read the GPU has finished, oldest first. */
  poll(): void {
    while (this.pending.length > 0) {
      const head = this.pending[0];
      const status = head.sync ? this.gl.getSyncParameter(head.sync, this.gl.SYNC_STATUS) : this.gl.SIGNALED;
      if (status !== this.gl.SIGNALED) break;
      this.finishOldest(false);
    }
    if (this.pending.length > 0) this.schedulePoll();
  }

  /** Copy out everything still queued now (stalls until the GPU is done). */
  flush(): void {
    while (this.pending.length > 0) this.finishOldest(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const gl = this.gl;
    for (const slot of this.pending.splice(0)) {
      if (slot.sync) gl.deleteSync(slot.sync);
      gl.deleteBuffer(slot.pbo);
      this.bufferBytes.delete(slot.pbo);
      slot.fail?.(new Error('stage frame reader disposed'));
    }
    for (const b of this.free.splice(0)) gl.deleteBuffer(b);
    this.bufferBytes.clear();
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.colour) gl.deleteRenderbuffer(this.colour);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);
    if (this.resolveColour) gl.deleteRenderbuffer(this.resolveColour);
    this.fbo = this.colour = this.resolveFbo = this.resolveColour = null;
  }

  private finishOldest(force: boolean): void {
    const slot = this.pending.shift();
    if (!slot) return;
    const gl = this.gl;
    try {
      if (!force && slot.sync && gl.getSyncParameter(slot.sync, gl.SYNC_STATUS) !== gl.SIGNALED) {
        this.pending.unshift(slot);
        return;
      }
      const data = new Uint8Array(slot.width * slot.height * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (slot.sync) gl.deleteSync(slot.sync);
      this.free.push(slot.pbo);
      slot.done?.({ data, width: slot.width, height: slot.height });
    } catch (err) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (slot.sync) gl.deleteSync(slot.sync);
      gl.deleteBuffer(slot.pbo);
      this.bufferBytes.delete(slot.pbo);
      slot.fail?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private schedulePoll(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed) this.poll();
    }, POLL_MS);
  }

  private takeBuffer(bytes: number): WebGLBuffer {
    const gl = this.gl;
    const pbo = this.free.pop() ?? gl.createBuffer();
    if (!pbo) throw new Error('could not create a pixel buffer');
    if (this.bufferBytes.get(pbo) !== bytes) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.bufferBytes.set(pbo, bytes);
    }
    return pbo;
  }

  private ensureTarget(w: number, h: number): void {
    if (this.fbo && this.size.w === w && this.size.h === h) return;
    const gl = this.gl;
    if (!this.fbo) this.fbo = gl.createFramebuffer();
    if (!this.colour) this.colour = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.colour);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colour);
    this.size = { w, h };
    // Buffers sized for the old frame are re-sized on their next use.
  }

  private ensureResolve(w: number, h: number): void {
    if (this.resolveFbo && this.resolveSize.w === w && this.resolveSize.h === h) return;
    const gl = this.gl;
    if (!this.resolveFbo) this.resolveFbo = gl.createFramebuffer();
    if (!this.resolveColour) this.resolveColour = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.resolveColour);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.resolveColour);
    this.resolveSize = { w, h };
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
