// Standalone ISF Shader Renderer for Admin Tool
// Pure WebGL (no Three.js) — renders ISF shaders to canvas for preview & thumbnail generation

// ─── Audio uniform names ────────────────────────────────────────────────────
const AUDIO_FLOAT_UNIFORMS = [
  'audioLevel', 'audioBass', 'audioMid', 'audioHigh',
  'audioBeat', 'audioBeatPhase', 'audioBPM', 'audioSpectralCentroid'
];

// ─── Vertex shader ──────────────────────────────────────────────────────────
const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// ─── ISF Metadata Parser ────────────────────────────────────────────────────
export function parseISFMetadata(source) {
  try {
    const match = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
    if (!match) return { INPUTS: [] };
    return JSON.parse(match[1]);
  } catch {
    return { INPUTS: [] };
  }
}

// ─── Loop Fixer ─────────────────────────────────────────────────────────────
function fixShaderLoops(source) {
  let glsl = source;

  // Collect #define integer constants
  const defineConstants = new Set();
  const definePattern = /#define\s+(\w+)\s+(\d+)/g;
  let m;
  while ((m = definePattern.exec(glsl)) !== null) defineConstants.add(m[1]);

  function isConst(expr) {
    const t = expr.trim();
    return /^\s*-?\d+\s*$/.test(t) || defineConstants.has(t);
  }

  // Fix int loops with non-constant bounds
  glsl = glsl.replace(
    /for\s*\(\s*int\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([^;]+?);\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)/g,
    (match, v, init, cmp, limit, inc) => {
      if (isConst(init) && isConst(limit)) return match;
      return `for(int ${v} = ${isConst(init) ? init.trim() : '0'}; ${v} ${cmp} ${isConst(limit) ? limit.trim() : '100'}; ${v}${inc})`;
    }
  );

  // Fix variable loop bound
  glsl = glsl.replace(
    /for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\w+)\s*;\s*\1\s*\+\+\s*\)/g,
    (match, v, init, limitVar) => isConst(limitVar) ? match : `for(int ${v} = ${init}; ${v} < 64; ${v}++)`
  );

  // Fix float loops with non-constant init
  glsl = glsl.replace(
    /for\s*\(\s*float\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([\d.]+)\s*;\s*\1\s*(\+\+|--|\+=\s*[\d.]+|-=\s*[\d.]+)\s*\)/g,
    (match, v, init, cmp, limit, inc) => /^\s*-?[\d.]+\s*$/.test(init) ? match : `for(float ${v} = 0.0; ${v} ${cmp} ${limit}; ${v}${inc})`
  );

  return glsl;
}

