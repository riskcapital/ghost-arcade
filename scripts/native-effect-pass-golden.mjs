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
const PIXEL_COUNT = WIDTH * HEIGHT;

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
    tolerance: { mean: 1.5, p95: 5, p99: 12, max: 24 },
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
    tolerance: { mean: 6, p95: 18, p99: 2, max: 160 },
  },
  {
    id: 'edge-feather',
    code: 41,
    time: 0.35,
    frameDelta: 1 / 30,
    frameIndex: 10,
    amount: 1,
    mix: 1,
    params: [0.24, 0.12, 0.18, 0.28, 0.5, 1.15, 1, 0],
    tolerance: { mean: 2, p95: 4, p99: 8, max: 18 },
  },
  {
    id: 'edge-feather-alpha',
    code: 41,
    time: 0.35,
    frameDelta: 1 / 30,
    frameIndex: 13,
    amount: 1,
    mix: 1,
    params: [0.24, 0.12, 0.18, 0.28, 0.5, 1.15, 0, 0],
    tolerance: { mean: 2, p95: 4, p99: 8, max: 18 },
  },
  {
    id: 'dither',
    code: 42,
    time: 0.4,
    frameDelta: 1 / 30,
    frameIndex: 14,
    amount: 0.75,
    mix: 1,
    params: [2, 2, 4, 0, 1, 0, 0, 0],
    tolerance: { mean: 6, p95: 18, p99: 28, max: 72 },
  },
  {
    id: 'emboss',
    code: 44,
    time: 0.4,
    frameDelta: 1 / 30,
    frameIndex: 15,
    amount: 1.2,
    mix: 1,
    params: [135, 0.8, 1, 0.92, 0.7, 0.08, 0.16, 0.28],
    tolerance: { mean: 5, p95: 14, p99: 28, max: 72 },
  },
  {
    id: 'crt',
    code: 45,
    time: 0.4,
    frameDelta: 1 / 30,
    frameIndex: 16,
    amount: 0.55,
    mix: 1,
    params: [480, 0.55, 2, 0.25, 0.32, 0.45, 0, 0.28],
    tolerance: { mean: 8, p95: 28, p99: 58, max: 150 },
  },
  {
    id: 'thermal',
    code: 46,
    time: 0.35,
    frameDelta: 1 / 30,
    frameIndex: 11,
    amount: 1.25,
    mix: 1,
    params: [1, 0, 0, 0, 0, 0, 0, 0],
    tolerance: { mean: 3, p95: 8, p99: 16, max: 36 },
  },
  {
    id: 'night-vision',
    code: 47,
    time: 0.35,
    frameDelta: 1 / 30,
    frameIndex: 12,
    amount: 1.4,
    mix: 1,
    params: [0, 0.45, 1, 0.35, 1, 0, 0, 0],
    tolerance: { mean: 6, p95: 16, p99: 28, max: 52 },
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
  tolerance: { mean: 4, p95: 10, p99: 24, max: 36 },
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

function sourceFrameReadbackWgsl() {
  return String.raw`
struct ProbeUniforms {
  width: u32,
  height: u32,
  pixel_count: u32,
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

fn pixel_coord(i: u32) -> vec2<f32> {
  let safe_width = max(probe.width, 1u);
  let safe_height = max(probe.height, 1u);
  let x = f32(i % safe_width);
  let y = f32(i / safe_width);
  return (vec2<f32>(x, y) + vec2<f32>(0.5)) / vec2<f32>(f32(safe_width), f32(safe_height));
}

fn pack_channel(value: f32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * 255.0));
}

fn pack_rgba(color: vec4<f32>) -> u32 {
  let r = pack_channel(color.r);
  let g = pack_channel(color.g);
  let b = pack_channel(color.b);
  let a = pack_channel(color.a);
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

@compute @workgroup_size(64)
fn cs_probe(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= probe.pixel_count) { return; }
  let color = textureSampleLevel(source_tex, source_sampler, pixel_coord(i), 0.0);
  output_words[i] = pack_rgba(color);
}
`;
}

function makeSourceBytes(width, height, mode = 'gradient') {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const wave = 0.5 + 0.5 * Math.sin((nx * 5.2 + ny * 3.1) * Math.PI);
      const radial = Math.hypot(nx - 0.5, ny - 0.5);
      const diagonal = Math.sin((nx * 23.0 + ny * 17.0) * Math.PI) > 0 ? 1 : 0;
      const ring = Math.sin(radial * 92.0) > 0 ? 1 : 0;
      const i = (y * width + x) * 4;
      if (mode === 'frequency') {
        bytes[i] = Math.round(24 + diagonal * 185 + nx * 32);
        bytes[i + 1] = Math.round(24 + ring * 170 + ny * 42);
        bytes[i + 2] = Math.round(48 + (1 - diagonal) * 104 + wave * 72);
        bytes[i + 3] = 255;
      } else if (mode === 'alpha-mask') {
        const mask = Math.max(0, Math.min(1, 1.2 - radial * 2.1));
        const cutout = (x > width * 0.58 && y < height * 0.36) ? 0.24 : 1;
        bytes[i] = Math.round(38 + nx * 154 + wave * 32);
        bytes[i + 1] = Math.round(26 + ny * 160);
        bytes[i + 2] = Math.round(82 + Math.max(0, 0.46 - radial) * 180);
        bytes[i + 3] = Math.round(255 * Math.max(0.12, mask * cutout));
      } else {
        bytes[i] = Math.round(26 + nx * 182);
        bytes[i + 1] = Math.round(18 + ny * 178);
        bytes[i + 2] = Math.round(48 + wave * 128 + Math.max(0, 0.42 - radial) * 68);
        bytes[i + 3] = 255;
      }
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
  const workgroups = Math.ceil(PIXEL_COUNT / 64);
  return {
    outputId,
    config: {
      buffers: [
        {
          id: outputId,
          kind: 'storage',
          byte_length: PIXEL_COUNT * 4,
        },
        {
          id: uniformId,
          kind: 'uniform',
          byte_length: 16,
          initial_u32: [WIDTH, HEIGHT, PIXEL_COUNT, 0],
        },
      ],
      passes: [{
        name: `effect-pass-golden-probe-${label}`,
        shader_id: PROBE_SHADER_ID,
        entry: 'cs_probe',
        dispatch: [workgroups, 1, 1],
        bindings: [
          { binding: 0, resource: outputId, kind: 'storage' },
          { binding: 1, resource: uniformId, kind: 'uniform' },
          { binding: 2, kind: 'source-frame-texture', source_id: sourceId },
          { binding: 3, kind: 'source-frame-sampler' },
        ],
      }],
      readbacks: [{ id: outputId, include_bytes: true }],
    },
  };
}

async function readNativeProbe(rpc, sourceId, label) {
  const graph = probeGraph(sourceId, label);
  const result = await rpc.send('compute_graph', graph.config, 10000);
  const encoded = result?.readbacks?.[graph.outputId]?.bytes_b64;
  if (typeof encoded !== 'string') {
    throw new Error(`native source probe ${label} omitted bytes_b64: ${JSON.stringify(result)}`);
  }
  const pixels = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (pixels.length !== PIXEL_COUNT * 4) {
    throw new Error(`native source probe ${label} returned ${pixels.length} bytes, expected ${PIXEL_COUNT * 4}`);
  }
  return {
    checksum: result.readbacks[graph.outputId].checksum,
    pixels,
  };
}

async function renderNativeFixtures(sourceCase) {
  const rpc = createRpcProcess();
  const sourceId = `effect-pass-golden-source-${sourceCase.id}`;
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
          source: sourceFrameReadbackWgsl(),
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
          rgba_b64: Buffer.from(sourceCase.bytes).toString('base64'),
          seq: 1,
        },
      ],
    }, 5000);

    snapshots.set(
      `${sourceCase.id}:${SOURCE_FIXTURE.id}`,
      await readNativeProbe(rpc, sourceId, `${sourceCase.id}-${SOURCE_FIXTURE.id}`),
    );

    for (const fixture of FIXTURES) {
      const targetSourceId = `effect-pass-golden-output-${sourceCase.id}`;
      await rpc.send('compute_graph', effectGraph(fixture, sourceId, targetSourceId), 10000);
      snapshots.set(
        `${sourceCase.id}:${fixture.id}`,
        await readNativeProbe(rpc, targetSourceId, `${sourceCase.id}-${fixture.id}`),
      );
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
      'float hash21(vec2 p) {',
      '  vec2 q = fract(vec2(p.x * 127.1 + p.y * 311.7, p.x * 269.5 + p.y * 183.3));',
      '  return fract1(sin(q.x + q.y) * 43758.5453123);',
      '}',
      'vec3 sampleRgb(vec2 uv) { return texture2D(uTex, clamp(uv, vec2(0.0), vec2(1.0))).rgb; }',
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
      'vec3 ditherPaletteSnap(vec3 c, float palette) {',
      '  float lum = luma(c);',
      '  if (palette == 1.0) {',
      '    float v = lum >= 0.5 ? 1.0 : 0.0;',
      '    return vec3(v);',
      '  }',
      '  if (palette == 2.0) {',
      '    if (lum < 0.25) return vec3(0.0, 0.0, 0.0);',
      '    if (lum < 0.5) return vec3(0.0, 1.0, 1.0);',
      '    if (lum < 0.75) return vec3(1.0, 0.0, 1.0);',
      '    return vec3(1.0);',
      '  }',
      '  if (palette == 3.0) {',
      '    vec3 levels = vec3(2.0, 2.0, 1.0);',
      '    return floor(clamp(c, vec3(0.0), vec3(1.0)) * levels + vec3(0.5)) / max(levels, vec3(1.0));',
      '  }',
      '  if (palette == 4.0) {',
      '    if (lum < 0.25) return vec3(0.05, 0.10, 0.03);',
      '    if (lum < 0.5) return vec3(0.19, 0.38, 0.19);',
      '    if (lum < 0.75) return vec3(0.55, 0.67, 0.32);',
      '    return vec3(0.80, 0.86, 0.55);',
      '  }',
      '  if (palette == 5.0) return vec3(lum * 1.25, lum * 0.72, lum * 0.18);',
      '  return c;',
      '}',
      'float ditherThreshold(float kind, vec2 cell, vec2 uv, vec3 color) {',
      '  if (kind == 1.0) {',
      '    return hash21(floor(cell * vec2(0.7, 1.3)) + vec2(19.0, 3.0));',
      '  }',
      '  if (kind == 2.0) {',
      '    vec2 centered = fract(cell * 0.5) - vec2(0.5);',
      '    return smoothstep(0.08, 0.48, length(centered));',
      '  }',
      '  if (kind == 3.0) {',
      '    float a = hash21(cell + vec2(0.0, 0.0));',
      '    float b = hash21(cell + vec2(1.0, 0.0));',
      '    float c = hash21(cell + vec2(0.0, 1.0));',
      '    return a * 0.55 + b * 0.25 + c * 0.20;',
      '  }',
      '  if (kind == 4.0) {',
      '    float n = hash21(floor(cell * 0.5) + vec2(luma(color) * 7.0, 11.0));',
      '    return mix(fract(cell.x * 0.37 + cell.y * 0.63), n, 0.55);',
      '  }',
      '  vec2 p = floor(cell);',
      '  float base = fract(p.x * 0.125 + p.y * 0.375 + p.x * p.y * 0.0625);',
      '  return mix(base, hash21(p), 0.28);',
      '}',
      'vec3 thermalPaletteNative(float t, float palette) {',
      '  float x = clamp(t, 0.0, 1.0);',
      '  if (palette == 1.0) {',
      '    if (x < 0.18) return mix(vec3(0.0), vec3(0.28, 0.0, 0.45), x / 0.18);',
      '    if (x < 0.38) return mix(vec3(0.28, 0.0, 0.45), vec3(0.0, 0.35, 1.0), (x - 0.18) / 0.20);',
      '    if (x < 0.62) return mix(vec3(0.0, 0.35, 1.0), vec3(0.0, 1.0, 0.55), (x - 0.38) / 0.24);',
      '    if (x < 0.82) return mix(vec3(0.0, 1.0, 0.55), vec3(1.0, 0.65, 0.0), (x - 0.62) / 0.20);',
      '    return mix(vec3(1.0, 0.65, 0.0), vec3(1.0), (x - 0.82) / 0.18);',
      '  }',
      '  if (palette == 2.0) {',
      '    if (x < 0.35) return mix(vec3(1.0), vec3(0.35, 1.0, 1.0), x / 0.35);',
      '    if (x < 0.70) return mix(vec3(0.35, 1.0, 1.0), vec3(0.0, 0.25, 1.0), (x - 0.35) / 0.35);',
      '    return mix(vec3(0.0, 0.25, 1.0), vec3(1.0, 0.0, 0.65), (x - 0.70) / 0.30);',
      '  }',
      '  if (palette == 3.0) {',
      '    if (x < 0.30) return mix(vec3(0.0, 0.05, 0.0), vec3(0.0, 0.62, 0.12), x / 0.30);',
      '    if (x < 0.62) return mix(vec3(0.0, 0.62, 0.12), vec3(0.95, 0.82, 0.0), (x - 0.30) / 0.32);',
      '    if (x < 0.86) return mix(vec3(0.95, 0.82, 0.0), vec3(0.95, 0.22, 0.04), (x - 0.62) / 0.24);',
      '    return mix(vec3(0.95, 0.22, 0.04), vec3(1.0, 0.0, 0.65), (x - 0.86) / 0.14);',
      '  }',
      '  if (palette == 4.0) return vec3(x);',
      '  if (x < 0.2) return mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.5, 1.0), x * 5.0);',
      '  if (x < 0.4) return mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 0.0), (x - 0.2) * 5.0);',
      '  if (x < 0.6) return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (x - 0.4) * 5.0);',
      '  if (x < 0.8) return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), (x - 0.6) * 5.0);',
      '  return mix(vec3(1.0, 0.0, 0.0), vec3(1.0), (x - 0.8) * 5.0);',
      '}',
      'vec3 nightVisionTint(float lum, float phosphor) {',
      '  if (phosphor == 1.0) return vec3(lum, lum * 0.65, lum * 0.15);',
      '  if (phosphor == 2.0) return vec3(lum);',
      '  return vec3(lum * 0.2, lum, lum * 0.2);',
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
      '  } else if (code == 41.0) {',
      '    float top = clamp(uParams0.x, 0.0, 1.0);',
      '    float bottom = clamp(uParams0.y, 0.0, 1.0);',
      '    float left = clamp(uParams0.z, 0.0, 1.0);',
      '    float right = clamp(uParams0.w, 0.0, 1.0);',
      '    float softness = clamp(uParams1.x, 0.0, 2.0);',
      '    float featherGamma = max(0.0001, uParams1.y);',
      '    bool mattePreview = uParams1.z > 0.5;',
      '    vec2 maskUv = vec2(uv.x, 1.0 - uv.y);',
      '    float alpha = 1.0;',
      '    if (top > 0.0001) alpha *= smoothstep(1.0, 1.0 - top, maskUv.y);',
      '    if (bottom > 0.0001) alpha *= smoothstep(0.0, bottom, maskUv.y);',
      '    if (left > 0.0001) alpha *= smoothstep(0.0, left, maskUv.x);',
      '    if (right > 0.0001) alpha *= smoothstep(1.0, 1.0 - right, maskUv.x);',
      '    alpha = pow(clamp(alpha, 0.0, 1.0), 1.0 / max(softness + 0.5, 0.1));',
      '    alpha = pow(alpha, featherGamma) * clamp(amount, 0.0, 1.0);',
      '    if (mattePreview) {',
      '      effected = vec4(mix(vec3(0.0), vec3(1.0, 0.0, 0.0), 1.0 - alpha), src.a);',
      '    } else {',
      '      effected = vec4(color, src.a * alpha);',
      '    }',
      '  } else if (code == 42.0) {',
      '    float kind = floor(clamp(uParams0.x, 0.0, 4.0) + 0.5);',
      '    float scale = max(0.5, uParams0.y);',
      '    float depth = max(1.0, floor(uParams0.z + 0.5));',
      '    float palette = floor(clamp(uParams0.w, 0.0, 5.0) + 0.5);',
      '    bool pixelLock = uParams1.x > 0.5;',
      '    vec2 cell = uv * uResolutionTime.xy / scale;',
      '    if (pixelLock) cell = floor(cell);',
      '    float threshold = (ditherThreshold(kind, floor(cell), uv, color) - 0.5) * clamp(amount, 0.0, 1.0);',
      '    float levels = max(2.0, pow(2.0, depth));',
      '    vec3 dithered = color + vec3(threshold / levels);',
      '    dithered = floor(clamp(dithered, vec3(0.0), vec3(1.0)) * levels + vec3(0.5)) / levels;',
      '    dithered = ditherPaletteSnap(dithered, palette);',
      '    effected = vec4(clamp(dithered, vec3(0.0), vec3(1.0)), src.a);',
      '  } else if (code == 44.0) {',
      '    float angle = uParams0.x * 0.01745329252;',
      '    float height = clamp(uParams0.y, 0.0, 1.0);',
      '    vec3 highlight = clamp(vec3(uParams0.z, uParams0.w, uParams1.x), vec3(0.0), vec3(1.5));',
      '    vec3 shadow = clamp(uParams1.yzw, vec3(0.0), vec3(1.5));',
      '    vec2 embossUv = vec2(uv.x, 1.0 - uv.y);',
      '    vec2 tx = vec2(1.0) / max(uResolutionTime.xy, vec2(1.0));',
      '    vec2 embossSampleUv = vec2(embossUv.x, 1.0 - embossUv.y);',
      '    float lL = luma(sampleRgb(vec2(embossUv.x - tx.x, 1.0 - embossUv.y)));',
      '    float lR = luma(sampleRgb(vec2(embossUv.x + tx.x, 1.0 - embossUv.y)));',
      '    float lD = luma(sampleRgb(vec2(embossUv.x, 1.0 - (embossUv.y - tx.y))));',
      '    float lU = luma(sampleRgb(vec2(embossUv.x, 1.0 - (embossUv.y + tx.y))));',
      '    vec2 dir = vec2(cos(angle), sin(angle));',
      '    float dx = (lR - lL) * (1.0 + height * 4.0);',
      '    float dy = (lU - lD) * (1.0 + height * 4.0);',
      '    vec3 normal = normalize(vec3(-dx, -dy, 1.0));',
      '    vec3 light = normalize(vec3(dir.x, dir.y, 0.5));',
      '    float diffuse = max(dot(normal, light), 0.0);',
      '    float along = (lR - lL) * dir.x + (lU - lD) * dir.y;',
      '    float embossed = clamp(along * amount + 0.5, 0.0, 1.0);',
      '    vec3 relit = sampleRgb(embossSampleUv) * 0.48 + mix(shadow, highlight, embossed) + vec3(pow(diffuse, 18.0) * 0.18);',
      '    effected = vec4(clamp(relit, vec3(0.0), vec3(1.0)), src.a);',
      '  } else if (code == 45.0) {',
      '    float scanCount = max(32.0, uParams0.x);',
      '    float maskAmount = clamp(uParams0.y, 0.0, 1.0);',
      '    float maskType = floor(clamp(uParams0.z, 0.0, 2.0) + 0.5);',
      '    float curvature = clamp(uParams0.w, 0.0, 1.0);',
      '    float vignette = clamp(uParams1.x, 0.0, 1.0);',
      '    float glow = clamp(uParams1.y, 0.0, 1.0);',
      '    float rolling = clamp(uParams1.z, 0.0, 1.0);',
      '    float chromatic = clamp(uParams1.w, 0.0, 1.0);',
      '    vec2 crtFieldUv = vec2(uv.x, 1.0 - uv.y);',
      '    vec2 crtUv = crtFieldUv;',
      '    if (curvature > 0.001) {',
      '      vec2 p = crtFieldUv * 2.0 - vec2(1.0);',
      '      vec2 offset = abs(p.yx) / vec2(6.0, 4.0);',
      '      p = p + p * offset * offset * curvature;',
      '      crtUv = p * 0.5 + vec2(0.5);',
      '      if (crtUv.x < 0.0 || crtUv.x > 1.0 || crtUv.y < 0.0 || crtUv.y > 1.0) {',
      '        effected = vec4(0.0, 0.0, 0.0, src.a);',
      '      } else {',
      '        vec2 crtSampleUv = vec2(crtUv.x, 1.0 - crtUv.y);',
      '        vec3 crtCol = sampleRgb(crtSampleUv);',
      '        if (chromatic > 0.001) {',
      '          vec2 cd = (crtUv - vec2(0.5)) * chromatic * 0.01;',
      '          crtCol = vec3(sampleRgb(vec2(crtUv.x + cd.x, 1.0 - (crtUv.y + cd.y))).r, sampleRgb(crtSampleUv).g, sampleRgb(vec2(crtUv.x - cd.x, 1.0 - (crtUv.y - cd.y))).b);',
      '        }',
      '        if (maskAmount > 0.001) {',
      '          vec2 px = crtUv * uResolutionTime.xy;',
      '          float stripe = fract(px.x / 3.0) * 3.0;',
      '          vec3 maskCol = vec3(0.62);',
      '          if (stripe < 1.0) maskCol = vec3(1.4, 0.62, 0.62);',
      '          else if (stripe < 2.0) maskCol = vec3(0.62, 1.4, 0.62);',
      '          else maskCol = vec3(0.62, 0.62, 1.4);',
      '          if (maskType == 2.0) maskCol *= mix(0.75, 1.0, step(0.5, fract(px.y * 0.5)));',
      '          else if (maskType == 1.0) maskCol *= 1.0 - step(0.96, fract(px.y * 0.02)) * 0.3;',
      '          crtCol = mix(crtCol, crtCol * maskCol, maskAmount);',
      '        }',
      '        float scan = sin(crtUv.y * scanCount * 3.14159) * 0.5 + 0.5;',
      '        crtCol *= mix(1.0, scan, clamp(amount, 0.0, 1.0));',
      '        if (glow > 0.001) {',
      '          vec2 tx = vec2(1.0) / max(uResolutionTime.xy, vec2(1.0));',
      '          vec3 g = sampleRgb(vec2(crtUv.x + tx.x, 1.0 - crtUv.y)) + sampleRgb(vec2(crtUv.x - tx.x, 1.0 - crtUv.y)) + sampleRgb(vec2(crtUv.x, 1.0 - (crtUv.y + tx.y))) + sampleRgb(vec2(crtUv.x, 1.0 - (crtUv.y - tx.y)));',
      '          crtCol += g * glow * 0.05;',
      '        }',
      '        if (rolling > 0.001) {',
      '          float bar = smoothstep(0.7, 1.0, sin(crtUv.y * 6.0 - uResolutionTime.z * 1.5));',
      '          crtCol += vec3(bar * rolling * 0.18);',
      '        }',
      '        if (vignette > 0.001) {',
      '          float d = distance(crtUv, vec2(0.5));',
      '          crtCol *= 1.0 - smoothstep(0.3, 0.78, d) * vignette;',
      '        }',
      '        effected = vec4(crtCol, src.a);',
      '      }',
      '    } else {',
      '      vec3 crtCol = sampleRgb(vec2(crtUv.x, 1.0 - crtUv.y));',
      '      effected = vec4(crtCol, src.a);',
      '    }',
      '  } else if (code == 46.0) {',
      '    float palette = floor(clamp(uParams0.x, 0.0, 4.0) + 0.5);',
      '    float shimmer = clamp(uParams0.y, 0.0, 1.0);',
      '    float sensorNoise = clamp(uParams0.z, 0.0, 1.0);',
      '    vec2 thermalUv = uv;',
      '    if (shimmer > 0.001) {',
      '      float lum0 = luma(color);',
      '      float wobble = sin(uv.y * 60.0 + uResolutionTime.z * 4.0) * 0.5 + sin(uv.x * 35.0 + uResolutionTime.z * 3.0) * 0.5;',
      '      thermalUv += vec2(wobble * shimmer * lum0 * 0.006, wobble * shimmer * lum0 * 0.003);',
      '    }',
      '    vec4 thermalSrc = texture2D(uTex, clamp(thermalUv, vec2(0.0), vec2(1.0)));',
      '    float temp = pow(luma(thermalSrc.rgb), 1.0 / max(amount, 0.05));',
      '    if (sensorNoise > 0.001) {',
      '      float band = fract(sin(dot(vec2(floor(uv.y * uResolutionTime.y * 0.5), floor(uResolutionTime.z * 8.0)), vec2(12.9898, 78.233))) * 43758.5453);',
      '      temp = clamp(temp + (band - 0.5) * sensorNoise * 0.18, 0.0, 1.0);',
      '    }',
      '    effected = vec4(thermalPaletteNative(temp, palette), thermalSrc.a);',
      '  } else if (code == 47.0) {',
      '    float noiseAmount = clamp(uParams0.x, 0.0, 1.0);',
      '    float vignette = clamp(uParams0.y, 0.0, 1.0);',
      '    float phosphor = floor(clamp(uParams0.z, 0.0, 2.0) + 0.5);',
      '    float bloom = clamp(uParams0.w, 0.0, 2.0);',
      '    float scopeMask = floor(clamp(uParams1.x, 0.0, 2.0) + 0.5);',
      '    float rollingNoise = clamp(uParams1.y, 0.0, 1.0);',
      '    float lumNight = pow(luma(color), 0.8) * amount;',
      '    vec3 nv = nightVisionTint(lumNight, phosphor);',
      '    float scanline = sin(uv.y * uResolutionTime.y * 2.0) * 0.5 + 0.5;',
      '    nv *= 0.95 + scanline * 0.05;',
      '    if (rollingNoise > 0.001) {',
      '      float bandY = floor((uv.y + uResolutionTime.z * 0.15) * 80.0);',
      '      float bandRand = fract(sin(dot(vec2(bandY, floor(uResolutionTime.z * 4.0)), vec2(12.9898, 78.233))) * 43758.5453);',
      '      nv += vec3(bandRand - 0.5) * rollingNoise * 0.4 * vec3(0.0, 1.0, 0.0);',
      '    }',
      '    if (noiseAmount > 0.001) {',
      '      float n = fract(sin(dot(uv * uResolutionTime.xy + vec2(uResolutionTime.z * 1000.0), vec2(12.9898, 78.233))) * 43758.5453);',
      '      nv += vec3(n - 0.5) * noiseAmount * 0.2;',
      '    }',
      '    if (bloom > 0.001) {',
      '      vec2 tx = (vec2(1.0) / max(uResolutionTime.xy, vec2(1.0))) * (3.0 + bloom * 2.0);',
      '      float glowSum = 0.0;',
      '      for (int by = 0; by < 5; by += 1) {',
      '        float fy = float(by) - 2.0;',
      '        for (int bx = 0; bx < 5; bx += 1) {',
      '          float fx = float(bx) - 2.0;',
      '          glowSum += luma(texture2D(uTex, clamp(uv + vec2(fx, fy) * tx, vec2(0.0), vec2(1.0))).rgb);',
      '        }',
      '      }',
      '      nv += nightVisionTint(glowSum / 25.0, phosphor) * bloom * 0.45;',
      '    }',
      '    float dist = distance(uv, vec2(0.5));',
      '    if (vignette > 0.001) nv *= 1.0 - smoothstep(0.35, 0.78, dist) * vignette;',
      '    if (scopeMask == 1.0) {',
      '      nv *= 1.0 - smoothstep(0.47, 0.50, dist);',
      '    } else if (scopeMask == 2.0) {',
      '      float circle = 1.0 - smoothstep(0.47, 0.50, dist);',
      '      float cross = 1.0 - min(step(0.005, abs(uv.x - 0.5)), step(0.005, abs(uv.y - 0.5)));',
      '      nv = mix(nv * circle, vec3(0.0, 1.0, 0.0), cross * 0.35);',
      '    }',
      '    effected = vec4(clamp(nv, vec3(0.0), vec3(1.5)), src.a);',
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

async function renderWebGlFixtures(sourceCase) {
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
      sourceB64: Buffer.from(sourceCase.bytes).toString('base64'),
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
      pixels.set(`${sourceCase.id}:${fixture.id}`, new Uint8Array(Buffer.from(encoded, 'base64')));
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
    for (let c = 0; c < 4; c += 1) {
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
    p99: deltas[Math.floor(deltas.length * 0.99)] ?? 0,
    max,
  };
}

function orientFrame(bytes, orientation = 'none') {
  const out = new Uint8Array(bytes.length);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const sx = orientation.includes('x') ? WIDTH - 1 - x : x;
      const sy = orientation.includes('y') ? HEIGHT - 1 - y : y;
      const src = (sy * WIDTH + sx) * 4;
      const dst = (y * WIDTH + x) * 4;
      out[dst] = bytes[src];
      out[dst + 1] = bytes[src + 1];
      out[dst + 2] = bytes[src + 2];
      out[dst + 3] = bytes[src + 3];
    }
  }
  return out;
}

