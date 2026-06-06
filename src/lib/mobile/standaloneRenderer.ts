// Minimal WebGL2 ISF runner for the Ghost Arcade Mobile standalone path.
// Loads an ISF shader, compiles it onto a fullscreen quad, drives the
// audio + TIME + RENDERSIZE uniforms each frame. No Three.js — keeps the
// mobile bundle lean.
//
// The shader pipeline reuses `parseISF` from src/lib/isf/parser.ts, which
// auto-injects the standard ISF uniform set including audio scalars
// (audioBass/Mid/High/Level/Beat) plus audioFFT/audioWaveform samplers
// and helper functions. The renderer's job is just to bind values.

import { parseISF, getInputDefault, type ParsedISF, type ISFInput } from '../isf/parser';
import type { AudioUniforms } from './standaloneAudio';
import { SILENT_AUDIO } from './standaloneAudio';

/** Wedge audio reactivity into shaders that don't already reference audio
 *  uniforms. Inserts a brightness/color-tilt patch right before main()'s
 *  closing brace. ISF shaders are guaranteed to put main() last in the
 *  file (the parser appends nothing after), so the last `}` is main's. */
function injectUniversalAudioPatch(glsl: string): string {
  const last = glsl.lastIndexOf('}');
  if (last < 0) return glsl;
  const patch = `
  // Mobile augment: auto-injected audio reactivity (see standaloneRenderer.ts)
  {
    float _gaBeat = clamp(audioBeat, 0.0, 1.0);
    float _gaLevel = clamp(audioLevel, 0.0, 1.0);
    float _gaTilt = clamp(audioHigh - audioBass, -1.0, 1.0);
    gl_FragColor.rgb *= 1.0 + _gaBeat * 0.55 + _gaLevel * 0.25;
    gl_FragColor.rgb = mix(
      gl_FragColor.rgb,
      gl_FragColor.rgb * vec3(1.0 + audioHigh * 0.35, 1.0, 1.0 + audioBass * 0.35),
      0.45
    );
    gl_FragColor.rgb += vec3(_gaTilt * 0.05, 0.0, -_gaTilt * 0.05);
  }
`;
  return glsl.slice(0, last) + patch + glsl.slice(last);
}

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

interface UniformLoc {
  TIME: WebGLUniformLocation | null;
  TIMEDELTA: WebGLUniformLocation | null;
  FRAMEINDEX: WebGLUniformLocation | null;
  RENDERSIZE: WebGLUniformLocation | null;
  audioBass: WebGLUniformLocation | null;
  audioMid: WebGLUniformLocation | null;
  audioHigh: WebGLUniformLocation | null;
  audioLevel: WebGLUniformLocation | null;
  audioBeat: WebGLUniformLocation | null;
  audioFFT: WebGLUniformLocation | null;
  audioWaveform: WebGLUniformLocation | null;
  inputs: Map<string, WebGLUniformLocation | null>;
}

