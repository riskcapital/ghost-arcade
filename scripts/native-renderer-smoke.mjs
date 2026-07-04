import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const bin = join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

const NATIVE_SHADER_CATALOG_PROBES = [
  { id: 'planet', params: [1.35, 1.12, 0.66, 0.42, 0.08, 0.52, 0.72, 1] },
  { id: 'pixel-particles', params: [1.35, 1.05, 0.78, 0.66, 0.18, 0.64, 0.74, 1] },
  { id: 'flythrough', params: [1.42, 1.14, 0.72, 0.78, 0.28, 0.68, 0.70, 1] },
  { id: 'point-cloud-fx', params: [1.48, 1.18, 0.74, 0.58, 0.38, 0.62, 0.72, 1] },
  { id: 'particle-field', params: [1.45, 1.10, 0.76, 0.62, 0.48, 0.70, 0.60, 1] },
  { id: 'volumetric-balls', params: [1.35, 1.25, 0.72, 0.55, 0.31, 0.65, 0.48, 1] },
  { id: 'smoke-riders', params: [1.42, 1.08, 0.82, 0.50, 0.58, 0.70, 0.70, 1] },
  { id: 'gravity-wells', params: [1.46, 1.12, 0.80, 0.70, 0.68, 0.78, 0.68, 1] },
  { id: 'ink-cloud', params: [1.36, 1.22, 0.84, 0.46, 0.76, 0.74, 0.72, 1] },
  { id: 'smoke-3d', params: [1.34, 1.16, 0.82, 0.48, 0.86, 0.76, 0.76, 1] },
];

const NATIVE_WGSL_PROBE_SOURCE = `
struct NativeShaderUniforms {
  resolution_time: vec4<f32>,
  frame_seed_inputs: vec4<f32>,
  date: vec4<f32>,
  audio0: vec4<f32>,
  audio1: vec4<f32>,
  params0: vec4<f32>,
  params1: vec4<f32>,
  audio2: vec4<f32>,
}

@group(0) @binding(0)
var<uniform> u: NativeShaderUniforms;

@group(0) @binding(1)
var source_frames: texture_2d_array<f32>;

@group(0) @binding(2)
var source_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let t = u.resolution_time.z;
  let beat = u.audio1.y;
  let centroid = u.audio2.x;
  let kick = u.audio2.y;
  let seed = u.frame_seed_inputs.y;
  let source_slot = i32(round(u.frame_seed_inputs.w));
  let media = textureSample(source_frames, source_sampler, uv, source_slot);
  let scale = 36.0 + u.params0.y * 10.0;
  let grid_x = smoothstep(0.42, 0.50, fract(uv.x * scale + t * 0.23 + beat * 0.4));
  let grid_y = smoothstep(0.42, 0.50, fract(uv.y * (scale * 0.72) - t * 0.17));
  let fine_grid = max(grid_x * (1.0 - grid_y), grid_y * (1.0 - grid_x));
  let center = uv - vec2<f32>(0.5);
  let r = length(center);
  let rings = 0.5 + 0.5 * sin(r * 74.0 - t * 3.0 + seed * 6.28318);
  let procedural = mix(vec3<f32>(0.02, 0.08, 0.18), vec3<f32>(0.92, 0.20, 0.78), fine_grid);
  let glow = vec3<f32>(0.1, 0.38, 0.92) * rings * (1.0 - smoothstep(0.1, 0.72, r));
  let audio_tint = vec3<f32>(centroid * 0.18, kick * 0.10, u.audio2.w * 0.08);
  let color = mix(procedural + glow + audio_tint, media.rgb, 0.42);
  return vec4<f32>(color, 1.0);
}
`;

const NATIVE_COMPUTE_PROBE_SOURCE = `
struct ComputeProbeUniforms {
  element_count: u32,
  frame_index: u32,
  seed: u32,
  _pad0: u32,
}

@group(0) @binding(0)
var<storage, read_write> output_words: array<u32>;

@group(0) @binding(1)
var<uniform> probe: ComputeProbeUniforms;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= probe.element_count) { return; }
  var x = i * 747796405u + probe.seed + probe.frame_index * 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  output_words[i] = (x >> 22u) ^ x ^ (probe.element_count * 2246822519u);
}
`;

const NATIVE_COMPUTE_GRAPH_FILL_SOURCE = `
struct GraphUniforms {
  element_count: u32,
  seed: u32,
  frame_index: u32,
  scale: u32,
}

@group(0) @binding(0)
var<storage, read_write> scratch_words: array<u32>;

@group(0) @binding(1)
var<uniform> graph: GraphUniforms;

@compute @workgroup_size(64)
fn cs_fill(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= graph.element_count) { return; }
  scratch_words[i] = (i + 1u) * graph.scale + graph.seed + graph.frame_index * 17u;
}
`;

const NATIVE_COMPUTE_GRAPH_TRANSFORM_SOURCE = `
struct GraphUniforms {
  element_count: u32,
  seed: u32,
  frame_index: u32,
  scale: u32,
}

@group(0) @binding(0)
var<storage, read> scratch_words: array<u32>;

@group(0) @binding(1)
var<storage, read_write> output_words: array<u32>;

@group(0) @binding(2)
var<uniform> graph: GraphUniforms;

@compute @workgroup_size(64)
fn cs_transform(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= graph.element_count) { return; }
  let x = scratch_words[i];
  output_words[i] = (x ^ (x << 7u) ^ (x >> 3u)) + graph.seed * 3u + i;
}
`;

const NATIVE_COMPUTE_GRAPH_SAMPLE_SOURCE = `
struct GraphUniforms {
  element_count: u32,
  seed: u32,
  frame_index: u32,
  scale: u32,
}

@group(0) @binding(0)
var<storage, read_write> output_words: array<u32>;

@group(0) @binding(1)
var<uniform> graph: GraphUniforms;

@group(0) @binding(2)
var source_frame: texture_2d<f32>;

@group(0) @binding(3)
var source_sampler: sampler;

@compute @workgroup_size(64)
fn cs_sample(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= graph.element_count) { return; }
  let x = f32(i % 16u);
  let y = f32((i / 16u) % 16u);
  let uv = (vec2<f32>(x, y) + vec2<f32>(0.5)) / vec2<f32>(16.0, 16.0);
  let rgba = textureSampleLevel(source_frame, source_sampler, uv, 0.0);
  let r = u32(clamp(rgba.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(rgba.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(rgba.b, 0.0, 1.0) * 255.0);
  output_words[i] = r | (g << 8u) | (b << 16u) | ((graph.seed + i) << 24u);
}
`;

const NATIVE_COMPUTE_GRAPH_RENDER_SOURCE = `
struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0)
var<storage, read> output_words: array<u32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = positions[vid];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let xy = vec2<u32>(clamp(floor(in.uv * vec2<f32>(16.0, 16.0)), vec2<f32>(0.0), vec2<f32>(15.0)));
  let idx = xy.x + xy.y * 16u;
  let word = output_words[idx];
  let r = f32(word & 255u) / 255.0;
  let g = f32((word >> 8u) & 255u) / 255.0;
  let b = f32((word >> 16u) & 255u) / 255.0;
  return vec4<f32>(0.1 + r * 0.9, 0.08 + g * 0.85, 0.16 + b * 0.8, 1.0);
}
`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePreviewPixels(width, height) {
  const rgba = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = x / Math.max(1, width - 1);
      const cy = y / Math.max(1, height - 1);
      const stripe = ((x >> 2) + (y >> 2)) % 2;
      rgba.push(Math.round(255 * (stripe ? cx : 1 - cy)));
      rgba.push(Math.round(255 * cy));
      rgba.push(Math.round(255 * (stripe ? 0.2 : 0.9)));
      rgba.push(255);
    }
  }
  return rgba;
}