function bestOrientationDiff(nativePixels, webglFramePixels) {
  const candidates = [
    { orientation: 'none', pixels: orientFrame(webglFramePixels, 'none') },
    { orientation: 'flip-y', pixels: orientFrame(webglFramePixels, 'y') },
    { orientation: 'flip-x', pixels: orientFrame(webglFramePixels, 'x') },
    { orientation: 'flip-xy', pixels: orientFrame(webglFramePixels, 'xy') },
  ];
  return candidates
    .map((candidate) => ({
      orientation: candidate.orientation,
      ...diffPixels(nativePixels, candidate.pixels),
    }))
    .sort((a, b) => a.mean - b.mean)[0];
}

function assertDiffWithinTolerance(fixture, stats) {
  const { mean, p95, p99, max } = stats;
  const tolerance = fixture.tolerance;
  const p99Tolerance = tolerance.p99 ?? tolerance.max;
  if (
    stats.orientation !== 'none' ||
    mean > tolerance.mean ||
    p95 > tolerance.p95 ||
    p99 > p99Tolerance ||
    max > tolerance.max
  ) {
    throw new Error(
      `native/WebGL ${fixture.id} effect golden drifted: orientation=${stats.orientation} mean=${mean.toFixed(3)}/${tolerance.mean} ` +
      `p95=${p95}/${tolerance.p95} p99=${p99}/${p99Tolerance} max=${max}/${tolerance.max}`,
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
  const sourceCases = ['gradient', 'frequency', 'alpha-mask'].map((id) => ({
    id,
    bytes: makeSourceBytes(WIDTH, HEIGHT, id),
  }));
  const nativeResults = [];
  const webglResults = [];
  for (const sourceCase of sourceCases) {
    nativeResults.push(await renderNativeFixtures(sourceCase));
    webglResults.push(await renderWebGlFixtures(sourceCase));
  }
  const nativePixels = new Map(nativeResults.flatMap((result) => [...result.entries()]));
  const webglPixels = new Map(webglResults.flatMap((result) => [...result.entries()]));

  const summaries = [];
  for (const sourceCase of sourceCases) {
    for (const fixture of WEBGL_FIXTURES) {
      const key = `${sourceCase.id}:${fixture.id}`;
      const native = nativePixels.get(key);
      const webgl = webglPixels.get(key);
      if (!native || !webgl) {
        throw new Error(`native/WebGL ${key} effect golden omitted one side`);
      }
      const stats = bestOrientationDiff(native.pixels, webgl);
      if (process.env.NATIVE_EFFECT_GOLDEN_DEBUG === '1') {
        console.log(
          `debug ${key}: nativeMean=${meanRgb(native.pixels).join(',')} ` +
          `webglMean=${meanRgb(webgl).join(',')} best=${stats.orientation} ` +
          `mean=${stats.mean.toFixed(3)} p95=${stats.p95} p99=${stats.p99} max=${stats.max}`,
        );
      }
      assertDiffWithinTolerance({ ...fixture, id: key }, stats);
      summaries.push(
        `${key}:${native.checksum} ${stats.orientation} mean=${stats.mean.toFixed(2)} p95=${stats.p95} p99=${stats.p99} max=${stats.max}`,
      );
    }
  }

  console.log(`Native/WebGL effect-pass golden passed: ${summaries.join(' ')}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