// ─── ISF → WebGL GLSL Converter ─────────────────────────────────────────────
function convertISFtoGLSL(source, metadata) {
  let glsl = fixShaderLoops(source);

  const needsDerivatives = /\b(dFdx|dFdy|fwidth)\s*\(/.test(glsl);

  // Shadertoy compat
  glsl = glsl.replace(/^\s*vec3\s+iResolution\s*=\s*vec3\s*\(\s*RENDERSIZE\.x\s*,\s*RENDERSIZE\.y\s*,\s*[\d.]+\s*\)\s*;/gm,
    '#define iResolution vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0)');
  glsl = glsl.replace(/^\s*float\s+iTime\s*=\s*TIME\s*;/gm, '#define iTime TIME');

  // Remove precision blocks
  glsl = glsl.replace(/#ifdef\s+GL_ES\s*\n\s*precision\s+(highp|mediump|lowp)\s+float\s*;\s*\n\s*#endif/g, '');
  glsl = glsl.replace(/^precision\s+(highp|mediump|lowp)\s+float\s*;\s*$/gm, '');

  let decls = '';
  if (needsDerivatives) decls += '#extension GL_OES_standard_derivatives : enable\n';

  if (!glsl.includes('uniform vec2 RENDERSIZE')) decls += 'uniform vec2 RENDERSIZE;\n';
  if (glsl.includes('renderSize') && !glsl.includes('uniform vec2 renderSize')) decls += '#define renderSize RENDERSIZE\n';
  if (!glsl.includes('uniform float TIME')) decls += 'uniform float TIME;\n';
  if (!glsl.includes('uniform float TIMEDELTA')) decls += 'uniform float TIMEDELTA;\n';
  if (!glsl.includes('uniform int FRAMEINDEX')) decls += 'uniform int FRAMEINDEX;\n';
  if (!glsl.includes('uniform vec4 DATE')) decls += 'uniform vec4 DATE;\n';
  decls += 'varying vec2 vUv;\n';

  // Input uniforms
  for (const input of (metadata.INPUTS || [])) {
    const check = new RegExp(`uniform\\s+\\w+\\s+${input.NAME}\\s*;`);
    if (check.test(glsl)) continue;
    switch (input.TYPE) {
      case 'float': case 'event': decls += `uniform float ${input.NAME};\n`; break;
      case 'bool': decls += `uniform bool ${input.NAME};\n`; break;
      case 'long': decls += `uniform int ${input.NAME};\n`; break;
      case 'point2D': decls += `uniform vec2 ${input.NAME};\n`; break;
      case 'color': decls += `uniform vec4 ${input.NAME};\n`; break;
      case 'image':
        decls += `uniform sampler2D ${input.NAME};\nuniform vec2 _${input.NAME}_imgSize;\n`;
        break;
    }
  }

  // Helper functions
  if (!/vec4\s+IMG_NORM_PIXEL\s*\(/.test(glsl)) {
    decls += 'vec4 IMG_NORM_PIXEL(sampler2D img, vec2 uv) { return texture2D(img, uv); }\n';
  }
  if (!/vec4\s+IMG_PIXEL\s*\(/.test(glsl)) {
    decls += 'vec4 IMG_PIXEL(sampler2D img, vec2 coord) { return texture2D(img, coord / RENDERSIZE); }\n';
  }

  // Audio uniforms
  if (!glsl.includes('uniform sampler2D audioFFT')) decls += 'uniform sampler2D audioFFT;\n';
  if (!glsl.includes('uniform sampler2D audioWaveform')) decls += 'uniform sampler2D audioWaveform;\n';
  for (const name of AUDIO_FLOAT_UNIFORMS) {
    if (!glsl.includes(`uniform float ${name}`)) decls += `uniform float ${name};\n`;
  }
  if (!glsl.includes('float sampleFFT(')) decls += 'float sampleFFT(float u) { return texture2D(audioFFT, vec2(u, 0.5)).r; }\n';
  if (!glsl.includes('float sampleWaveform(')) decls += 'float sampleWaveform(float u) { return texture2D(audioWaveform, vec2(u, 0.5)).r * 2.0 - 1.0; }\n';

  decls += '#define isf_FragNormCoord (gl_FragCoord.xy / RENDERSIZE)\n';

  return `precision highp float;\n${decls}\n${glsl}`;
}

// ─── Get default value for input ────────────────────────────────────────────
export function getInputDefault(input) {
  if (input.DEFAULT !== undefined) return input.DEFAULT;
  switch (input.TYPE) {
    case 'float': return input.MIN ?? 0;
    case 'bool': return false;
    case 'long': return 0;
    case 'point2D': return [0.5, 0.5];
    case 'color': return [1, 1, 1, 1];
    default: return 0;
  }
}

// ─── Shared WebGL Context ───────────────────────────────────────────────────
let _canvas = null;
let _gl = null;
let _posBuf = null;

function getContext(width, height) {
  if (_gl && _gl.isContextLost()) { _canvas = null; _gl = null; _posBuf = null; }

  if (!_canvas || !_gl) {
    _canvas = document.createElement('canvas');
    _gl = _canvas.getContext('webgl', {
      preserveDrawingBuffer: true, alpha: false, antialias: false, powerPreference: 'default'
    });
    if (!_gl) return null;
    _gl.getExtension('OES_standard_derivatives');
    _posBuf = _gl.createBuffer();
    _gl.bindBuffer(_gl.ARRAY_BUFFER, _posBuf);
    _gl.bufferData(_gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), _gl.STATIC_DRAW);
  }

  _canvas.width = width;
  _canvas.height = height;
  return { canvas: _canvas, gl: _gl, posBuf: _posBuf };
}

// ─── Compile & render a shader once ─────────────────────────────────────────
export function renderShaderToDataURL(shaderCode, width, height, time = 0.5, paramOverrides = {}) {
  const ctx = getContext(width, height);
  if (!ctx) return null;
  const { canvas, gl, posBuf } = ctx;

  const metadata = parseISFMetadata(shaderCode);
  const rawFrag = shaderCode.replace(/\/\*\s*\{[\s\S]*?\}\s*\*\//, '');
  const fragSource = convertISFtoGLSL(rawFrag, metadata);

  // Compile vertex
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, VERTEX_SHADER);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { gl.deleteShader(vs); return null; }

  // Compile fragment
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fragSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.warn('Frag error:', gl.getShaderInfoLog(fs));
    gl.deleteShader(vs); gl.deleteShader(fs);
    return null;
  }

  // Link
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    return null;
  }

  gl.useProgram(prog);

  // Position attribute
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  const posLoc = gl.getAttribLocation(prog, 'position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  // Built-in uniforms
  const u = (name) => gl.getUniformLocation(prog, name);
  if (u('RENDERSIZE')) gl.uniform2f(u('RENDERSIZE'), width, height);
  if (u('TIME')) gl.uniform1f(u('TIME'), time);
  if (u('TIMEDELTA')) gl.uniform1f(u('TIMEDELTA'), 0.016);
  if (u('FRAMEINDEX')) gl.uniform1i(u('FRAMEINDEX'), Math.floor(time * 60));
  const now = new Date();
  if (u('DATE')) gl.uniform4f(u('DATE'), now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());

  // Audio uniforms (zero)
  for (const name of AUDIO_FLOAT_UNIFORMS) { const loc = u(name); if (loc) gl.uniform1f(loc, 0); }

  // Texture cleanup
  const textures = [];
  let texUnit = 0;

  // Audio textures (1px black)
  for (const name of ['audioFFT', 'audioWaveform']) {
    const loc = u(name);
    if (loc) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + texUnit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.uniform1i(loc, texUnit++);
      textures.push(tex);
    }
  }

  // Input uniforms with defaults (or overrides)
  for (const input of (metadata.INPUTS || [])) {
    const loc = u(input.NAME);
    if (!loc) continue;

    const val = paramOverrides[input.NAME] !== undefined ? paramOverrides[input.NAME] : getInputDefault(input);

    switch (input.TYPE) {
      case 'float': case 'event': gl.uniform1f(loc, val); break;
      case 'bool': gl.uniform1i(loc, val ? 1 : 0); break;
      case 'long': gl.uniform1i(loc, val); break;
      case 'point2D': gl.uniform2f(loc, val[0], val[1]); break;
      case 'color': gl.uniform4f(loc, val[0], val[1], val[2], val[3] ?? 1); break;
      case 'image': {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const sz = 16, px = new Uint8Array(sz * sz * 4);
        for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
          const i = (y * sz + x) * 4;
          px[i] = (x / sz * 200 + 55) | 0;
          px[i + 1] = (y / sz * 200 + 55) | 0;
          px[i + 2] = ((x + y) / (sz * 2) * 200 + 55) | 0;
          px[i + 3] = 255;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sz, sz, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.uniform1i(loc, texUnit++);
        textures.push(tex);
        const szLoc = u(`_${input.NAME}_imgSize`);
        if (szLoc) gl.uniform2f(szLoc, width, height);
        break;
      }
    }
  }

  // Render
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  // Cleanup
  for (const tex of textures) gl.deleteTexture(tex);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return dataUrl;
}

// ─── Live Preview Renderer (animated, persistent program) ───────────────────
export class LivePreviewRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true, alpha: false, antialias: true, powerPreference: 'default'
    });
    if (this.gl) this.gl.getExtension('OES_standard_derivatives');
    this.program = null;
    this.metadata = null;
    this.textures = [];
    this.startTime = performance.now() / 1000;
    this.frameIndex = 0;
    this.animId = null;
    this.paramOverrides = {};

    // Position buffer
    if (this.gl) {
      this.posBuf = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.posBuf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), this.gl.STATIC_DRAW);
    }
  }

  loadShader(shaderCode, overrides = {}) {
    this.cleanup();
    if (!this.gl) return false;
    const gl = this.gl;

    this.paramOverrides = { ...overrides };
    this.metadata = parseISFMetadata(shaderCode);
    this.shaderCode = shaderCode;
    const rawFrag = shaderCode.replace(/\/\*\s*\{[\s\S]*?\}\s*\*\//, '');
    const fragSource = convertISFtoGLSL(rawFrag, this.metadata);

    // Compile
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERTEX_SHADER);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) { gl.deleteShader(vs); return false; }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.warn('Fragment compile error:', gl.getShaderInfoLog(fs));
      gl.deleteShader(vs); gl.deleteShader(fs);
      return false;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
      return false;
    }

    this.program = prog;
    this.vs = vs;
    this.fs = fs;
    this.startTime = performance.now() / 1000;
    this.frameIndex = 0;

    // Setup static resources (audio textures, image inputs)
    this._setupStaticUniforms();

    return true;
  }

  _setupStaticUniforms() {
    const gl = this.gl;
    const prog = this.program;
    gl.useProgram(prog);

    let texUnit = 0;

    // Audio sampler textures
    for (const name of ['audioFFT', 'audioWaveform']) {
      const loc = gl.getUniformLocation(prog, name);
      if (loc) {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + texUnit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.uniform1i(loc, texUnit++);
        this.textures.push(tex);
      }
    }

    // Image inputs
    for (const input of (this.metadata.INPUTS || [])) {
      if (input.TYPE === 'image') {
        const loc = gl.getUniformLocation(prog, input.NAME);
        if (loc) {
          const tex = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          const sz = 16, px = new Uint8Array(sz * sz * 4);
          for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
            const i = (y * sz + x) * 4;
            px[i] = (x / sz * 200 + 55) | 0;
            px[i + 1] = (y / sz * 200 + 55) | 0;
            px[i + 2] = ((x + y) / (sz * 2) * 200 + 55) | 0;
            px[i + 3] = 255;
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sz, sz, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.uniform1i(loc, texUnit++);
          this.textures.push(tex);
        }
      }
    }

    this.nextTexUnit = texUnit;
  }

  setParam(name, value) {
    this.paramOverrides[name] = value;
  }

  renderFrame() {
    if (!this.gl || !this.program) return;
    const gl = this.gl;
    const prog = this.program;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const time = performance.now() / 1000 - this.startTime;

    gl.useProgram(prog);

    // Position attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Built-in uniforms
    const u = (name) => gl.getUniformLocation(prog, name);
    if (u('RENDERSIZE')) gl.uniform2f(u('RENDERSIZE'), w, h);
    if (u('TIME')) gl.uniform1f(u('TIME'), time);
    if (u('TIMEDELTA')) gl.uniform1f(u('TIMEDELTA'), 0.016);
    if (u('FRAMEINDEX')) gl.uniform1i(u('FRAMEINDEX'), this.frameIndex++);
    const now = new Date();
    if (u('DATE')) gl.uniform4f(u('DATE'), now.getFullYear(), now.getMonth(), now.getDate(),
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());

    // Audio (zero)
    for (const name of AUDIO_FLOAT_UNIFORMS) { const loc = u(name); if (loc) gl.uniform1f(loc, 0); }

    // Input params
    for (const input of (this.metadata.INPUTS || [])) {
      const loc = u(input.NAME);
      if (!loc || input.TYPE === 'image') continue;
      const val = this.paramOverrides[input.NAME] !== undefined ? this.paramOverrides[input.NAME] : getInputDefault(input);
      switch (input.TYPE) {
        case 'float': case 'event': gl.uniform1f(loc, val); break;
        case 'bool': gl.uniform1i(loc, val ? 1 : 0); break;
        case 'long': gl.uniform1i(loc, val); break;
        case 'point2D': gl.uniform2f(loc, val[0], val[1]); break;
        case 'color': gl.uniform4f(loc, val[0], val[1], val[2], val[3] ?? 1); break;
      }
    }

    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  startAnimation() {
    this.stopAnimation();
    const loop = () => {
      this.renderFrame();
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stopAnimation() {
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
  }

  captureDataURL(quality = 0.9) {
    this.renderFrame();
    return this.canvas.toDataURL('image/jpeg', quality);
  }

  cleanup() {
    this.stopAnimation();
    if (!this.gl) return;
    for (const tex of this.textures) this.gl.deleteTexture(tex);
    this.textures = [];
    if (this.program) { this.gl.deleteProgram(this.program); this.program = null; }
    if (this.vs) { this.gl.deleteShader(this.vs); this.vs = null; }
    if (this.fs) { this.gl.deleteShader(this.fs); this.fs = null; }
  }

  destroy() {
    this.cleanup();
    this.gl = null;
  }
}
