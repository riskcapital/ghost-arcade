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
  let beat = u.audio1.x;
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
  let color = mix(procedural + glow, media.rgb, 0.42);
  return vec4<f32>(color, 1.0);
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
        audio_bass: 0.42,
        audio_beat: 0.72,
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
        audio_bass: 0.18,
        audio_beat: 0.05,
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
  const rpc = createRpcProcess();
  let smokeTempDir = null;
  let sourceFrameFile = null;
  let sourceFrameFileSnapshot = null;
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

    const baseline = await snapshot(rpc, 'baseline', 0, 0);

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

    const status = await rpc.send('status', {}, 5000);
    if (Number(status.native_instrument_layers ?? 0) < 1) {
      throw new Error(`native instrument layer was not counted in status: ${JSON.stringify(status)}`);
    }
    if (Number(status.native_instrument_frame_renders ?? 0) < 4) {
      throw new Error(`native instrument frames were not rendered: ${JSON.stringify(status)}`);
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
