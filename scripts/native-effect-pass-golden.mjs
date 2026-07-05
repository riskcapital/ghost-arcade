import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createRpcProcess } from './native-renderer-smoke.mjs';

const root = process.cwd();
const require = createRequire(import.meta.url);
const WIDTH = 64;
const HEIGHT = 64;
const PROBE_COUNT = 32;

const EFFECT_SHADER_ID = 'effect-pass/render';
const PROBE_SHADER_ID = 'effect-pass/source-frame-probe';
const FIXTURES = [
  {
    id: 'invert',
    code: 1,
    time: 0.2,
    frameDelta: 1 / 30,
    frameIndex: 4,
    amount: 1,
    mix: 1,
    params: [0.42, 0, 0, 0, 0, 0, 0, 0],
    tolerance: { mean: 1.5, p95: 5, max: 24 },
  },
  {
    id: 'colorama',
    code: 40,
    time: 0.5,
    frameDelta: 1 / 24,
    frameIndex: 9,
    amount: 0.85,
    mix: 1,
    params: [8, 0.15, 0.05, 1.2, 4, 0.35, 0.2, 0.4],
    tolerance: { mean: 6, p95: 18, max: 58 },
  },
];
const SOURCE_FIXTURE = {
  id: 'source',
  code: 0,
  time: 0,
  frameDelta: 1 / 30,
  frameIndex: 1,
  amount: 1,
  mix: 1,
  params: [0, 0, 0, 0, 0, 0, 0, 0],
  tolerance: { mean: 4, p95: 10, max: 36 },
};
const WEBGL_FIXTURES = [SOURCE_FIXTURE, ...FIXTURES];

function readEffectPassWgsl() {
  const source = readFileSync(join(root, 'src', 'lib', 'renderer', 'nativeEffectPass.ts'), 'utf8');
  const match = source.match(/const\s+NATIVE_EFFECT_PASS_WGSL\s*=\s*\/\*\s*wgsl\s*\*\/`([\s\S]*?)`;/);
  if (!match) {
    throw new Error('Could not extract NATIVE_EFFECT_PASS_WGSL from nativeEffectPass.ts');
  }
  return match[1];
}

function sourceFrameProbeWgsl() {
  return String.raw`
struct ProbeUniforms {
  width: u32,
  height: u32,
  count: u32,
  _pad0: u32,
}

@group(0) @binding(0)
var<storage, read_write> output_words: array<u32>;

@group(0) @binding(1)
var<uniform> probe: ProbeUniforms;

@group(0) @binding(2)
var source_tex: texture_2d<f32>;

@group(0) @binding(3)
var source_sampler: sampler;

fn probe_coord(i: u32) -> vec2<f32> {
  let safe_width = max(probe.width, 1u);
  let safe_height = max(probe.height, 1u);
  let x = f32((i * 37u + 11u) % safe_width);
  let y = f32((i * 19u + 7u) % safe_height);
  return (vec2<f32>(x, y) + vec2<f32>(0.5)) / vec2<f32>(f32(safe_width), f32(safe_height));
}

fn pack_channel(value: f32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * 255.0));
}

@compute @workgroup_size(32)
fn cs_probe(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= probe.count) { return; }
  let color = textureSampleLevel(source_tex, source_sampler, probe_coord(i), 0.0);
  let offset = i * 4u;
  output_words[offset + 0u] = pack_channel(color.r);
  output_words[offset + 1u] = pack_channel(color.g);
  output_words[offset + 2u] = pack_channel(color.b);
  output_words[offset + 3u] = pack_channel(color.a);
}
`;
}

function makeSourceBytes(width, height) {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const wave = 0.5 + 0.5 * Math.sin((nx * 5.2 + ny * 3.1) * Math.PI);
      const radial = Math.hypot(nx - 0.5, ny - 0.5);
      const i = (y * width + x) * 4;
      bytes[i] = Math.round(26 + nx * 182);
      bytes[i + 1] = Math.round(18 + ny * 178);
      bytes[i + 2] = Math.round(48 + wave * 128 + Math.max(0, 0.42 - radial) * 68);
      bytes[i + 3] = 255;
    }
  }
  return bytes;
}

function effectUniforms(fixture) {
  return [
    WIDTH,
    HEIGHT,
    fixture.time,
    fixture.frameDelta,
    fixture.code,
    fixture.amount,
    fixture.mix,
    fixture.frameIndex,
    ...fixture.params,
  ];
}