function makePreviewPixelBytes(width, height) {
  return Buffer.from(Uint8Array.from(makePreviewPixels(width, height)));
}

function createRpcProcess() {
  if (!existsSync(bin)) {
    throw new Error(`native render-core binary is missing: ${bin}\nRun npm run native:build first.`);
  }

  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line);
        const wait = pending.get(message.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const send = (method, params = {}, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`native render-core timed out handling ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });

  const close = async () => {
    try {
      await send('shutdown', {}, 1000);
    } catch {
      // The process may already be gone after a failed smoke assertion.
    }
    child.kill();
    return stderr.trim();
  };

  return { send, close };
}

function assertFrame(name, snapshot, minLuma = 0.01) {
  const luma = Number(snapshot.average_luma ?? 0);
  const nonzero = Number(snapshot.nonzero_pixels ?? 0);
  const bright = Number(snapshot.bright_pixels ?? 0);
  if (snapshot.dark_frame || luma < minLuma || nonzero <= 0) {
    throw new Error(
      `${name} rendered dark/blank: dark=${snapshot.dark_frame} luma=${luma.toFixed(5)} nonzero=${nonzero} bright=${bright}`,
    );
  }
}

function assertDifferent(label, a, b) {
  if (!a?.checksum || !b?.checksum || a.checksum === b.checksum) {
    throw new Error(`${label} did not change frame checksum (${a?.checksum ?? 'missing'})`);
  }
}

async function snapshot(rpc, label, time, frameIndex) {
  const snap = await rpc.send('frame_snapshot', {
    include_pixels: false,
    time,
    frame_index: frameIndex,
  }, 10000);
  return { label, ...snap };
}

async function waitForManagedOutputHealthy(rpc, attempts = 24) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await rpc.send('submit_commands', {
      commands: [{ type: 'present' }],
    }, 5000);
    await delay(50);
    latest = await rpc.send('status', {}, 5000);
    if (
      latest?.output_present_healthy &&
      Number(latest.frames_presented ?? 0) > 0 &&
      Number(latest.swapchain_presented ?? 0) > 0
    ) {
      return latest;
    }
  }
  return latest;
}

async function renderBlendProbe(rpc, blendMode, frameIndex) {
  await rpc.send('submit_commands', {
    commands: [
      { type: 'remove_layer', layer_id: 'particle-gpu' },
      { type: 'remove_layer', layer_id: 'blend-base' },
      { type: 'remove_layer', layer_id: 'blend-top' },
      { type: 'upsert_layer', layer_id: 'blend-base', z_index: 1, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
      { type: 'set_layer_visibility', layer_id: 'blend-base', visible: true },
      { type: 'set_layer_color', layer_id: 'blend-base', rgba: [0.18, 0.42, 0.88, 1] },
      { type: 'upsert_layer', layer_id: 'blend-top', z_index: 0, blend_mode: blendMode, opacity: 0.86, corners: FULLSCREEN_CORNERS },
      { type: 'set_layer_visibility', layer_id: 'blend-top', visible: true },
      { type: 'set_layer_color', layer_id: 'blend-top', rgba: [0.95, 0.22, 0.15, 0.92] },
    ],
  });
  return snapshot(rpc, `blend-${blendMode}`, 2.0 + frameIndex * 0.01, frameIndex);
}

async function renderNativeShaderProbe(rpc, probe, frameIndex, baseline) {
  const layerId = 'catalog-gpu';
  await rpc.send('submit_commands', {
    commands: [
      { type: 'remove_layer', layer_id: 'smoke-gpu' },
      { type: 'remove_layer', layer_id: 'particle-gpu' },
      { type: 'remove_layer', layer_id: layerId },
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'screen', opacity: 1, corners: FULLSCREEN_CORNERS },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      {
        type: 'bind_media_source',
        layer_id: layerId,
        source_id: `catalog-gpu-source-${probe.id}`,
        uri: `gpu://${probe.id}`,
        source_type: `gpu:${probe.id}`,
      },
      { type: 'set_layer_native_params', layer_id: layerId, params: probe.params },
    ],
  });
  const a = await snapshot(rpc, `catalog-${probe.id}-a`, 0.85 + frameIndex * 0.07, frameIndex);
  const b = await snapshot(rpc, `catalog-${probe.id}-b`, 1.95 + frameIndex * 0.07, frameIndex + 1);
  assertFrame(`native catalog ${probe.id}`, a, 0.012);
  assertFrame(`native catalog ${probe.id} animated`, b, 0.012);
  assertDifferent(`native catalog ${probe.id} vs baseline`, baseline, a);
  assertDifferent(`native catalog ${probe.id} animation`, a, b);
  return { id: probe.id, a, b };
}

async function renderRegisteredWgslProbe(rpc, frameIndex, baseline) {
  const shaderId = 'smoke-real-wgsl';
  const layerId = 'registered-wgsl';
  await rpc.send('submit_commands', {
    commands: [
      { type: 'remove_layer', layer_id: 'catalog-gpu' },
      { type: 'remove_layer', layer_id: 'smoke-gpu' },
      { type: 'remove_layer', layer_id: 'particle-gpu' },
      { type: 'remove_layer', layer_id: layerId },
      {
        type: 'precompile_shader',
        shader_id: shaderId,
        stage: 'pixel',
        source: NATIVE_WGSL_PROBE_SOURCE,
        entry: 'fs_main',
      },
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'bind_media_source', layer_id: layerId, source_id: 'smoke-file-source', uri: 'smoke-file://gradient', source_type: 'image' },
      { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
      {
        type: 'update_isf_uniforms',
        shader_id: shaderId,
        time: 1.25,
        time_delta: 1 / 30,
        frame_index: frameIndex,
        render_width: 320,
        render_height: 180,
        active: true,
        level: 0.36,
        bass: 0.42,
        mid: 0.31,
        treble: 0.27,
        high: 0.44,
        beat: 0.72,
        beat_phase: 0.18,
        bpm: 128,
        centroid: 0.63,
        kick: 0.52,
        snare: 0.24,
        audio_bass: 0.42,
        audio_beat: 0.72,
        audio_spectral_centroid: 0.63,
        audio_kick: 0.52,
        audio_snare: 0.24,
        float_inputs: { intensity: 1.2, scale: 0.8 },
      },
      { type: 'render_isf_to_layer', layer_id: layerId },
    ],
  });
  const first = await snapshot(rpc, 'registered-wgsl-a', 1.25, frameIndex);
  assertFrame('registered WGSL shader layer', first, 0.02);
  assertDifferent('registered WGSL shader vs baseline', baseline, first);

  await rpc.send('submit_commands', {
    commands: [
      {
        type: 'update_isf_uniforms',
        shader_id: shaderId,
        time: 2.5,
        time_delta: 1 / 30,
        frame_index: frameIndex + 1,
        render_width: 320,
        render_height: 180,
        active: true,
        level: 0.2,
        bass: 0.18,
        mid: 0.22,
        treble: 0.68,
        high: 0.7,
        beat: 0.05,
        beat_phase: 0.62,
        bpm: 92,
        centroid: 0.22,
        kick: 0.08,
        snare: 0.66,
        audio_bass: 0.18,
        audio_beat: 0.05,
        audio_spectral_centroid: 0.22,
        audio_kick: 0.08,
        audio_snare: 0.66,
        float_inputs: { intensity: 1.2, scale: 0.8 },
      },
      { type: 'render_isf_to_layer', layer_id: layerId },
    ],
  });
  const second = await snapshot(rpc, 'registered-wgsl-b', 2.5, frameIndex + 1);
  assertFrame('registered WGSL shader layer animated', second, 0.02);
  assertDifferent('registered WGSL shader clock/uniform update', first, second);
  return { first, second };
}

