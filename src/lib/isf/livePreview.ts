// Animated ISF shader preview — sibling to ./thumbnail.ts.
//
// thumbnail.ts is a shared serial queue that renders ONE frame to a
// shared 120x68 offscreen canvas. That's right for "draw a thumbnail
// to a list cell" but wrong for the VJ preview panel, where we need:
//   - our own canvas the user can see
//   - a render loop driving TIME / FRAMEINDEX
//   - reactive shader value changes (param sliders) without rebuilding
//   - clean dispose when the panel closes
//
// One LivePreview = one running shader. The class manages its own
// WebGL context + program + uniform locations and runs a rAF loop.

import { parseISF, getInputDefault, type ISFInput } from './parser';

const VS_SOURCE = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

interface InputBinding {
  input: ISFInput;
  location: WebGLUniformLocation | null;
}

export interface LivePreviewOptions {
  /** Shader source — full ISF document with metadata header. */
  shaderCode: string;
  /** Where to render. Caller controls width/height; we read canvas.width/height each frame. */
  canvas: HTMLCanvasElement;
  /** Initial param values (NAME → number | bool | number[]). Anything not
   *  listed falls back to the parsed-default for that input. */
  initialValues?: Record<string, unknown>;
}

export class LivePreview {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private inputs: InputBinding[] = [];
  private values: Record<string, unknown> = {};
  private uTime: WebGLUniformLocation | null = null;
  private uTimeDelta: WebGLUniformLocation | null = null;
  private uRenderSize: WebGLUniformLocation | null = null;
  private uFrameIndex: WebGLUniformLocation | null = null;
  private uDate: WebGLUniformLocation | null = null;
  private rafId: number | null = null;
  private startTime = 0;
  private lastTime = 0;
  private frameIndex = 0;
  private texturesToCleanup: WebGLTexture[] = [];
  private destroyed = false;
  /** Caller can flip this to pause the loop without disposing. */
  paused = false;