function effectGraph(fixture, sourceId, targetSourceId) {
  const uniformId = `effect-pass-golden:${fixture.id}:uniform`;
  return {
    buffers: [{
      id: uniformId,
      kind: 'uniform',
      byte_length: 64,
      initial_f32: effectUniforms(fixture),
    }],
    passes: [],
    readbacks: [],
    render_passes: [{
      name: `effect-pass-golden-${fixture.id}`,
      shader_id: EFFECT_SHADER_ID,
      target: 'source_frame',
      source_id: targetSourceId,
      seq: fixture.frameIndex,
      vertex_entry: 'vs_full',
      fragment_entry: 'fs_effect',
      vertex_count: 3,
      instance_count: 1,
      clear: true,
      clear_color: [0, 0, 0, 0],
      blend: 'replace',
      bindings: [
        { binding: 0, kind: 'source-frame-texture', source_id: sourceId },
        { binding: 1, kind: 'source-frame-sampler' },
        { binding: 2, resource: uniformId, kind: 'uniform' },
      ],
    }],
  };
}

function probeGraph(sourceId, label) {
  const outputId = `effect-pass-golden-probe:${label}:output`;
  const uniformId = `effect-pass-golden-probe:${label}:uniform`;
  return {
    outputId,
    config: {
      buffers: [
        {
          id: outputId,
          kind: 'storage',
          byte_length: PROBE_COUNT * 4 * 4,
        },
        {
          id: uniformId,
          kind: 'uniform',
          byte_length: 16,
          initial_u32: [WIDTH, HEIGHT, PROBE_COUNT, 0],
        },
      ],
      passes: [{
        name: `effect-pass-golden-probe-${label}`,
        shader_id: PROBE_SHADER_ID,
        entry: 'cs_probe',
        dispatch: [1, 1, 1],
        bindings: [
          { binding: 0, resource: outputId, kind: 'storage' },
          { binding: 1, resource: uniformId, kind: 'uniform' },
          { binding: 2, kind: 'source-frame-texture', source_id: sourceId },
          { binding: 3, kind: 'source-frame-sampler' },
        ],
      }],
      readbacks: [outputId],
    },
  };
}

async function readNativeProbe(rpc, sourceId, label) {
  const graph = probeGraph(sourceId, label);
  const result = await rpc.send('compute_graph', graph.config, 10000);
  const words = result?.readbacks?.[graph.outputId]?.first_words ?? [];
  if (words.length < PROBE_COUNT * 4) {
    throw new Error(`native source probe ${label} was truncated: ${JSON.stringify(result)}`);
  }
  const pixels = new Uint8Array(PROBE_COUNT * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = Math.max(0, Math.min(255, Number(words[i]) || 0));
  }
  return {
    checksum: result.readbacks[graph.outputId].checksum,
    pixels,
  };
}

async function renderNativeFixtures(sourceBytes) {
  const rpc = createRpcProcess();
  const sourceId = 'effect-pass-golden-source';
  const snapshots = new Map();
  try {
    const status = await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: WIDTH,
        height: HEIGHT,
        target_fps: 30,
      },
    }, 12000);
    if (!status?.backend_ready) {
      throw new Error(`native render core failed to start: ${JSON.stringify(status)}`);
    }

    const capabilities = await rpc.send('capabilities', {}, 5000);
    if (
      !capabilities?.features?.compute_graph_render ||
      !capabilities?.features?.compute_graph_texture_sampling ||
      !capabilities?.features?.compute_graph_source_frame_target
    ) {
      throw new Error(`native effect-pass golden prerequisites missing: ${JSON.stringify(capabilities?.features)}`);
    }

    const precompile = await rpc.send('submit_commands', {
      commands: [
        {
          type: 'precompile_shader',
          shader_id: EFFECT_SHADER_ID,
          stage: 'render',
          entry: 'fs_effect',
          source: readEffectPassWgsl(),
        },
        {
          type: 'precompile_shader',
          shader_id: PROBE_SHADER_ID,
          stage: 'compute',
          entry: 'cs_probe',
          source: sourceFrameProbeWgsl(),
        },
      ],
    }, 5000);
    if (Number(precompile?.dropped ?? 0) !== 0) {
      throw new Error(`native effect-pass shader precompile failed: ${JSON.stringify(precompile)}`);
    }

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upload_source_frame',
          source_id: sourceId,
          width: WIDTH,
          height: HEIGHT,
          rgba_b64: Buffer.from(sourceBytes).toString('base64'),
          seq: 1,
        },
      ],
    }, 5000);

    snapshots.set(SOURCE_FIXTURE.id, await readNativeProbe(rpc, sourceId, SOURCE_FIXTURE.id));

    for (const fixture of FIXTURES) {
      const targetSourceId = `effect-pass-golden-output-${fixture.id}`;
      await rpc.send('compute_graph', effectGraph(fixture, sourceId, targetSourceId), 10000);
      snapshots.set(fixture.id, await readNativeProbe(rpc, targetSourceId, fixture.id));
    }

    return snapshots;
  } finally {
    const stderr = await rpc.close();
    if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
  }
}