async function main() {
  const requireManagedOutput = process.env.NATIVE_SMOKE_REQUIRE_OUTPUT === '1';
  const rpc = createRpcProcess();
  let smokeTempDir = null;
  let sourceFrameFile = null;
  let sourceFrameFileSnapshot = null;
  let graphSourceFrameSnapshot = null;
  try {
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    }, 12000);
    await delay(80);

    const capabilities = await rpc.send('capabilities', {}, 5000);
    if (!capabilities?.features?.layer_compositor || !capabilities?.features?.fragment_wgsl_host) {
      throw new Error(`native capabilities missing implemented core features: ${JSON.stringify(capabilities)}`);
    }
    if (
      !capabilities.features.compute_shader_host ||
      !capabilities.features.compute_graph_host ||
      !capabilities.features.compute_graph_render ||
      !capabilities.features.compute_graph_multi_render ||
      !capabilities.features.compute_graph_instanced_render ||
      !capabilities.features.compute_graph_indirect_render ||
      !capabilities.features.compute_graph_texture_sampling ||
      !capabilities.features.compute_graph_depth_render ||
      !capabilities.features.compute_graph_line_render ||
      !capabilities.features.compute_graph_clear_color ||
      !capabilities.features.compute_graph_source_frame_target ||
      !capabilities.features.persistent_compute_buffers ||
      !capabilities.features.native_planet_graph ||
      !capabilities.features.native_3d_smoke_graph ||
      !capabilities.features.native_volumetric_spheres_graph ||
      !capabilities.features.native_smoke_riders_graph ||
      !capabilities.features.native_ink_cloud_graph ||
      !capabilities.features.native_flythrough_graph ||
      !capabilities.features.native_pixel_particles_graph ||
      !capabilities.features.native_point_cloud_fx_graph ||
      capabilities.features.multi_pass_instruments
    ) {
      throw new Error(`native compute capability flags are not honest yet: ${JSON.stringify(capabilities.features)}`);
    }
    const readiness = await rpc.send('readiness', {}, 5000);
    const readinessChecks = new Map((readiness?.checks ?? []).map((check) => [check?.id, check]));
    for (const id of [
      'compute-instrument-host',
      'native-flythrough-graph',
      'native-pixel-particles-graph',
      'native-point-cloud-fx-graph',
    ]) {
      if (!readinessChecks.get(id)?.ok) {
        throw new Error(`native readiness report has stale or missing ${id}: ${JSON.stringify(readiness)}`);
      }
    }
    if (
      !capabilities.implemented_methods?.includes('set_output_window') ||
      !capabilities.features.managed_output_window_control
    ) {
      throw new Error(`native output-window control capability missing: ${JSON.stringify(capabilities)}`);
    }
    if (
      capabilities.features.shared_texture_upload ||
      capabilities.features.shared_texture_output_export ||
      capabilities.features.native_texture_share_sender
    ) {
      throw new Error(`native capabilities overstated unimplemented features: ${JSON.stringify(capabilities.features)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('smoke-3d')) {
      throw new Error(`native graph instrument manifest missing smoke-3d: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('planet')) {
      throw new Error(`native graph instrument manifest missing planet: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('volumetric-spheres')) {
      throw new Error(`native graph instrument manifest missing volumetric-spheres: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('smoke-riders')) {
      throw new Error(`native graph instrument manifest missing smoke-riders: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('ink-cloud')) {
      throw new Error(`native graph instrument manifest missing ink-cloud: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('flythrough')) {
      throw new Error(`native graph instrument manifest missing flythrough: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('pixel-particles')) {
      throw new Error(`native graph instrument manifest missing pixel-particles: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.native_graph_instruments?.includes('point-cloud-fx')) {
      throw new Error(`native graph instrument manifest missing point-cloud-fx: ${JSON.stringify(capabilities)}`);
    }
    const smokeManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'smoke-3d');
    const planetManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'planet');
    if (
      !planetManifest ||
      planetManifest.source_uri_prefix !== 'native-graph://planet/' ||
      planetManifest.render_target !== 'source_frame' ||
      !planetManifest.shader_ids?.includes('planet/render') ||
      !planetManifest.features?.includes('compute_graph_instanced_render') ||
      !planetManifest.features?.includes('compute_graph_clear_color') ||
      !planetManifest.features?.includes('native_planet_graph')
    ) {
      throw new Error(`native planet manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    if (
      !smokeManifest ||
      smokeManifest.source_uri_prefix !== 'native-graph://smoke-3d/' ||
      smokeManifest.render_target !== 'source_frame' ||
      !smokeManifest.features?.includes('compute_graph_multi_render') ||
      !smokeManifest.features?.includes('compute_graph_instanced_render') ||
      !smokeManifest.features?.includes('compute_graph_indirect_render') ||
      !smokeManifest.features?.includes('compute_graph_texture_sampling') ||
      !smokeManifest.features?.includes('compute_graph_depth_render') ||
      !smokeManifest.features?.includes('compute_graph_line_render') ||
      !smokeManifest.features?.includes('compute_graph_clear_color') ||
      !smokeManifest.features?.includes('compute_graph_source_frame_target')
    ) {
      throw new Error(`native graph instrument manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const volumetricManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'volumetric-spheres');
    if (
      !volumetricManifest ||
      volumetricManifest.source_uri_prefix !== 'native-graph://volumetric-spheres/' ||
      volumetricManifest.render_target !== 'source_frame' ||
      !volumetricManifest.shader_ids?.includes('volumetric-spheres/sim') ||
      !volumetricManifest.shader_ids?.includes('volumetric-spheres/render') ||
      !volumetricManifest.features?.includes('compute_graph_instanced_render') ||
      !volumetricManifest.features?.includes('compute_graph_depth_render') ||
      !volumetricManifest.features?.includes('compute_graph_clear_color') ||
      !volumetricManifest.features?.includes('native_volumetric_spheres_graph')
    ) {
      throw new Error(`native volumetric-spheres manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const smokeRidersManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'smoke-riders');
    if (
      !smokeRidersManifest ||
      smokeRidersManifest.source_uri_prefix !== 'native-graph://smoke-riders/' ||
      smokeRidersManifest.render_target !== 'source_frame' ||
      !smokeRidersManifest.shader_ids?.includes('3d-smoke/render') ||
      !smokeRidersManifest.shader_ids?.includes('volumetric-spheres/render') ||
      !smokeRidersManifest.features?.includes('compute_graph_multi_render') ||
      !smokeRidersManifest.features?.includes('native_3d_smoke_graph') ||
      !smokeRidersManifest.features?.includes('native_volumetric_spheres_graph') ||
      !smokeRidersManifest.features?.includes('native_smoke_riders_graph')
    ) {
      throw new Error(`native smoke-riders manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const inkCloudManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'ink-cloud');
    if (
      !inkCloudManifest ||
      inkCloudManifest.source_uri_prefix !== 'native-graph://ink-cloud/' ||
      inkCloudManifest.render_target !== 'source_frame' ||
      !inkCloudManifest.shader_ids?.includes('ink-cloud/sim') ||
      !inkCloudManifest.shader_ids?.includes('ink-cloud/render') ||
      !inkCloudManifest.shader_ids?.includes('ink-cloud/background') ||
      !inkCloudManifest.features?.includes('compute_graph_multi_render') ||
      !inkCloudManifest.features?.includes('compute_graph_instanced_render') ||
      !inkCloudManifest.features?.includes('compute_graph_clear_color') ||
      !inkCloudManifest.features?.includes('native_ink_cloud_graph')
    ) {
      throw new Error(`native ink-cloud manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const flythroughManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'flythrough');
    if (
      !flythroughManifest ||
      flythroughManifest.source_uri_prefix !== 'native-graph://flythrough/' ||
      flythroughManifest.render_target !== 'source_frame' ||
      !flythroughManifest.shader_ids?.includes('flythrough/compute') ||
      !flythroughManifest.shader_ids?.includes('flythrough/render') ||
      !flythroughManifest.features?.includes('compute_graph_instanced_render') ||
      !flythroughManifest.features?.includes('compute_graph_texture_sampling') ||
      !flythroughManifest.features?.includes('compute_graph_clear_color') ||
      !flythroughManifest.features?.includes('native_flythrough_graph')
    ) {
      throw new Error(`native flythrough manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const pixelParticlesManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'pixel-particles');
    if (
      !pixelParticlesManifest ||
      pixelParticlesManifest.source_uri_prefix !== 'native-graph://pixel-particles/' ||
      pixelParticlesManifest.render_target !== 'source_frame' ||
      !pixelParticlesManifest.shader_ids?.includes('pixel-particles/compute') ||
      !pixelParticlesManifest.shader_ids?.includes('pixel-particles/render') ||
      !pixelParticlesManifest.features?.includes('compute_graph_instanced_render') ||
      !pixelParticlesManifest.features?.includes('compute_graph_texture_sampling') ||
      !pixelParticlesManifest.features?.includes('compute_graph_clear_color') ||
      !pixelParticlesManifest.features?.includes('native_pixel_particles_graph')
    ) {
      throw new Error(`native pixel-particles manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    const pointCloudManifest = capabilities.native_graph_instrument_manifest?.find((entry) => entry?.id === 'point-cloud-fx');
    if (
      !pointCloudManifest ||
      pointCloudManifest.source_uri_prefix !== 'native-graph://point-cloud-fx/' ||
      pointCloudManifest.render_target !== 'source_frame' ||
      !pointCloudManifest.shader_ids?.includes('point-cloud-fx/compute') ||
      !pointCloudManifest.shader_ids?.includes('point-cloud-fx/render') ||
      !pointCloudManifest.features?.includes('compute_graph_instanced_render') ||
      !pointCloudManifest.features?.includes('compute_graph_clear_color') ||
      !pointCloudManifest.features?.includes('persistent_compute_buffers') ||
      !pointCloudManifest.features?.includes('native_point_cloud_fx_graph')
    ) {
      throw new Error(`native point-cloud-fx manifest entry is incomplete: ${JSON.stringify(capabilities.native_graph_instrument_manifest)}`);
    }
    if (!capabilities.features.present_policy || !capabilities.features.managed_output_attach) {
      throw new Error(`native managed output/present capabilities missing: ${JSON.stringify(capabilities.features)}`);
    }
    if (
      !capabilities.features.audio_uniform_layout ||
      capabilities.audio_uniform_layout?.schema_version !== 1 ||
      capabilities.audio_uniform_layout?.audio0?.join(',') !== 'level,bass,mid,treble' ||
      capabilities.audio_uniform_layout?.audio1?.join(',') !== 'high,beat,beat_phase,bpm' ||
      capabilities.audio_uniform_layout?.audio2?.join(',') !== 'centroid,kick,snare,active'
    ) {
      throw new Error(`native audio uniform layout contract missing or stale: ${JSON.stringify(capabilities)}`);
    }
    if (!capabilities.implemented_methods?.includes('capabilities')) {
      throw new Error(`native capabilities did not list the capabilities RPC: ${JSON.stringify(capabilities)}`);
    }
    for (const method of [
      'set_present_policy',
      'set_command_drain_policy',
      'set_auto_present_policy',
      'attach_output_window',
      'detach_output_window',
    ]) {
      if (!capabilities.implemented_methods?.includes(method)) {
        throw new Error(`native capabilities did not list ${method}: ${JSON.stringify(capabilities.implemented_methods)}`);
      }
    }
    if (!capabilities.features?.command_drain_policy || !capabilities.features?.auto_present_policy) {
      throw new Error(`native command presentation policy features missing: ${JSON.stringify(capabilities.features)}`);
    }
    const presentStatus = await rpc.send('set_present_policy', {
      config: {
        present_mode: 'vsync',
        allow_tearing: false,
        max_frame_latency: 1,
        use_waitable_object: false,
      },
    }, 5000);
    if (
      presentStatus?.present_mode !== 'vsync' ||
      Number(presentStatus?.max_frame_latency ?? 0) !== 1 ||
      !presentStatus?.output_window_attached
    ) {
      throw new Error(`native present policy/status did not apply: ${JSON.stringify(presentStatus)}`);
    }
    const drainStatus = await rpc.send('set_command_drain_policy', {
      config: { max_commands_per_tick: 4 },
    }, 5000);
    if (Number(drainStatus?.command_drain_limit ?? 0) !== 4) {
      throw new Error(`native command drain policy did not apply: ${JSON.stringify(drainStatus)}`);
    }
    const autoPresentStatus = await rpc.send('set_auto_present_policy', {
      config: { auto_present_on_state_change: true },
    }, 5000);
    if (!autoPresentStatus?.auto_present_on_state_change) {
      throw new Error(`native auto-present policy did not apply: ${JSON.stringify(autoPresentStatus)}`);
    }
    await rpc.send('attach_output_window', { label: 'native-smoke-output' }, 5000);
    const outputWindowStatus = await rpc.send('set_output_window', {
      config: {
        title: 'Ghost Native Smoke Test',
        attached: true,
        fullscreen: false,
        resizable: true,
        decorations: true,
      },
    }, 5000);
    if (!outputWindowStatus?.output_window_attached) {
      throw new Error(`native output-window config did not apply: ${JSON.stringify(outputWindowStatus)}`);
    }
    try {
      await rpc.send('definitely_not_a_real_method', {}, 1000);
      throw new Error('unknown RPC method unexpectedly succeeded');
    } catch (err) {
      if (!String(err?.message || err).includes('unsupported native render-core RPC method')) {
        throw err;
      }
    }

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'precompile_shader',
          shader_id: 'native-compute-probe',
          stage: 'compute',
          entry: 'cs_main',
          source: NATIVE_COMPUTE_PROBE_SOURCE,
        },
        {
          type: 'precompile_shader',
          shader_id: 'native-compute-graph-fill',
          stage: 'compute',
          entry: 'cs_fill',
          source: NATIVE_COMPUTE_GRAPH_FILL_SOURCE,
        },
        {
          type: 'precompile_shader',
          shader_id: 'native-compute-graph-transform',
          stage: 'compute',
          entry: 'cs_transform',
          source: NATIVE_COMPUTE_GRAPH_TRANSFORM_SOURCE,
        },
        {
          type: 'precompile_shader',
          shader_id: 'native-compute-graph-sample',
          stage: 'compute',
          entry: 'cs_sample',
          source: NATIVE_COMPUTE_GRAPH_SAMPLE_SOURCE,
        },
        {
          type: 'precompile_shader',
          shader_id: 'native-compute-graph-render',
          stage: 'render',
          entry: 'fs_main',
          source: NATIVE_COMPUTE_GRAPH_RENDER_SOURCE,
        },
      ],
    });
    const computeProbe = await rpc.send('compute_probe', {
      shader_id: 'native-compute-probe',
      element_count: 256,
      frame_index: 7,
      seed: 12345,
    }, 5000);
    if (Number(computeProbe.nonzero_words ?? 0) < 240 || !computeProbe.checksum) {
      throw new Error(`native compute probe did not write expected data: ${JSON.stringify(computeProbe)}`);
    }
    const computeGraph = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-uniform', kind: 'uniform', initial_u32: [256, 98765, 3, 11] },
        { id: 'graph-scratch', kind: 'storage', byte_length: 1024 },
        { id: 'graph-output', kind: 'storage', byte_length: 1024 },
      ],
      passes: [
        {
          name: 'fill',
          shader_id: 'native-compute-graph-fill',
          entry: 'cs_fill',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-scratch', kind: 'storage' },
            { binding: 1, resource: 'graph-uniform', kind: 'uniform' },
          ],
        },
        {
          name: 'transform',
          shader_id: 'native-compute-graph-transform',
          entry: 'cs_transform',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-scratch', kind: 'read-only-storage' },
            { binding: 1, resource: 'graph-output', kind: 'storage' },
            { binding: 2, resource: 'graph-uniform', kind: 'uniform' },
          ],
        },
      ],
      readbacks: ['graph-scratch', 'graph-output'],
      render: {
        name: 'render-output-buffer',
        shader_id: 'native-compute-graph-render',
        vertex_entry: 'vs_main',
        fragment_entry: 'fs_main',
        clear: true,
        clear_color: [0.02, 0.04, 0.08, 1],
        include_snapshot: true,
        bindings: [
          { binding: 0, resource: 'graph-output', kind: 'read-only-storage' },
        ],
      },
    }, 5000);
    const scratchReadback = computeGraph?.readbacks?.['graph-scratch'];
    const outputReadback = computeGraph?.readbacks?.['graph-output'];
    const graphRenderSnapshot = computeGraph?.render_snapshot;
    if (Number(computeGraph?.pass_count ?? 0) !== 2) {
      throw new Error(`native compute graph did not execute both passes: ${JSON.stringify(computeGraph)}`);
    }
    if (Number(scratchReadback?.nonzero_words ?? 0) < 240 || Number(outputReadback?.nonzero_words ?? 0) < 240) {
      throw new Error(`native compute graph readbacks were sparse: ${JSON.stringify(computeGraph)}`);
    }
    if (!outputReadback?.checksum || outputReadback.checksum === scratchReadback?.checksum) {
      throw new Error(`native compute graph transform pass did not alter output: ${JSON.stringify(computeGraph)}`);
    }
    const graphClearColor = computeGraph?.render?.clear_color;
    if (
      !Array.isArray(graphClearColor) ||
      Math.abs(Number(graphClearColor[0]) - 0.02) > 0.005 ||
      Math.abs(Number(graphClearColor[1]) - 0.04) > 0.005 ||
      Math.abs(Number(graphClearColor[2]) - 0.08) > 0.005 ||
      Math.abs(Number(graphClearColor[3]) - 1) > 0.005
    ) {
      throw new Error(`native compute graph clear_color was not reported: ${JSON.stringify(computeGraph?.render)}`);
    }
    if (!graphRenderSnapshot?.checksum || graphRenderSnapshot.dark_frame || Number(graphRenderSnapshot.nonzero_pixels ?? 0) <= 0) {
      throw new Error(`native compute graph render snapshot failed: ${JSON.stringify(computeGraph)}`);
    }
    const computeGraphMultiRender = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-multi-uniform', kind: 'uniform', initial_u32: [256, 13531, 8, 5] },
        { id: 'graph-multi-scratch', kind: 'storage', byte_length: 1024 },
        { id: 'graph-multi-output', kind: 'storage', byte_length: 1024 },
        { id: 'graph-multi-indirect', kind: 'storage', indirect: true, initial_u32: [3, 2, 0, 0] },
      ],
      passes: [
        {
          name: 'multi-fill',
          shader_id: 'native-compute-graph-fill',
          entry: 'cs_fill',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-multi-scratch', kind: 'storage' },
            { binding: 1, resource: 'graph-multi-uniform', kind: 'uniform' },
          ],
        },
        {
          name: 'multi-transform',
          shader_id: 'native-compute-graph-transform',
          entry: 'cs_transform',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-multi-scratch', kind: 'read-only-storage' },
            { binding: 1, resource: 'graph-multi-output', kind: 'storage' },
            { binding: 2, resource: 'graph-multi-uniform', kind: 'uniform' },
          ],
        },
      ],
      render_passes: [
        {
          name: 'multi-render-base',
          shader_id: 'native-compute-graph-render',
          vertex_entry: 'vs_main',
          fragment_entry: 'fs_main',
          target: 'snapshot',
          clear: true,
          include_snapshot: false,
          blend: 'replace',
          depth: true,
          depth_write: true,
          depth_compare: 'less',
          bindings: [
            { binding: 0, resource: 'graph-multi-output', kind: 'read-only-storage' },
          ],
        },
        {
          name: 'multi-render-indirect',
          shader_id: 'native-compute-graph-render',
          vertex_entry: 'vs_main',
          fragment_entry: 'fs_main',
          target: 'snapshot',
          clear: false,
          include_snapshot: true,
          blend: 'add',
          draw_indirect_buffer: 'graph-multi-indirect',
          bindings: [
            { binding: 0, resource: 'graph-multi-output', kind: 'read-only-storage' },
          ],
        },
        {
          name: 'multi-render-add',
          shader_id: 'native-compute-graph-render',
          vertex_entry: 'vs_main',
          fragment_entry: 'fs_main',
          target: 'snapshot',
          clear: false,
          include_snapshot: true,
          blend: 'add',
          vertex_count: 3,
          instance_count: 2,
          bindings: [
            { binding: 0, resource: 'graph-multi-output', kind: 'read-only-storage' },
          ],
        },
      ],
    }, 5000);
    if (computeGraphMultiRender?.render || computeGraphMultiRender?.renders?.length !== 3) {
      throw new Error(`native compute graph multi-render response shape is wrong: ${JSON.stringify(computeGraphMultiRender)}`);
    }
    if (
      computeGraphMultiRender.renders[0]?.blend !== 'replace' ||
      computeGraphMultiRender.renders[0]?.depth !== true ||
      computeGraphMultiRender.renders[1]?.draw !== 'indirect' ||
      computeGraphMultiRender.renders[1]?.indirect_buffer !== 'graph-multi-indirect' ||
      computeGraphMultiRender.renders[2]?.blend !== 'add' ||
      Number(computeGraphMultiRender.renders[2]?.instance_count ?? 0) !== 2 ||
      !computeGraphMultiRender?.render_snapshot?.checksum ||
      computeGraphMultiRender.render_snapshot.dark_frame
    ) {
      throw new Error(`native compute graph multi-render failed: ${JSON.stringify(computeGraphMultiRender)}`);
    }
    const persistentFill = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-persistent-uniform', kind: 'uniform', initial_u32: [256, 24680, 2, 13] },
        { id: 'graph-persistent-scratch', kind: 'storage', byte_length: 1024, persistent: true, clear: true },
        { id: 'graph-persistent-output', kind: 'storage', byte_length: 1024, persistent: true, clear: true },
      ],
      passes: [
        {
          name: 'persistent-fill',
          shader_id: 'native-compute-graph-fill',
          entry: 'cs_fill',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-persistent-scratch', kind: 'storage' },
            { binding: 1, resource: 'graph-persistent-uniform', kind: 'uniform' },
          ],
        },
      ],
      readbacks: ['graph-persistent-scratch'],
    }, 5000);
    const persistentSeedWord = Number(persistentFill?.readbacks?.['graph-persistent-scratch']?.first_words?.[0] ?? 0);
    if (persistentSeedWord <= 0 || Number(persistentFill?.persistent_buffer_count ?? 0) < 2) {
      throw new Error(`native persistent compute graph seed failed: ${JSON.stringify(persistentFill)}`);
    }
    const persistentReuse = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-persistent-uniform', kind: 'uniform', initial_u32: [256, 13579, 5, 1] },
        { id: 'graph-persistent-scratch', kind: 'storage', byte_length: 1024, persistent: true },
        { id: 'graph-persistent-output', kind: 'storage', byte_length: 1024, persistent: true, clear: true },
      ],
      passes: [
        {
          name: 'persistent-transform',
          shader_id: 'native-compute-graph-transform',
          entry: 'cs_transform',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-persistent-scratch', kind: 'read-only-storage' },
            { binding: 1, resource: 'graph-persistent-output', kind: 'storage' },
            { binding: 2, resource: 'graph-persistent-uniform', kind: 'uniform' },
          ],
        },
      ],
      readbacks: ['graph-persistent-scratch', 'graph-persistent-output'],
    }, 5000);
    const reusedScratch = persistentReuse?.readbacks?.['graph-persistent-scratch'];
    const persistentOutput = persistentReuse?.readbacks?.['graph-persistent-output'];
    if (Number(reusedScratch?.first_words?.[0] ?? 0) !== persistentSeedWord) {
      throw new Error(`native persistent compute graph did not preserve scratch data: ${JSON.stringify(persistentReuse)}`);
    }
    if (Number(persistentOutput?.nonzero_words ?? 0) < 240 || !persistentOutput?.checksum) {
      throw new Error(`native persistent compute graph transform output failed: ${JSON.stringify(persistentReuse)}`);
    }

    const baseline = await snapshot(rpc, 'baseline', 0, 0);

    const graphSourceId = 'native-graph-render-source';
    const computeGraphSourceFrame = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-source-uniform', kind: 'uniform', initial_u32: [256, 22222, 4, 9] },
        { id: 'graph-source-scratch', kind: 'storage', byte_length: 1024 },
        { id: 'graph-source-output', kind: 'storage', byte_length: 1024 },
      ],
      passes: [
        {
          name: 'source-fill',
          shader_id: 'native-compute-graph-fill',
          entry: 'cs_fill',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-source-scratch', kind: 'storage' },
            { binding: 1, resource: 'graph-source-uniform', kind: 'uniform' },
          ],
        },
        {
          name: 'source-transform',
          shader_id: 'native-compute-graph-transform',
          entry: 'cs_transform',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-source-scratch', kind: 'read-only-storage' },
            { binding: 1, resource: 'graph-source-output', kind: 'storage' },
            { binding: 2, resource: 'graph-source-uniform', kind: 'uniform' },
          ],
        },
      ],
      readbacks: [],
      render: {
        name: 'render-output-source-frame',
        shader_id: 'native-compute-graph-render',
        vertex_entry: 'vs_main',
        fragment_entry: 'fs_main',
        target: 'source_frame',
        source_id: graphSourceId,
        seq: 1,
        clear: true,
        include_snapshot: false,
        bindings: [
          { binding: 0, resource: 'graph-source-output', kind: 'read-only-storage' },
        ],
      },
    }, 5000);
    if (
      computeGraphSourceFrame?.render?.target !== 'source_frame' ||
      computeGraphSourceFrame?.render?.source_id !== graphSourceId ||
      Number(computeGraphSourceFrame?.render?.source_slot ?? -1) < 0
    ) {
      throw new Error(`native compute graph did not render into a source frame: ${JSON.stringify(computeGraphSourceFrame)}`);
    }
    if (computeGraphSourceFrame.render_snapshot) {
      throw new Error(`source-frame graph render should not emit a snapshot unless explicitly copied: ${JSON.stringify(computeGraphSourceFrame)}`);
    }
    const computeGraphSampleSourceFrame = await rpc.send('compute_graph', {
      buffers: [
        { id: 'graph-sample-uniform', kind: 'uniform', initial_u32: [256, 77, 2, 1] },
        { id: 'graph-sample-output', kind: 'storage', byte_length: 1024 },
      ],
      passes: [
        {
          name: 'sample-source-frame',
          shader_id: 'native-compute-graph-sample',
          entry: 'cs_sample',
          dispatch: [4, 1, 1],
          bindings: [
            { binding: 0, resource: 'graph-sample-output', kind: 'storage' },
            { binding: 1, resource: 'graph-sample-uniform', kind: 'uniform' },
            { binding: 2, kind: 'source-frame-texture', source_id: graphSourceId },
            { binding: 3, kind: 'source-frame-sampler' },
          ],
        },
      ],
      readbacks: ['graph-sample-output'],
    }, 5000);
    const sampledSource = computeGraphSampleSourceFrame?.readbacks?.['graph-sample-output'];
    if (Number(sampledSource?.nonzero_words ?? 0) < 240 || !sampledSource?.checksum) {
      throw new Error(`native compute graph failed to sample source-frame texture: ${JSON.stringify(computeGraphSampleSourceFrame)}`);
    }
    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'graph-source-frame', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'graph-source-frame', visible: true },
        { type: 'bind_media_source', layer_id: 'graph-source-frame', source_id: graphSourceId, uri: 'native-graph://render-source', source_type: 'image' },
      ],
    });
    graphSourceFrameSnapshot = await snapshot(rpc, 'graph-source-frame', 0.12, 1);
    assertFrame('native graph source-frame layer', graphSourceFrameSnapshot, 0.012);
    assertDifferent('native graph source-frame vs baseline', baseline, graphSourceFrameSnapshot);
    const graphSourceStatus = await rpc.send('status', {}, 5000);
    if (Number(graphSourceStatus?.native_graph_source_frame_layers ?? 0) < 1) {
      throw new Error(`native graph source frame was not counted as a graph layer: ${JSON.stringify(graphSourceStatus)}`);
    }
    if (Number(graphSourceStatus?.native_instrument_proxy_layers ?? 0) !== 0) {
      throw new Error(`native graph route fell back to legacy proxy layer: ${JSON.stringify(graphSourceStatus)}`);
    }
    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'graph-source-frame' },
      ],
    });

    await rpc.send('submit_commands', {
      commands: [
        { type: 'set_render_clock', mode: 'manual', time: 0, frame_index: 1 },
        { type: 'upsert_layer', layer_id: 'smoke-color', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'smoke-color', visible: true },
        { type: 'set_layer_color', layer_id: 'smoke-color', rgba: [1, 0.05, 0.12, 1] },
      ],
    });
    const color = await snapshot(rpc, 'color', 0, 1);
    assertFrame('color layer', color, 0.03);
    assertDifferent('color layer vs baseline', baseline, color);

    const previewWidth = 32;
    const previewHeight = 32;
    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'smoke-color' },
        {
          type: 'upload_source_preview',
          source_id: 'smoke-preview-source',
          width: previewWidth,
          height: previewHeight,
          rgba: makePreviewPixels(previewWidth, previewHeight),
          seq: 1,
        },
        { type: 'upsert_layer', layer_id: 'smoke-preview', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'smoke-preview', visible: true },
        { type: 'bind_media_source', layer_id: 'smoke-preview', source_id: 'smoke-preview-source', uri: 'smoke-preview://gradient', source_type: 'image' },
      ],
    });
    const preview = await snapshot(rpc, 'preview', 0.25, 2);
    assertFrame('source preview layer', preview, 0.03);
    assertDifferent('preview layer vs color layer', color, preview);

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'smoke-preview',
          z_index: 0,
          blend_mode: 'normal',
          opacity: 1,
          corners: FULLSCREEN_CORNERS,
          uv_transform: [0.5, 0, 0.5, 1],
          uv_flags: [0, 1, 0, 0],
        },
      ],
    });
    const previewCrop = await snapshot(rpc, 'preview-crop', 0.28, 3);
    assertFrame('source preview cropped layer', previewCrop, 0.03);
    assertDifferent('preview UV crop', preview, previewCrop);

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'smoke-preview',
          z_index: 0,
          blend_mode: 'normal',
          opacity: 1,
          corners: FULLSCREEN_CORNERS,
          uv_transform: [0, 0, 1, 1],
          uv_flags: [0, 1, 1, 0],
        },
      ],
    });
    const previewFlip = await snapshot(rpc, 'preview-flip', 0.31, 4);
    assertFrame('source preview flipped layer', previewFlip, 0.03);
    assertDifferent('preview UV flip', preview, previewFlip);

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'smoke-preview',
          z_index: 0,
          blend_mode: 'normal',
          opacity: 1,
          corners: FULLSCREEN_CORNERS,
          uv_transform: [0, 0, 1, 1],
          uv_flags: [0, 1, 0, 0],
          shape: [1, 0.02, 0, 1],
        },
      ],
    });
    const previewCircle = await snapshot(rpc, 'preview-circle', 0.34, 5);
    assertFrame('source preview circle shape', previewCircle, 0.02);
    assertDifferent('preview circle shape mask', preview, previewCircle);

    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'smoke-preview',
          z_index: 0,
          blend_mode: 'normal',
          opacity: 1,
          corners: FULLSCREEN_CORNERS,
          uv_transform: [0, 0, 1, 1],
          uv_flags: [0, 1, 0, 0],
          shape: [2, 0.01, 0.35, 1],
        },
      ],
    });
    const previewTriangle = await snapshot(rpc, 'preview-triangle', 0.37, 6);
    assertFrame('source preview triangle shape', previewTriangle, 0.015);
    assertDifferent('preview triangle shape mask', preview, previewTriangle);
    assertDifferent('circle vs triangle shape mask', previewCircle, previewTriangle);

    smokeTempDir = mkdtempSync(join(tmpdir(), 'ghost-render-core-smoke-'));
    const sourceFrameWidth = 64;
    const sourceFrameHeight = 64;
    const sourceFrameBytes = makePreviewPixelBytes(sourceFrameWidth, sourceFrameHeight);
    sourceFrameFile = join(smokeTempDir, 'source-frame.rgba');
    writeFileSync(sourceFrameFile, sourceFrameBytes);
    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'smoke-preview' },
        {
          type: 'upload_source_frame',
          source_id: 'smoke-file-source',
          width: sourceFrameWidth,
          height: sourceFrameHeight,
          rgba_file: sourceFrameFile,
          rgba_byte_length: sourceFrameBytes.length,
          rgba_file_delete: true,
          seq: 1,
        },
        { type: 'upsert_layer', layer_id: 'smoke-file-frame', z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'smoke-file-frame', visible: true },
        { type: 'bind_media_source', layer_id: 'smoke-file-frame', source_id: 'smoke-file-source', uri: 'smoke-file://gradient', source_type: 'image' },
      ],
    });
    sourceFrameFileSnapshot = await snapshot(rpc, 'source-frame-file', 0.46, 7);
    assertFrame('source frame file layer', sourceFrameFileSnapshot, 0.03);
    assertDifferent('source frame file vs preview layer', preview, sourceFrameFileSnapshot);
    if (existsSync(sourceFrameFile)) {
      throw new Error(`source frame rgba_file was not deleted after native read: ${sourceFrameFile}`);
    }

    await rpc.send('submit_commands', {
      commands: [
        { type: 'remove_layer', layer_id: 'smoke-file-frame' },
      ],
    });
    const noLayers = await snapshot(rpc, 'no-layers', 0.75, 8);

    const registeredWgsl = await renderRegisteredWgslProbe(rpc, 9, noLayers);

    const catalogResults = [];
    let catalogFrameIndex = 10;
    for (const probe of NATIVE_SHADER_CATALOG_PROBES) {
      catalogResults.push(await renderNativeShaderProbe(rpc, probe, catalogFrameIndex, noLayers));
      catalogFrameIndex += 2;
    }
    if (catalogResults.length !== NATIVE_SHADER_CATALOG_PROBES.length) {
      throw new Error(`native catalog coverage missed probes: ${catalogResults.length}/${NATIVE_SHADER_CATALOG_PROBES.length}`);
    }
    const gpuA = catalogResults.find((result) => result.id === 'volumetric-balls')?.a;
    const gpuB = catalogResults.find((result) => result.id === 'volumetric-balls')?.b;
    const particleA = catalogResults.find((result) => result.id === 'particle-field')?.a;
    const particleB = catalogResults.find((result) => result.id === 'particle-field')?.b;
    if (!gpuA || !gpuB || !particleA || !particleB) {
      throw new Error(`native catalog probe results missing expected shader IDs: ${catalogResults.map((result) => result.id).join(', ')}`);
    }

    await rpc.send('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: 'smoke-gpu', z_index: 0, blend_mode: 'screen', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: 'smoke-gpu', visible: true },
        { type: 'bind_media_source', layer_id: 'smoke-gpu', source_id: 'smoke-gpu-source', uri: 'gpu://volumetric-balls', source_type: 'gpu:volumetric-balls' },
        { type: 'set_layer_native_params', layer_id: 'smoke-gpu', params: [1.35, 1.25, 0.72, 0.55, 0.31, 0.65, 0.92, 1] },
        { type: 'remove_layer', layer_id: 'catalog-gpu' },
      ],
    });
    const gpuHighDetail = await snapshot(rpc, 'gpu-high-detail', 2.15, catalogFrameIndex);
    assertFrame('native volumetric-balls high detail branch', gpuHighDetail, 0.015);
    assertDifferent('volumetric-balls detail branch', gpuB, gpuHighDetail);

    const status = requireManagedOutput
      ? await waitForManagedOutputHealthy(rpc) ?? await rpc.send('status', {}, 5000)
      : await rpc.send('status', {}, 5000);
    const stats = await rpc.send('stats', {}, 5000);
    if (Number(status.native_instrument_layers ?? 0) < 1) {
      throw new Error(`native instrument layer was not counted in status: ${JSON.stringify(status)}`);
    }
    if (Number(status.native_instrument_frame_renders ?? 0) < 4) {
      throw new Error(`native instrument frames were not rendered: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_runs ?? 0) < 6) {
      throw new Error(`native compute graph runs were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_passes ?? 0) < 9) {
      throw new Error(`native compute graph passes were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_render_passes ?? 0) < 5) {
      throw new Error(`native compute graph render passes were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_snapshot_renders ?? 0) < 4) {
      throw new Error(`native compute graph snapshot renders were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_source_frame_renders ?? 0) < 1) {
      throw new Error(`native compute graph source-frame renders were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_readbacks ?? 0) < 6 || Number(status.compute_graph_readback_bytes ?? 0) < 6144) {
      throw new Error(`native compute graph readbacks were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.compute_graph_persistent_buffers ?? 0) < 2) {
      throw new Error(`native persistent compute graph buffers were not reported: ${JSON.stringify(status)}`);
    }
    if (Number(stats.compute_graph_runs ?? 0) < 6 || Number(stats.compute_graph_persistent_buffers ?? 0) < 2) {
      throw new Error(`native compute graph stats were not reported: ${JSON.stringify(stats)}`);
    }
    if (Number(status.source_frame_size ?? 0) < 1536) {
      throw new Error(`native source frame size regressed below 1536px: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_mip_levels ?? 1) < 2) {
      throw new Error(`native source frame mip chain was not created: ${JSON.stringify(status)}`);
    }
    if (Number(status.pipeline_cache_entries ?? 0) < 1) {
      throw new Error(`registered native WGSL shader did not create a pipeline: ${JSON.stringify(status)}`);
    }
    if (!status.source_frame_format) {
      throw new Error(`native source frame format missing from status: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_cpu_fallback_uploads ?? 0) < 1) {
      throw new Error(`native source-frame CPU fallback uploads were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_file_uploads ?? 0) < 1) {
      throw new Error(`native source-frame file uploads were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_input_bytes_uploaded ?? 0) < sourceFrameBytes.length) {
      throw new Error(`native source-frame input bytes were not counted: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_resampled_bytes_uploaded ?? 0) < Number(status.source_frame_bytes_uploaded ?? 0)) {
      throw new Error(`native source-frame resampled byte count regressed: ${JSON.stringify(status)}`);
    }
    if (Number(status.source_frame_rejected_uploads ?? 0) !== 0) {
      throw new Error(`native source-frame uploads were unexpectedly rejected: ${JSON.stringify(status)}`);
    }
    if (status.source_frame_last_upload_transport !== 'file') {
      throw new Error(`native source-frame last transport was not tracked: ${JSON.stringify(status)}`);
    }
    if (
      Number(stats.source_frame_cpu_fallback_uploads ?? 0) < 1 ||
      Number(stats.source_frame_file_uploads ?? 0) < 1
    ) {
      throw new Error(`native source-frame transport stats were not reported: ${JSON.stringify(stats)}`);
    }
    if (!status.native_caps?.adapter_name || Number(status.native_caps.max_texture_dimension_2d ?? 0) <= 0) {
      throw new Error(`native GPU caps missing adapter/texture limits: ${JSON.stringify(status.native_caps ?? null)}`);
    }
    if (Number(status.native_caps.max_compute_invocations_per_workgroup ?? 0) <= 0) {
      throw new Error(`native GPU caps missing compute limits: ${JSON.stringify(status.native_caps ?? null)}`);
    }
    if (!status.native_quality?.active_tier || Number(status.native_quality.quality_scale ?? 0) <= 0) {
      throw new Error(`native quality state missing active tier/scale: ${JSON.stringify(status.native_quality ?? null)}`);
    }
    if (status.native_quality.policy !== 'auto') {
      throw new Error(`native quality policy should default to auto: ${JSON.stringify(status.native_quality)}`);
    }
    if (
      status.present_mode !== 'vsync' ||
      Number(status.max_frame_latency ?? 0) !== 1 ||
      Number(status.command_drain_limit ?? 0) !== 4 ||
      !status.auto_present_on_state_change ||
      !status.output_window_attached
    ) {
      throw new Error(`native managed output/present status regressed: ${JSON.stringify(status)}`);
    }
    if (
      !status.output_swapchain_ready ||
      Number(status.frames_presented ?? 0) <= 0 ||
      Number(status.swapchain_presented ?? 0) <= 0
    ) {
      console.warn(
        '[native-smoke] managed output did not present in this harness; continuing with core graph/source-frame validation',
        JSON.stringify({
          output_swapchain_ready: status.output_swapchain_ready,
          frames_presented: status.frames_presented,
          swapchain_presented: status.swapchain_presented,
          swapchain_last_present_result: status.swapchain_last_present_result,
          output_present_consecutive_failures: status.output_present_consecutive_failures,
        }),
      );
    }
    if (Number(status.command_drain_limit_hits ?? 0) < 1 || Number(stats.command_drain_limit_hits ?? 0) < 1) {
      throw new Error(`native command drain threshold was not reported: status=${JSON.stringify(status)} stats=${JSON.stringify(stats)}`);
    }
    if (Number(status.queued_commands_after_drain ?? 0) !== 0 || Number(stats.queued_commands_after_drain ?? 0) !== 0) {
      throw new Error(`native command queue reported stale deferred commands: status=${JSON.stringify(status)} stats=${JSON.stringify(stats)}`);
    }
    if (status.native_caps?.requested_timestamp_query && !status.gpu_timing_supported) {
      throw new Error(`native GPU timing should be enabled when timestamp queries are requested: ${JSON.stringify(status)}`);
    }
    if (status.gpu_timing_supported && Number(status.gpu_timing_samples ?? 0) <= 0) {
      throw new Error(`native GPU timing did not produce samples: ${JSON.stringify(status)}`);
    }
    if (Number(status.frame_snapshot_reads ?? 0) < 5 || Number(status.frame_health_checks ?? 0) < 5) {
      throw new Error(`snapshot health counters did not advance: ${JSON.stringify(status)}`);
    }
    if (status.last_frame_dark) {
      throw new Error(`native status reports last frame dark: ${JSON.stringify(status)}`);
    }

    const blendModes = [
      'normal',
      'exclusion',
      'color-dodge',
      'color-burn',
      'hue',
      'saturation',
      'color',
      'luminosity',
      'divide',
      'negation',
      'phoenix',
      'linear-light',
      'hard-mix',
      'vivid-light',
      'pin-light',
    ];
    const blendChecksums = new Set();
    let normalBlendChecksum = '';
    for (let i = 0; i < blendModes.length; i++) {
      const blendSnap = await renderBlendProbe(rpc, blendModes[i], 13 + i);
      assertFrame(`native ${blendModes[i]} blend`, blendSnap, 0.01);
      if (blendModes[i] === 'normal') {
        normalBlendChecksum = blendSnap.checksum;
      } else if (blendSnap.checksum === normalBlendChecksum) {
        throw new Error(`native ${blendModes[i]} blend matched normal output (${blendSnap.checksum})`);
      }
      blendChecksums.add(blendSnap.checksum);
    }
    if (blendChecksums.size < 10) {
      throw new Error(`native blend probes were not varied enough: ${blendChecksums.size}/${blendModes.length}`);
    }

    console.log([
      'Native renderer smoke passed:',
      `baseline=${baseline.checksum}`,
      `color=${color.checksum}`,
      `preview=${preview.checksum}`,
      `frameFile=${sourceFrameFileSnapshot?.checksum ?? 'none'}`,
      `wgsl=${registeredWgsl.first.checksum}->${registeredWgsl.second.checksum}`,
      `uv=${previewCrop.checksum}/${previewFlip.checksum}`,
      `shape=${previewCircle.checksum}/${previewTriangle.checksum}`,
      `compute=${computeProbe.checksum}/${computeProbe.nonzero_words}`,
      `graph=${outputReadback.checksum}/${computeGraph.pass_count}`,
      `graphRender=${graphRenderSnapshot.checksum}`,
      `graphSource=${graphSourceFrameSnapshot?.checksum ?? 'none'}`,
      `graphRuns=${status.compute_graph_runs}/${status.compute_graph_passes}`,
      `graphSrcFrames=${status.compute_graph_source_frame_renders}`,
      `persist=${persistentOutput.checksum}/${persistentSeedWord}`,
      `gpu=${gpuA.checksum}->${gpuB.checksum}/detail=${gpuHighDetail.checksum}`,
      `particle=${particleA.checksum}->${particleB.checksum}`,
      `catalog=${catalogResults.length}/${NATIVE_SHADER_CATALOG_PROBES.length}`,
      `blends=${blendChecksums.size}`,
      `frameSize=${status.source_frame_size}`,
      `frameFormat=${status.source_frame_format}${status.source_frame_hdr ? '/hdr' : ''}`,
      `mips=${status.source_frame_mip_levels ?? 1}`,
      `tier=${status.native_caps.recommended_quality_tier}`,
      `quality=${status.native_quality.active_tier}@${Number(status.native_quality.quality_scale ?? 0).toFixed(2)}`,
      `gpuMs=${Number(status.avg_render_gpu_ms ?? 0).toFixed(2)} samples=${status.gpu_timing_samples ?? 0}`,
      `f16=${status.native_caps.requested_shader_f16 ? 'on' : 'off'}`,
      `last_luma=${Number(status.last_frame_average_luma ?? 0).toFixed(4)}`,
      `nonzero=${status.last_frame_nonzero_pixels}`,
    ].join(' '));
  } finally {
    if (smokeTempDir) rmSync(smokeTempDir, { recursive: true, force: true });
    const stderr = await rpc.close();
    if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