export class StandaloneRenderer {
  private gl: WebGLRenderingContext;
  private quadBuffer: WebGLBuffer;
  private program: WebGLProgram | null = null;
  private locs: UniformLoc | null = null;
  private inputs: ISFInput[] = [];
  private audioFFTTex: WebGLTexture;
  private audioWaveformTex: WebGLTexture;
  private startTime = performance.now();
  private lastFrameTime = this.startTime;
  private frameIndex = 0;
  private rafId: number | null = null;
  private audio: AudioUniforms = { ...SILENT_AUDIO };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    this.quadBuffer = this.createQuad();
    this.audioFFTTex = this.createScratchTexture(256);
    this.audioWaveformTex = this.createScratchTexture(256);
    this.resize();
  }

  /** Bind a parsed ISF: compiles + links + caches uniform locations.
   *  `audioNative=false` injects a universal audio-reactivity patch right
   *  before the closing brace of `main()` — every non-native shader picks
   *  up a beat-pulse brightness + frequency-band color tilt so it still
   *  "feels alive" with audio. Native shaders are rendered unchanged. */
  async loadShaderSource(source: string, audioNative = true): Promise<void> {
    const parsed: ParsedISF = parseISF(source);
    let frag = parsed.fragmentShader;
    if (!audioNative) frag = injectUniversalAudioPatch(frag);
    const program = this.compile(VERTEX_SHADER, frag);
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = program;
    this.inputs = parsed.metadata.INPUTS ?? [];
    this.locs = this.cacheLocations(program, this.inputs);
    this.startTime = performance.now();
    this.frameIndex = 0;
  }

  /** Updated each frame by the host (StandaloneApp) before render. */
  setAudio(u: AudioUniforms) { this.audio = u; }

  /** Start the render loop. Idempotent — calling twice is a no-op. */
  start() {
    if (this.rafId !== null) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.render();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    const gl = this.gl;
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteTexture(this.audioFFTTex);
    gl.deleteTexture(this.audioWaveformTex);
    if (this.program) gl.deleteProgram(this.program);
  }

  private render() {
    const gl = this.gl;
    if (!this.program || !this.locs) return;

    const now = performance.now();
    const time = (now - this.startTime) / 1000;
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.resize();

    gl.useProgram(this.program);

    // Quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const posLoc = gl.getAttribLocation(this.program, 'position');
    const uvLoc = gl.getAttribLocation(this.program, 'uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
    if (uvLoc >= 0) {
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    }

    // Standard ISF uniforms
    const L = this.locs;
    if (L.TIME) gl.uniform1f(L.TIME, time);
    if (L.TIMEDELTA) gl.uniform1f(L.TIMEDELTA, dt);
    if (L.FRAMEINDEX) gl.uniform1i(L.FRAMEINDEX, this.frameIndex);
    if (L.RENDERSIZE) gl.uniform2f(L.RENDERSIZE, this.canvas.width, this.canvas.height);

    // Audio scalars (matched to desktop's uniform set per shader-curation audit)
    const a = this.audio;
    if (L.audioBass) gl.uniform1f(L.audioBass, a.audioBass);
    if (L.audioMid) gl.uniform1f(L.audioMid, a.audioMid);
    if (L.audioHigh) gl.uniform1f(L.audioHigh, a.audioHigh);
    if (L.audioLevel) gl.uniform1f(L.audioLevel, a.audioLevel);
    if (L.audioBeat) gl.uniform1f(L.audioBeat, a.audioBeat);

    // Audio samplers — stub textures bound on slots 0/1. The picked
    // ship-as-is shaders don't read these (they use scalars), but the
    // parser declares the uniforms unconditionally, so we bind something
    // to avoid driver complaints about unbound samplers.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.audioFFTTex);
    if (L.audioFFT) gl.uniform1i(L.audioFFT, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.audioWaveformTex);
    if (L.audioWaveform) gl.uniform1i(L.audioWaveform, 1);

    // Per-shader INPUTS: just push the default value. Sliders / preset
    // recall come in a later phase.
    for (const input of this.inputs) {
      const loc = L.inputs.get(input.NAME);
      if (!loc) continue;
      const def = getInputDefault(input);
      switch (input.TYPE) {
        case 'float':
        case 'event':
          gl.uniform1f(loc, typeof def === 'number' ? def : 0);
          break;
        case 'bool':
          gl.uniform1i(loc, def ? 1 : 0);
          break;
        case 'long':
          gl.uniform1i(loc, typeof def === 'number' ? def : 0);
          break;
        case 'point2D':
          if (Array.isArray(def)) gl.uniform2f(loc, def[0] ?? 0, def[1] ?? 0);
          break;
        case 'color':
          if (Array.isArray(def)) gl.uniform4f(loc, def[0] ?? 0, def[1] ?? 0, def[2] ?? 0, def[3] ?? 1);
          break;
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.frameIndex++;
  }

  private compile(vert: string, frag: string): WebGLProgram {
    const gl = this.gl;
    const v = this.compileStage(gl.VERTEX_SHADER, vert);
    const f = this.compileStage(gl.FRAGMENT_SHADER, frag);
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Shader link failed: ${info}`);
    }
    return program;
  }

  private compileStage(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'unknown compile error';
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${info}\n\n${source.slice(0, 600)}`);
    }
    return shader;
  }

  private cacheLocations(program: WebGLProgram, inputs: ISFInput[]): UniformLoc {
    const gl = this.gl;
    const inputLocs = new Map<string, WebGLUniformLocation | null>();
    for (const i of inputs) inputLocs.set(i.NAME, gl.getUniformLocation(program, i.NAME));
    return {
      TIME: gl.getUniformLocation(program, 'TIME'),
      TIMEDELTA: gl.getUniformLocation(program, 'TIMEDELTA'),
      FRAMEINDEX: gl.getUniformLocation(program, 'FRAMEINDEX'),
      RENDERSIZE: gl.getUniformLocation(program, 'RENDERSIZE'),
      audioBass: gl.getUniformLocation(program, 'audioBass'),
      audioMid: gl.getUniformLocation(program, 'audioMid'),
      audioHigh: gl.getUniformLocation(program, 'audioHigh'),
      audioLevel: gl.getUniformLocation(program, 'audioLevel'),
      audioBeat: gl.getUniformLocation(program, 'audioBeat'),
      audioFFT: gl.getUniformLocation(program, 'audioFFT'),
      audioWaveform: gl.getUniformLocation(program, 'audioWaveform'),
      inputs: inputLocs,
    };
  }

  private createQuad(): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer();
    if (!buf) throw new Error('createBuffer failed');
    // Two triangles, interleaved (pos.xyz, uv.xy). NDC fullscreen quad.
    const data = new Float32Array([
      -1, -1, 0,  0, 0,
       1, -1, 0,  1, 0,
      -1,  1, 0,  0, 1,
      -1,  1, 0,  0, 1,
       1, -1, 0,  1, 0,
       1,  1, 0,  1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  private createScratchTexture(size: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const data = new Uint8Array(size * 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
}
