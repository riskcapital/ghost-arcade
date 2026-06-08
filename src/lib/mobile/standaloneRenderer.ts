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
import { findMobileEffect, type MobileEffectInstance } from './standaloneEffects';

/** Wedge audio reactivity into shaders that don't already reference audio
 *  uniforms. Inserts a brightness/color-tilt patch right before main()'s
 *  closing brace. ISF shaders are guaranteed to put main() last in the
 *  file (the parser appends nothing after), so the last `}` is main's. */
/** Per-shader audio reactivity patches. Each item runs a regex
 *  match/replace on the parsed fragment shader source. The match
 *  targets a specific GLSL hook in the shader's body (e.g. the line
 *  that uses `speed`, the line that computes `hueOffset`); the
 *  replacement weaves audio uniforms into that line.
 *
 *  This is qualitatively better than `injectUniversalAudioPatch`
 *  because it modulates the shader's actual motion/colour
 *  parameters rather than just multiplying the output `gl_FragColor`
 *  at the end. Speed-modulated shaders feel like they're moving with
 *  the music; brightness-modulated ones just pulse.
 *
 *  Each pattern is independent — if a regex doesn't match (shader
 *  rewritten upstream, parseISF moved a line), we skip silently
 *  rather than corrupt the GLSL and break compile. */
function applyShaderInjectPatches(
  glsl: string,
  patches: { match: RegExp; replace: string }[],
): string {
  let out = glsl;
  for (const p of patches) {
    if (p.match.test(out)) {
      out = out.replace(p.match, p.replace);
    }
  }
  return out;
}