function browserHelperSource() {
  return String.raw`
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('enable-unsafe-webgpu');

function fail(err) {
  fs.writeFileSync(outputPath, JSON.stringify({ ok: false, error: err?.stack || err?.message || String(err) }));
  app.quit();
}

app.whenReady().then(async () => {
  const request = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const win = new BrowserWindow({
    show: false,
    width: request.width,
    height: request.height,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
    },
  });
  await win.loadURL('data:text/html,<html><body><canvas id="c"></canvas></body></html>');
  const result = await win.webContents.executeJavaScript(
    '(' + renderWebGlGolden.toString() + ')(' + JSON.stringify(request) + ')',
    true,
  );
  fs.writeFileSync(outputPath, JSON.stringify({ ok: true, result }));
  app.quit();
}).catch(fail);

function renderWebGlGolden(request) {
  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodeBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    }
    return shader;
  }

  function makeProgram(gl) {
    const vertex = compile(gl, gl.VERTEX_SHADER, [
      'attribute vec2 aPos;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = aPos * 0.5 + 0.5;',
      '  gl_Position = vec4(aPos, 0.0, 1.0);',
      '}',
    ].join('\n'));
    const fragment = compile(gl, gl.FRAGMENT_SHADER, [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform sampler2D uTex;',
      'uniform vec4 uResolutionTime;',
      'uniform vec4 uEffect;',
      'uniform vec4 uParams0;',
      'uniform vec4 uParams1;',
      'float luma(vec3 color) { return dot(color, vec3(0.299, 0.587, 0.114)); }',
      'float fract1(float value) { return value - floor(value); }',
      'vec3 coloramaCosinePalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {',
      '  return a + b * cos(6.28318530718 * (c * t + d));',
      '}',
      'vec3 coloramaPalette(float t, float palette, float hueShift) {',
      '  vec3 a = vec3(0.5);',
      '  vec3 b = vec3(0.5);',
      '  vec3 c = vec3(1.0);',
      '  vec3 d = vec3(0.0, 0.33, 0.67);',
      '  if (palette == 1.0) {',
      '    d = vec3(0.0, 0.1, 0.2);',
      '  } else if (palette == 2.0) {',
      '    d = vec3(0.3, 0.2, 0.2);',
      '  } else if (palette == 3.0) {',
      '    c = vec3(1.0, 1.0, 0.5); d = vec3(0.8, 0.9, 0.3);',
      '  } else if (palette == 4.0) {',
      '    c = vec3(1.0, 0.7, 0.4); d = vec3(0.0, 0.15, 0.2);',
      '  } else if (palette == 5.0) {',
      '    d = vec3(0.0, 0.1, 0.0);',
      '  } else if (palette == 6.0) {',
      '    a = vec3(0.8, 0.8, 0.9); b = vec3(0.2, 0.4, 0.2); d = vec3(0.0, 0.25, 0.25);',
      '  } else if (palette == 7.0) {',
      '    c = vec3(2.0, 1.0, 0.0); d = vec3(0.5, 0.2, 0.25);',
      '  } else if (palette == 8.0) {',
      '    a = vec3(0.6, 0.4, 0.7); b = vec3(0.4); c = vec3(1.0, 1.0, 0.5); d = vec3(0.0, 0.15, 0.50);',
      '  } else if (palette == 9.0) {',
      '    a = vec3(0.55, 0.45, 0.55); b = vec3(0.55, 0.5, 0.5); c = vec3(1.5, 1.5, 1.0); d = vec3(0.0, 0.5, 0.85);',
      '  } else if (palette == 10.0) {',
      '    a = vec3(0.85, 0.8, 0.85); b = vec3(0.15, 0.18, 0.15); d = vec3(0.0, 0.33, 0.67);',
      '  } else if (palette == 11.0) {',
      '    float h = fract1(hueShift); d = vec3(h, h + 0.33, h + 0.67);',
      '  }',
      '  return coloramaCosinePalette(t, a, b, c, d);',
      '}',
      'void main() {',
      '  vec2 uv = clamp(vUv, vec2(0.0), vec2(1.0));',
      '  vec4 src = texture2D(uTex, uv);',
      '  vec3 color = src.rgb;',
      '  float code = floor(uEffect.x + 0.5);',
      '  float amount = uEffect.y;',
      '  vec4 effected = src;',
      '  if (code == 1.0) {',
      '    effected = vec4(mix(color, vec3(1.0) - color, clamp(amount, 0.0, 1.0)), src.a);',
      '  } else if (code == 40.0) {',
      '    float palette = floor(clamp(uParams0.x, 0.0, 11.0) + 0.5);',
      '    float offset = clamp(uParams0.y, 0.0, 1.0);',
      '    float speed = clamp(uParams0.z, 0.0, 2.0);',
      '    float contrast = clamp(uParams0.w, 0.5, 2.0);',
      '    float bands = clamp(uParams1.x, 0.0, 32.0);',
      '    float audioReact = clamp(uParams1.y, 0.0, 1.0);',
      '    float hueShift = clamp(uParams1.z, 0.0, 1.0);',
      '    float audio = clamp(uParams1.w, 0.0, 1.5);',
      '    float lum = clamp((luma(color) - 0.5) * contrast + 0.5, 0.0, 1.0);',
      '    if (bands >= 0.5) {',
      '      float steps = floor(bands + 0.5);',
      '      lum = clamp(floor(lum * steps) / max(steps - 1.0, 1.0), 0.0, 1.0);',
      '    }',
      '    float t = lum + offset + uResolutionTime.z * speed + hueShift + audio * audioReact;',
      '    vec3 paletteColor = coloramaPalette(t, palette, hueShift);',
      '    effected = vec4(mix(color, paletteColor, clamp(amount, 0.0, 1.0)), src.a);',
      '  }',
      '  vec4 mixed = mix(src, effected, clamp(uEffect.z, 0.0, 1.0));',
      '  gl_FragColor = vec4(clamp(mixed.rgb, vec3(0.0), vec3(1.0)), clamp(mixed.a, 0.0, 1.0));',
      '}',
    ].join('\n'));
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    return program;
  }

  function flipRows(bytes, width, height) {
    const flipped = new Uint8Array(bytes.length);
    const row = width * 4;
    for (let y = 0; y < height; y += 1) {
      flipped.set(bytes.subarray(y * row, y * row + row), (height - 1 - y) * row);
    }
    return flipped;
  }

  const canvas = document.getElementById('c');
  canvas.width = request.width;
  canvas.height = request.height;
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) throw new Error('Electron WebGL context unavailable');

  const program = makeProgram(gl);
  gl.useProgram(program);
  const vertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    request.width,
    request.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    decodeBase64(request.sourceB64),
  );
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
  gl.viewport(0, 0, request.width, request.height);

  const output = {};
  for (const fixture of request.fixtures) {
    gl.uniform4fv(gl.getUniformLocation(program, 'uResolutionTime'), new Float32Array([
      request.width,
      request.height,
      fixture.time,
      fixture.frameDelta,
    ]));
    gl.uniform4fv(gl.getUniformLocation(program, 'uEffect'), new Float32Array([
      fixture.code,
      fixture.amount,
      fixture.mix,
      fixture.frameIndex,
    ]));
    gl.uniform4fv(gl.getUniformLocation(program, 'uParams0'), new Float32Array(fixture.params.slice(0, 4)));
    gl.uniform4fv(gl.getUniformLocation(program, 'uParams1'), new Float32Array(fixture.params.slice(4, 8)));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(request.width * request.height * 4);
    gl.readPixels(0, 0, request.width, request.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    output[fixture.id] = encodeBase64(flipRows(pixels, request.width, request.height));
  }
  return output;
}
`;
}