  constructor(opts: LivePreviewOptions) {
    this.canvas = opts.canvas;
    this.values = { ...(opts.initialValues || {}) };

    const gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: false, antialias: true });
    if (!gl) {
      console.error('[LivePreview] WebGL not available');
      return;
    }
    this.gl = gl;

    if (!this.compileProgram(opts.shaderCode)) return;
    this.cacheUniformLocations();

    this.startTime = performance.now() / 1000;
    this.lastTime = this.startTime;
    this.tick = this.tick.bind(this);
    this.rafId = requestAnimationFrame(this.tick);
  }

  // ────── shader compile ──────

  private compileProgram(shaderCode: string): boolean {
    const gl = this.gl!;
    const parsed = parseISF(shaderCode);

    const vs = this.compileShader(VS_SOURCE, gl.VERTEX_SHADER);
    if (!vs) return false;
    const fs = this.compileShader(parsed.fragmentShader, gl.FRAGMENT_SHADER);
    if (!fs) {
      gl.deleteShader(vs);
      return false;
    }

    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[LivePreview] link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return false;
    }

    this.program = prog;
    gl.useProgram(prog);

    // Position attribute (full-screen quad — same as thumbnail.ts)
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Cache one binding per declared INPUT so updates are O(1)
    this.inputs = parsed.metadata.INPUTS.map(input => ({
      input,
      location: gl.getUniformLocation(prog, input.NAME),
    }));

    return true;
  }

  private compileShader(source: string, type: number): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[LivePreview] shader compile error:', gl.getShaderInfoLog(shader));
      console.warn(source.slice(0, 500));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private cacheUniformLocations(): void {
    const gl = this.gl!;
    const prog = this.program!;
    this.uTime = gl.getUniformLocation(prog, 'TIME');
    this.uTimeDelta = gl.getUniformLocation(prog, 'TIMEDELTA');
    this.uRenderSize = gl.getUniformLocation(prog, 'RENDERSIZE');
    this.uFrameIndex = gl.getUniformLocation(prog, 'FRAMEINDEX');
    this.uDate = gl.getUniformLocation(prog, 'DATE');
  }

  // ────── public API ──────

  /** Set a single param value. Coerces to the input's type so callers can
   *  pass loose data (e.g. a numeric string from a slider). */
  setValue(name: string, value: unknown): void {
    this.values[name] = value;
  }

  /** Replace the full param map at once. */
  setValues(values: Record<string, unknown>): void {
    this.values = { ...values };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    const gl = this.gl;
    if (!gl) return;
    if (this.program) gl.deleteProgram(this.program);
    if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
    for (const tex of this.texturesToCleanup) gl.deleteTexture(tex);
    this.texturesToCleanup = [];
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }

  // ────── render loop ──────

  private tick(now: number): void {
    if (this.destroyed) return;
    this.rafId = requestAnimationFrame(this.tick);
    if (this.paused) return;
    this.render(now / 1000);
  }

  private render(nowSec: number): void {
    const gl = this.gl;
    const prog = this.program;
    const canvas = this.canvas;
    if (!gl || !prog) return;

    const t = nowSec - this.startTime;
    const dt = nowSec - this.lastTime;
    this.lastTime = nowSec;
    this.frameIndex++;

    // Track CSS-sized canvas — devicePixelRatio kept at 1 for preview
    // performance; the panel target is small (~320x180) so DPR > 1
    // wastes fragment work without visible benefit.
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = canvas.clientWidth || 320;
      canvas.height = canvas.clientHeight || 180;
    }

    gl.useProgram(prog);
    gl.viewport(0, 0, canvas.width, canvas.height);

    if (this.uTime) gl.uniform1f(this.uTime, t);
    if (this.uTimeDelta) gl.uniform1f(this.uTimeDelta, dt);
    if (this.uRenderSize) gl.uniform2f(this.uRenderSize, canvas.width, canvas.height);
    if (this.uFrameIndex) gl.uniform1i(this.uFrameIndex, this.frameIndex);
    if (this.uDate) {
      const d = new Date();
      gl.uniform4f(this.uDate, d.getFullYear(), d.getMonth(), d.getDate(),
                   d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
    }

    // Apply user-supplied param values, falling back to the input's parsed default
    for (const { input, location } of this.inputs) {
      if (!location) continue;
      const raw = this.values[input.NAME];
      const value = raw !== undefined ? raw : getInputDefault(input);
      switch (input.TYPE) {
        case 'float':
        case 'event':
          gl.uniform1f(location, Number(value) || 0);
          break;
        case 'bool':
          gl.uniform1i(location, value ? 1 : 0);
          break;
        case 'long':
          gl.uniform1i(location, Math.floor(Number(value) || 0));
          break;
        case 'point2D': {
          const p = Array.isArray(value) ? value : [0.5, 0.5];
          gl.uniform2f(location, Number(p[0]) || 0, Number(p[1]) || 0);
          break;
        }
        case 'color': {
          const c = Array.isArray(value) ? value : [1, 1, 1, 1];
          gl.uniform4f(location, Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0, c[3] !== undefined ? Number(c[3]) : 1);
          break;
        }
        case 'image':
          // Image inputs are rare for the geometric pack and would need a
          // texture pipeline. Skip gracefully — the GLSL declares the
          // sampler but we leave it bound to whatever's at unit 0.
          break;
      }
    }

    // Audio uniforms — zero out since the preview doesn't tap into the
    // global audio analyser. Once the FFT routing sprint lands, swap
    // these to read from the analyser store.
    const audioFloats = [
      'audioLevel', 'audioBass', 'audioMid', 'audioHigh',
      'audioBeat', 'audioBeatPhase', 'audioBPM', 'audioSpectralCentroid',
    ];
    for (const name of audioFloats) {
      const loc = gl.getUniformLocation(prog, name);
      if (loc) gl.uniform1f(loc, 0);
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