function injectUniversalAudioPatch(glsl: string): string {
  const last = glsl.lastIndexOf('}');
  if (last < 0) return glsl;
  // Elegant audio response — relies on the Milkdrop-smoothed
  // audioBass/Mid/High/Level coming in from standaloneAudio.ts. Lots
  // of slow brightness lift via audioLevel (smooth, no flash);
  // audioBeat (onset envelope) gives a soft accent rather than a
  // hard 55% pulse. The colour tilt by Bass/High is a gentle warm/
  // cool drift toward the dominant band.
  const patch = `
  // Mobile augment: auto-injected smooth audio reactivity
  // (Milkdrop-style smoothing applied upstream in standaloneAudio.ts)
  {
    float _gaBeat  = clamp(audioBeat,  0.0, 1.0);
    float _gaLevel = clamp(audioLevel, 0.0, 1.0);
    float _gaTilt  = clamp(audioHigh - audioBass, -1.0, 1.0);
    // Continuous brightness from the smoothed level (no strobe);
    // beat adds a subtle ping on top, not a full flash.
    gl_FragColor.rgb *= 1.0 + _gaLevel * 0.35 + _gaBeat * 0.12;
    // Warm/cool drift toward the dominant band — soft mix.
    gl_FragColor.rgb = mix(
      gl_FragColor.rgb,
      gl_FragColor.rgb * vec3(1.0 + audioHigh * 0.22, 1.0, 1.0 + audioBass * 0.22),
      0.35
    );
    gl_FragColor.rgb += vec3(_gaTilt * 0.04, 0.0, -_gaTilt * 0.04);
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

/** Compiled effect program + its uniform locations, cached so we don't
 *  re-link a 1-pass shader every frame. */
interface CompiledEffect {
  program: WebGLProgram;
  uInput: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  params: Map<string, WebGLUniformLocation | null>;
}

/** Framebuffer + colour texture pair, sized to the canvas. */
interface FBO {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
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
  // Per-clip params. The host (StandaloneApp) sets these whenever a
  // slot is launched onto this deck; they ride alongside the audio
  // uniforms and bake in at render time, so no shader patching is
  // needed — `clipSpeed` scales the TIME value we publish (frozen at
  // 0, normal at 1, fast at 2+) and `clipIntensity` scales the audio
  // band values (0 = no reactivity, 1 = normal, >1 = exaggerated).
  // Time is accumulated separately so changing speed mid-clip doesn't
  // jump the shader's phase.
  private clipSpeed = 1;
  private clipIntensity = 1;
  private scaledTime = 0;
  // Effect chain — passes applied after the layer's source shader runs.
  // The renderer ping-pongs two FBOs sized to the canvas, so adding /
  // removing effects mid-frame is cheap (no reallocation unless the
  // canvas resizes).
  private effectChain: MobileEffectInstance[] = [];
  private effectCache = new Map<string, CompiledEffect>();
  private fbos: [FBO | null, FBO | null] = [null, null];

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
   *
   *  `audioNative=false` triggers automatic audio reactivity injection:
   *    1. If the shader's catalog entry includes `audioInject` (regex
   *       match/replace pairs targeting specific GLSL hooks like
   *       `float t = TIME * speed;`), those run first — they hook the
   *       shader's actual motion/colour params for nuanced reactivity.
   *    2. If no per-shader patches are present, the universal patch
   *       runs as a fallback — a generic brightness/colour tilt
   *       applied at end-of-main, so the shader still "feels alive"
   *       with audio.
   *
   *  Per-shader patches are the higher-quality path (they make the
   *  shader's existing motion react instead of just modulating its
   *  output colour) — see `standaloneShaderList.ts` for the regex
   *  pairs. Native shaders (those already reading audioBass/Mid/etc.
   *  in their .fs source) bypass both paths. */
  async loadShaderSource(
    source: string,
    audioNative = true,
    audioInject?: { match: RegExp; replace: string }[],
  ): Promise<void> {
    const parsed: ParsedISF = parseISF(source);
    let frag = parsed.fragmentShader;
    if (!audioNative) {
      if (audioInject && audioInject.length > 0) {
        frag = applyShaderInjectPatches(frag, audioInject);
      } else {
        frag = injectUniversalAudioPatch(frag);
      }
    }
    const program = this.compile(VERTEX_SHADER, frag);
    if (this.program) this.gl.deleteProgram(this.program);
    this.program = program;
    this.inputs = parsed.metadata.INPUTS ?? [];
    this.locs = this.cacheLocations(program, this.inputs);
    this.startTime = performance.now();
    this.frameIndex = 0;
    this.scaledTime = 0;
  }

  /** Updated each frame by the host (StandaloneApp) before render. */
  setAudio(u: AudioUniforms) { this.audio = u; }

  /** Per-clip params from the host. `speed` 0..3 (1 = normal) scales
   *  the published TIME value; `intensity` 0..2 scales the audio
   *  uniforms. Mid-clip changes are continuous — speed adjusts the
   *  rate at which `scaledTime` accumulates, so the shader's animation
   *  phase doesn't jump. */
  setClipParams(p: { speed?: number; intensity?: number }) {
    if (typeof p.speed === 'number')     this.clipSpeed = Math.max(0, Math.min(3, p.speed));
    if (typeof p.intensity === 'number') this.clipIntensity = Math.max(0, Math.min(2, p.intensity));
  }

  /** Set the post-process effect chain for this layer. Pass an empty
   *  array to bypass. Effects with `enabled: false` are skipped. */
  setEffectChain(chain: MobileEffectInstance[]): void {
    this.effectChain = chain.filter(e => e.enabled);
  }

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
    for (const fbo of this.fbos) {
      if (!fbo) continue;
      gl.deleteFramebuffer(fbo.fb);
      gl.deleteTexture(fbo.tex);
    }
    this.fbos = [null, null];
    for (const compiled of this.effectCache.values()) {
      gl.deleteProgram(compiled.program);
    }
    this.effectCache.clear();
  }

  private render() {
    const gl = this.gl;
    if (!this.program || !this.locs) return;

    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    // Accumulate scaled time — multiplying real elapsed seconds by
    // clipSpeed lets the user freeze (0), slow-mo (0.5), or rocket (2+)
    // the shader without jumping its animation phase when they twiddle
    // the slider mid-set.
    this.scaledTime += dt * this.clipSpeed;
    const time = this.scaledTime;

    this.resize();

    // Effect chain present? Render the source shader into FBO 0, then
    // ping-pong each effect, last writes to the default framebuffer
    // (the canvas). When the chain is empty we skip the FBO dance and
    // render straight to canvas — same hot path as before.
    const usingChain = this.effectChain.length > 0;
    if (usingChain) {
      this.ensureFBOs(this.canvas.width, this.canvas.height);
      const target = this.fbos[0]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

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

    // Audio scalars (matched to desktop's uniform set per shader-curation audit).
    // clipIntensity scales each one — 0 freezes reactivity, 1 = normal,
    // up to 2 for an exaggerated mix. Beat keeps its 0..1 clamp so an
    // intensity boost can't push it above the threshold shaders test
    // against.
    const a = this.audio;
    const ai = this.clipIntensity;
    if (L.audioBass) gl.uniform1f(L.audioBass, a.audioBass * ai);
    if (L.audioMid) gl.uniform1f(L.audioMid, a.audioMid * ai);
    if (L.audioHigh) gl.uniform1f(L.audioHigh, a.audioHigh * ai);
    if (L.audioLevel) gl.uniform1f(L.audioLevel, a.audioLevel * ai);
    if (L.audioBeat) gl.uniform1f(L.audioBeat, Math.min(1, a.audioBeat * ai));

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

    if (usingChain) this.runEffectChain(time);
  }

  /** Walk the effect chain, ping-ponging between FBO 0 and FBO 1. The
   *  final effect always writes to the default framebuffer (canvas). */
  private runEffectChain(time: number): void {
    const gl = this.gl;
    const chain = this.effectChain;
    if (chain.length === 0) return;

    let src = 0;        // FBO containing the previous pass's output
    let dst = 1;        // FBO to write the current pass into

    for (let i = 0; i < chain.length; i++) {
      const isLast = i === chain.length - 1;
      if (isLast) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      } else {
        const out = this.fbos[dst]!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
        gl.viewport(0, 0, out.w, out.h);
      }
      this.applyEffectPass(chain[i], this.fbos[src]!.tex, time);
      if (!isLast) {
        const tmp = src; src = dst; dst = tmp;
      }
    }
  }

  private applyEffectPass(inst: MobileEffectInstance, inputTex: WebGLTexture, time: number): void {
    const gl = this.gl;
    const compiled = this.getOrCompileEffect(inst.type);
    if (!compiled) return;

    gl.useProgram(compiled.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const posLoc = gl.getAttribLocation(compiled.program, 'position');
    const uvLoc = gl.getAttribLocation(compiled.program, 'uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
    if (uvLoc >= 0) {
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    if (compiled.uInput) gl.uniform1i(compiled.uInput, 0);
    if (compiled.uResolution) gl.uniform2f(compiled.uResolution, this.canvas.width, this.canvas.height);
    if (compiled.uTime) gl.uniform1f(compiled.uTime, time);

    // Push per-effect params. Missing params fall back to the def's
    // default value so a half-configured effect still renders.
    const def = findMobileEffect(inst.type);
    if (def) {
      for (const [name, loc] of compiled.params) {
        if (!loc) continue;
        const v = inst.params[name];
        gl.uniform1f(loc, typeof v === 'number' ? v : (def.defaults[name] ?? 0));
      }
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private getOrCompileEffect(type: string): CompiledEffect | null {
    const hit = this.effectCache.get(type);
    if (hit) return hit;
    const def = findMobileEffect(type);
    if (!def) return null;
    const gl = this.gl;
    const program = this.compile(VERTEX_SHADER, def.fragment);
    const params = new Map<string, WebGLUniformLocation | null>();
    for (const k of Object.keys(def.defaults)) {
      params.set(k, gl.getUniformLocation(program, k));
    }
    const compiled: CompiledEffect = {
      program,
      uInput: gl.getUniformLocation(program, 'uInput'),
      uResolution: gl.getUniformLocation(program, 'uResolution'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      params,
    };
    this.effectCache.set(type, compiled);
    return compiled;
  }

  /** Allocate / re-allocate the two ping-pong FBOs so they match the
   *  current canvas size. Cheap to call every frame — only does work
   *  when the canvas actually resized. */
  private ensureFBOs(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    for (let i = 0; i < 2; i++) {
      const cur = this.fbos[i];
      if (cur && cur.w === w && cur.h === h) continue;
      if (cur) {
        this.gl.deleteFramebuffer(cur.fb);
        this.gl.deleteTexture(cur.tex);
      }
      this.fbos[i] = this.createFBO(w, h);
    }
  }

  private createFBO(w: number, h: number): FBO {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error('FBO alloc failed');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
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