async function renderWebGlFixtures(sourceBytes) {
  const electronBin = require('electron');
  if (!electronBin || !existsSync(electronBin)) {
    throw new Error(`Electron binary is unavailable: ${electronBin}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'ghost-effect-golden-'));
  try {
    const helperPath = join(tmp, 'webgl-helper.cjs');
    const inputPath = join(tmp, 'input.json');
    const outputPath = join(tmp, 'output.json');
    writeFileSync(helperPath, browserHelperSource());
    writeFileSync(inputPath, JSON.stringify({
      width: WIDTH,
      height: HEIGHT,
      sourceB64: Buffer.from(sourceBytes).toString('base64'),
      fixtures: WEBGL_FIXTURES,
    }));

    const child = spawn(electronBin, [helperPath, inputPath, outputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '0' },
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Electron WebGL golden timed out: ${stderr.trim()}`));
      }, 30000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    if (code !== 0) {
      throw new Error(`Electron WebGL golden exited ${code}: ${stderr.trim()}`);
    }
    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (!payload.ok) {
      throw new Error(payload.error || 'Electron WebGL golden failed');
    }
    const pixels = new Map();
    for (const fixture of WEBGL_FIXTURES) {
      const encoded = payload.result?.[fixture.id];
      if (typeof encoded !== 'string') {
        throw new Error(`Electron WebGL golden omitted ${fixture.id}: ${JSON.stringify(payload)}`);
      }
      pixels.set(fixture.id, new Uint8Array(Buffer.from(encoded, 'base64')));
    }
    return pixels;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function diffPixels(a, b) {
  if (a.length !== b.length) {
    throw new Error(`pixel buffers differ in length: ${a.length} !== ${b.length}`);
  }
  const deltas = [];
  let total = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(Number(a[i + c]) - Number(b[i + c]));
      deltas.push(delta);
      total += delta;
      max = Math.max(max, delta);
    }
  }
  deltas.sort((x, y) => x - y);
  return {
    mean: total / Math.max(1, deltas.length),
    p95: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
    max,
  };
}

function probeCoord(index) {
  return {
    x: (index * 37 + 11) % WIDTH,
    y: (index * 19 + 7) % HEIGHT,
  };
}

function probeFullFrame(bytes, orientation = 'none') {
  const out = new Uint8Array(PROBE_COUNT * 4);
  for (let i = 0; i < PROBE_COUNT; i += 1) {
    const coord = probeCoord(i);
    const x = orientation.includes('x') ? WIDTH - 1 - coord.x : coord.x;
    const y = orientation.includes('y') ? HEIGHT - 1 - coord.y : coord.y;
    const src = (y * WIDTH + x) * 4;
    const dst = i * 4;
    out[dst] = bytes[src];
    out[dst + 1] = bytes[src + 1];
    out[dst + 2] = bytes[src + 2];
    out[dst + 3] = bytes[src + 3];
  }
  return out;
}

function bestOrientationDiff(nativePixels, webglFramePixels) {
  const candidates = [
    { orientation: 'none', pixels: probeFullFrame(webglFramePixels, 'none') },
    { orientation: 'flip-y', pixels: probeFullFrame(webglFramePixels, 'y') },
    { orientation: 'flip-x', pixels: probeFullFrame(webglFramePixels, 'x') },
    { orientation: 'flip-xy', pixels: probeFullFrame(webglFramePixels, 'xy') },
  ];
  return candidates
    .map((candidate) => ({
      orientation: candidate.orientation,
      ...diffPixels(nativePixels, candidate.pixels),
    }))
    .sort((a, b) => a.mean - b.mean)[0];
}

function assertDiffWithinTolerance(fixture, stats) {
  const { mean, p95, max } = stats;
  const tolerance = fixture.tolerance;
  if (stats.orientation !== 'none' || mean > tolerance.mean || p95 > tolerance.p95 || max > tolerance.max) {
    throw new Error(
      `native/WebGL ${fixture.id} effect golden drifted: orientation=${stats.orientation} mean=${mean.toFixed(3)}/${tolerance.mean} ` +
      `p95=${p95}/${tolerance.p95} max=${max}/${tolerance.max}`,
    );
  }
}

function meanRgb(bytes) {
  const total = [0, 0, 0];
  const pixels = Math.max(1, bytes.length / 4);
  for (let i = 0; i < bytes.length; i += 4) {
    total[0] += bytes[i];
    total[1] += bytes[i + 1];
    total[2] += bytes[i + 2];
  }
  return total.map((value) => Number((value / pixels).toFixed(2)));
}

async function main() {
  const sourceBytes = makeSourceBytes(WIDTH, HEIGHT);
  const [nativePixels, webglPixels] = await Promise.all([
    renderNativeFixtures(sourceBytes),
    renderWebGlFixtures(sourceBytes),
  ]);

  const summaries = [];
  for (const fixture of WEBGL_FIXTURES) {
    const native = nativePixels.get(fixture.id);
    const webgl = webglPixels.get(fixture.id);
    const stats = bestOrientationDiff(native.pixels, webgl);
    if (process.env.NATIVE_EFFECT_GOLDEN_DEBUG === '1') {
      console.log(
        `debug ${fixture.id}: nativeMean=${meanRgb(native.pixels).join(',')} ` +
        `webglMean=${meanRgb(webgl).join(',')} best=${stats.orientation} ` +
        `mean=${stats.mean.toFixed(3)} p95=${stats.p95} max=${stats.max}`,
      );
    }
    assertDiffWithinTolerance(fixture, stats);
    summaries.push(
      `${fixture.id}:${native.checksum} ${stats.orientation} mean=${stats.mean.toFixed(2)} p95=${stats.p95} max=${stats.max}`,
    );
  }

  console.log(`Native/WebGL effect-pass golden passed: ${summaries.join(' ')}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
