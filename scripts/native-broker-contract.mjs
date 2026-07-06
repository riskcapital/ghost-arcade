import { createNativeRendererBroker } from '../electron/native-renderer-broker.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const REQUIRED_CHECKS = [
  'compute-instrument-host',
  'native-planet-graph',
  'native-3d-smoke-graph',
  'native-particle-field-graph',
  'native-volumetric-spheres-graph',
  'native-smoke-riders-graph',
  'native-ink-cloud-graph',
  'native-flythrough-graph',
  'native-pixel-particles-graph',
  'native-point-cloud-fx-graph',
  'native-stage3d-overlay-preview',
  'native-stage3d-mesh-preview',
  'native-stage3d-textured-mesh-preview',
  'native-stage3d-primitive-meshes',
  'native-stage3d-xyz-mesh-transforms',
  'native-stage3d-lighting-preview',
  'native-projection-sim-overlay-preview',
  'native-projection-sim-mesh-preview',
  'native-projection-sim-textured-mesh-preview',
  'native-projection-sim-xyz-mesh-transforms',
  'native-frame-export',
  'native-frame-sequence-export',
  'native-video-frame-prefetch',
  'native-video-decode-pump',
];

const REQUIRED_GRAPH_MANIFEST = [
  { id: 'planet', feature: 'native_planet_graph', shaderIds: ['planet/render'] },
  {
    id: 'smoke-3d',
    feature: 'native_3d_smoke_graph',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
    ],
  },
  {
    id: 'particle-field',
    feature: 'native_particle_field_graph',
    shaderIds: [
      'particle-field/behavior',
      'particle-field/edges',
      'particle-field/fog',
      'particle-field/render',
      'particle-field/lines',
    ],
  },
  {
    id: 'volumetric-spheres',
    feature: 'native_volumetric_spheres_graph',
    shaderIds: ['volumetric-spheres/sim', 'volumetric-spheres/render'],
  },
  {
    id: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
      'volumetric-spheres/sim',
      'volumetric-spheres/render',
    ],
  },
  {
    id: 'ink-cloud',
    feature: 'native_ink_cloud_graph',
    shaderIds: ['ink-cloud/sim', 'ink-cloud/render', 'ink-cloud/background'],
  },
  { id: 'flythrough', feature: 'native_flythrough_graph', shaderIds: ['flythrough/compute', 'flythrough/render'] },
  {
    id: 'pixel-particles',
    feature: 'native_pixel_particles_graph',
    shaderIds: ['pixel-particles/compute', 'pixel-particles/render'],
  },
  {
    id: 'point-cloud-fx',
    feature: 'native_point_cloud_fx_graph',
    shaderIds: [
      'point-cloud-fx/compute',
      'point-cloud-fx/sort-fill',
      'point-cloud-fx/sort-step',
      'point-cloud-fx/render',
    ],
  },
];

const BROKER_DIRECT_CORE_METHODS = [
  'frame_snapshot',
  'export_frame_snapshot',
  'output_shared_texture',
  'set_stage3d_scene',
  'get_stage3d_scene_summary',
  'set_projection_sim_scene',
  'get_projection_sim_scene_summary',
  'reset_stats',
  'submit_batch',
  'submit_commands',
  'compute_graph',
  'set_target_fps',
  'set_present_policy',
  'set_command_drain_policy',
  'set_auto_present_policy',
  'attach_output_window',
  'detach_output_window',
  'set_output_window',
];

function readNativeEffectPassManifest() {
  const source = readFileSync(join(process.cwd(), 'src/lib/renderer/nativeEffectPass.ts'), 'utf8');
  const entries = [];
  const pattern = /\{\s*id:\s*'([^']+)'\s*,\s*code:\s*(\d+)/g;
  let match = pattern.exec(source);
  while (match) {
    entries.push({ id: match[1], code: Number(match[2]) });
    match = pattern.exec(source);
  }
  assert(entries.length > 0, 'could not parse NATIVE_EFFECT_PASS_MANIFEST from nativeEffectPass.ts');
  return entries;
}

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

function makeTinyBmpBytes() {
  const width = 2;
  const height = 2;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const bytes = Buffer.alloc(54 + pixelBytes);
  bytes.write('BM', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(pixelBytes, 34);
  const pixels = [
    [255, 48, 24],
    [32, 210, 255],
    [140, 255, 48],
    [255, 220, 32],
  ];
  for (let y = 0; y < height; y += 1) {
    const dstY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x];
      const dst = 54 + dstY * rowStride + x * 3;
      bytes[dst] = b;
      bytes[dst + 1] = g;
      bytes[dst + 2] = r;
    }
  }
  return bytes;
}

function makeSolidRgbaFrame(width, height, rgba) {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = rgba[0];
    bytes[i + 1] = rgba[1];
    bytes[i + 2] = rgba[2];
    bytes[i + 3] = rgba[3];
  }
  return bytes;
}

function resolveFfmpegBin() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string' && ffmpegStatic.length > 0) return ffmpegStatic;
  } catch {
    // Fall through to PATH lookup.
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function writeTinyTestVideo(filePath) {
  const ffmpegBin = resolveFfmpegBin();
  const result = spawnSync(ffmpegBin, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=48x32:d=0.2',
    '-frames:v',
    '1',
    '-pix_fmt',
    'yuv420p',
    filePath,
  ], { encoding: 'utf8' });
  assert(
    !result.error && result.status === 0,
    `could not create tiny video fixture with ffmpeg: ${result.error?.message || result.stderr || result.status}`,
  );
}

function writeTwoColorTestVideo(filePath) {
  const ffmpegBin = resolveFfmpegBin();
  const result = spawnSync(ffmpegBin, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=48x32:d=0.6',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=48x32:d=0.6',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p',
    '-t',
    '1.2',
    filePath,
  ], { encoding: 'utf8' });
  assert(
    !result.error && result.status === 0,
    `could not create two-color video fixture with ffmpeg: ${result.error?.message || result.stderr || result.status}`,
  );
}

const BYTE_BUFFER_COMPUTE_SOURCE = `
struct Seeds {
  a: u32,
  b: u32,
  c: u32,
  d: u32,
}

@group(0) @binding(0)
var<uniform> seeds: Seeds;

@group(0) @binding(1)
var<storage, read_write> output_words: array<u32>;

@compute @workgroup_size(4)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= 4u) { return; }
  var v = seeds.a;
  if (i == 1u) {
    v = seeds.b;
  } else if (i == 2u) {
    v = seeds.c;
  } else if (i == 3u) {
    v = seeds.d;
  }
  output_words[i] = v + 100u + i;
}
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForManagedOutputPresent(broker) {
  let latest = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await broker.invoke('native_renderer_submit_commands', {
      commands: [{ type: 'present' }],
    });
    await sleep(50);
    latest = await broker.invoke('native_renderer_get_status');
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

const broker = createNativeRendererBroker({
  appRoot: process.cwd(),
  resourcesPath: null,
  isPackaged: false,
  platform: process.platform,
  env: process.env,
  textureShareStatusProvider: () => ({
    platform: process.platform === 'darwin' ? 'syphon' : 'spout',
    label: process.platform === 'darwin' ? 'Syphon' : 'Spout',
    available: process.platform === 'darwin',
    error: process.platform === 'darwin' ? null : 'contract test uses source-frame fallback',
    nativeOutputCapable: process.platform === 'darwin',
    nativeOutputActive: false,
    senderMode: process.platform === 'darwin' ? 'native-iosurface-capable' : 'source-frame-fallback',
  }),
  nativeFrameEncoderStatusProvider: () => ({
    available: true,
    activeSessions: 0,
    jpegActiveSessions: 0,
    mp4ActiveSessions: 0,
    encoder: 'ffmpeg',
  }),
});

const activeTextureShareReadinessProbe = createNativeRendererBroker({
  appRoot: process.cwd(),
  resourcesPath: null,
  isPackaged: false,
  platform: process.platform,
  env: process.env,
  textureShareStatusProvider: () => ({
    platform: process.platform === 'darwin' ? 'syphon' : 'spout',
    label: process.platform === 'darwin' ? 'Syphon' : 'Spout',
    available: true,
    nativeOutputCapable: true,
    nativeOutputActive: true,
    nativeOutputWaitingForFrame: false,
    senderMode: 'native-output-active-contract',
  }),
});
activeTextureShareReadinessProbe.capabilities = {
  ...activeTextureShareReadinessProbe.capabilities,
  features: {
    ...(activeTextureShareReadinessProbe.capabilities?.features ?? {}),
    shared_texture_output_export: true,
  },
};
const activeTextureShareReadiness = activeTextureShareReadinessProbe.readinessReport();
assert(
  activeTextureShareReadiness?.modes?.output_active?.ok === true,
  `active native texture-share sender should mark output_active ready: ${JSON.stringify(activeTextureShareReadiness?.modes)}`,
);
assert(
  /actively publishing/.test(String(activeTextureShareReadiness?.modes?.output_active?.detail ?? '')),
  `active native texture-share sender should explain output_active source: ${JSON.stringify(activeTextureShareReadiness?.modes)}`,
);

let tempDir = null;

try {
  const status = await broker.invoke('native_renderer_start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: 320,
      height: 180,
      target_fps: 30,
    },
  });
  assert(status?.backend_ready, `broker failed to start native core: ${JSON.stringify(status)}`);

  const outputStatus = await waitForManagedOutputPresent(broker);
  assert(
    Number(outputStatus.commands_dropped ?? 0) === 0,
    `explicit present command should not be dropped by native core: ${JSON.stringify(outputStatus)}`,
  );
  assert(
    /(?:bgra|rgba)/i.test(String(outputStatus.output_format ?? '')),
    `broker status missing native output raw pixel format: ${JSON.stringify(outputStatus)}`,
  );

  const capabilities = await broker.invoke('native_renderer_get_capabilities');
  const outputExportExpected = process.platform === 'darwin';
  assert(
    capabilities?.core_capabilities_confirmed === true,
    `broker capabilities should be core-confirmed, not fallback: ${JSON.stringify(capabilities)}`,
  );
  assert(
    capabilities?.implemented_methods?.includes('get_capabilities'),
    `broker capabilities missing get_capabilities RPC: ${JSON.stringify(capabilities?.implemented_methods)}`,
  );
  for (const method of BROKER_DIRECT_CORE_METHODS) {
    assert(
      capabilities?.implemented_methods?.includes(method),
      `broker explicit core RPC path is not capability-backed: ${method} missing from ${JSON.stringify(capabilities?.implemented_methods)}`,
    );
  }
  let unknownRpcError = null;
  try {
    await broker.send('ghost_arcade_contract_missing_rpc', {}, { timeoutMs: 1000 });
  } catch (err) {
    unknownRpcError = err;
  }
  assert(
    /unsupported native render-core RPC method/.test(String(unknownRpcError?.message || unknownRpcError || '')),
    `native core unknown RPC should error loudly, not return success: ${unknownRpcError}`,
  );
  let unknownBrokerError = null;
  try {
    await broker.invoke('native_renderer_contract_missing_command');
  } catch (err) {
    unknownBrokerError = err;
  }
  assert(
    /does not advertise RPC method/.test(String(unknownBrokerError?.message || unknownBrokerError || '')),
    `broker unknown command should reject before silent fallback: ${unknownBrokerError}`,
  );
  assert(capabilities?.features?.compute_graph_source_frame_target, 'broker capabilities lost compute graph source-frame support');
  assert(capabilities?.features?.runtime_cache_clear, 'broker capabilities lost runtime cache clearing support');
  assert(capabilities?.features?.native_graph_buffer_prune, 'broker capabilities lost native graph buffer prune support');
  assert(capabilities?.features?.native_static_image_decode, 'broker capabilities lost native still-image decode support');
  assert(capabilities?.features?.native_static_image_prefetch, 'broker capabilities lost native still-image prefetch support');
  assert(capabilities?.features?.native_compositor_manifest, 'broker capabilities lost native compositor manifest support');
  assert(capabilities?.features?.native_effect_pass_manifest, 'broker capabilities lost native effect-pass manifest support');
  assert(
      capabilities?.features?.native_stage3d_scene_ingest &&
      capabilities?.features?.native_stage3d_overlay_preview &&
      capabilities?.features?.native_stage3d_mesh_preview &&
      capabilities?.features?.native_stage3d_textured_mesh_preview &&
      capabilities?.features?.native_stage3d_primitive_meshes &&
      capabilities?.features?.native_stage3d_xyz_mesh_transforms &&
      capabilities?.features?.native_stage3d_lighting_preview &&
      capabilities?.features?.native_stage3d_output_renderer &&
      capabilities?.features?.native_projection_sim_scene_ingest &&
      capabilities?.features?.native_projection_sim_overlay_preview &&
      capabilities?.features?.native_projection_sim_mesh_preview &&
      capabilities?.features?.native_projection_sim_textured_mesh_preview &&
      capabilities?.features?.native_projection_sim_xyz_mesh_transforms &&
      capabilities?.features?.native_projection_sim_output_renderer &&
      capabilities?.features?.native_stage3d &&
      capabilities?.features?.native_projection_sim,
    `broker scene bridge should advertise native Stage3D/Projection output rendering: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    capabilities?.features?.native_stage3d_recording_parity === true &&
      capabilities?.features?.native_projection_sim_recording_parity === true,
    `broker should advertise Stage3D/Projection recording parity only after native scene snapshots are covered by pixel tests: ${JSON.stringify(capabilities?.features)}`,
  );
  const compositorBlendModes = new Map(
    (capabilities?.native_compositor_blend_modes ?? []).map((entry) => [entry.id, Number(entry.code)]),
  );
  const requiredEffectPassManifest = readNativeEffectPassManifest();
  const effectPassManifest = new Map(
    (capabilities?.native_effect_pass_descriptors ?? []).map((entry) => [entry.id, Number(entry.code)]),
  );
  assert(
    effectPassManifest.size === requiredEffectPassManifest.length,
    `broker native effect-pass manifest has drifted: ${JSON.stringify(capabilities?.native_effect_pass_descriptors)}`,
  );
  for (const entry of requiredEffectPassManifest) {
    assert(
      effectPassManifest.get(entry.id) === entry.code,
      `broker native effect-pass descriptor mismatch for ${entry.id}: ${JSON.stringify(capabilities?.native_effect_pass_descriptors)}`,
    );
  }
  const compositorEffects = new Map(
    (capabilities?.native_compositor_effect_descriptors ?? []).map((entry) => [entry.id, Number(entry.code)]),
  );
  assert(
    compositorBlendModes.get('normal') === 0 &&
      compositorBlendModes.get('screen') === 3 &&
      compositorBlendModes.get('pin-light') === 25,
    `broker compositor blend manifest drifted: ${JSON.stringify(capabilities?.native_compositor_blend_modes)}`,
  );
  assert(
    compositorEffects.get('invert') === 1 &&
      compositorEffects.get('posterize') === 8 &&
      compositorEffects.get('noise') === 9,
    `broker compositor effect manifest drifted: ${JSON.stringify(capabilities?.native_compositor_effect_descriptors)}`,
  );
  assert(
    capabilities?.features?.native_instrument_proxies === false,
    `legacy native instrument proxy feature should stay disabled: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    capabilities?.implemented_command_types?.includes('decode_media_source'),
    `broker capabilities missing decode_media_source command: ${JSON.stringify(capabilities?.implemented_command_types)}`,
  );
  assert(
    capabilities?.implemented_command_types?.includes('upload_source_gpu_shared_texture'),
    `broker capabilities missing explicit shared-texture upload command: ${JSON.stringify(capabilities?.implemented_command_types)}`,
  );
  assert(
    capabilities?.implemented_methods?.includes('set_stage3d_scene') &&
      capabilities?.implemented_methods?.includes('get_stage3d_scene_summary') &&
      capabilities?.implemented_methods?.includes('set_projection_sim_scene') &&
      capabilities?.implemented_methods?.includes('get_projection_sim_scene_summary') &&
      capabilities?.implemented_command_types?.includes('set_stage3d_scene') &&
      capabilities?.implemented_command_types?.includes('set_projection_sim_scene'),
    `broker capabilities missing native scene-ingest bridge: ${JSON.stringify(capabilities)}`,
  );
  assert(
    capabilities?.implemented_methods?.includes('clear_runtime_caches'),
    `broker implemented methods lost clear_runtime_caches: ${JSON.stringify(capabilities?.implemented_methods)}`,
  );
  const policyMethods = [
    'clear_decode_preview_cache',
    'set_vram_budget',
    'set_decode_cpu_backup_policy',
    'set_decode_synthetic_fallback_policy',
    'set_media_prefetch_policy',
    'set_media_drop_policy',
    'set_decode_preview_policy',
    'set_decode_target_policy',
    'set_decode_upload_policy',
    'set_decode_handoff_policy',
    'set_decode_estimate_cache_policy',
  ];
  for (const method of [
    'prefetch_media',
    'clear_prefetch_cache',
    'get_decode_capabilities',
    ...policyMethods,
  ]) {
    assert(
      capabilities?.implemented_methods?.includes(method),
      `broker implemented methods lost ${method}: ${JSON.stringify(capabilities?.implemented_methods)}`,
    );
  }
  for (const commandType of policyMethods.filter((method) => method !== 'clear_decode_preview_cache')) {
    assert(
      capabilities?.implemented_command_types?.includes(commandType),
      `broker command types lost ${commandType}: ${JSON.stringify(capabilities?.implemented_command_types)}`,
    );
  }
  const decodeCapabilities = await broker.invoke('native_renderer_get_decode_capabilities');
  assert(
    decodeCapabilities?.native_static_image_decode &&
      decodeCapabilities?.native_static_image_prefetch &&
      decodeCapabilities?.decode_policy_controls &&
      decodeCapabilities?.decode_preview_cache_clear &&
      decodeCapabilities?.media_policy_controls &&
      decodeCapabilities?.vram_budget_policy &&
      decodeCapabilities?.vram_budget_enforcement === true &&
      decodeCapabilities?.native_media_decode === true &&
      decodeCapabilities?.media_prefetch === true &&
      decodeCapabilities?.video_decode === true &&
      decodeCapabilities?.native_video_frame_decode === true &&
      decodeCapabilities?.native_video_frame_prefetch === true &&
      decodeCapabilities?.native_video_frame_prefetch_window === true &&
      decodeCapabilities?.native_video_decode_pump === true &&
      decodeCapabilities?.native_video_decode_pump_window === true &&
      decodeCapabilities?.native_media_source_playback_state === true &&
      decodeCapabilities?.video_frame_prefetch === true &&
      decodeCapabilities?.supported_source_types?.includes('image') &&
      decodeCapabilities?.supported_source_types?.includes('video'),
    `broker decode capabilities should report native still-image decode plus render-clock video decode/prefetch: ${JSON.stringify(decodeCapabilities)}`,
  );
  await broker.invoke('native_renderer_set_decode_cpu_backup_policy', {
    config: { decode_store_cpu_backup_frames: true },
  });
  await broker.invoke('native_renderer_set_decode_synthetic_fallback_policy', {
    config: { decode_allow_synthetic_fallback: true },
  });
  await broker.invoke('native_renderer_set_media_prefetch_policy', {
    config: {
      media_queue_capacity: 3333,
      decode_handoff_queue_capacity: 4444,
      media_high_burst_limit: 11,
      prefetch_cache_max_entries: 5555,
      prefetch_cache_prune_count: 333,
    },
  });
  await broker.invoke('native_renderer_set_media_drop_policy', {
    config: {
      command_pressure_pct: 88,
      decode_queue_pressure_pct: 77,
      io_queue_pressure_pct: 66,
      decode_priority_cutoff: 111,
      io_priority_cutoff: 99,
    },
  });
  await broker.invoke('native_renderer_set_decode_preview_policy', {
    config: { decode_preview_size: 144, decode_preview_cache_mb: 192 },
  });
  await broker.invoke('native_renderer_set_decode_target_policy', {
    config: { decode_use_output_resolution: false },
  });
  await broker.invoke('native_renderer_set_decode_upload_policy', {
    config: { decode_upload_queue_cap_mb: 384 },
  });
  await broker.invoke('native_renderer_set_decode_handoff_policy', {
    config: { decode_handoff_byte_cap_mb: 320, decode_handoff_predecode_shed_pct: 82 },
  });
  await broker.invoke('native_renderer_set_decode_estimate_cache_policy', {
    config: { decode_predecode_estimate_cache_cap_entries: 12345 },
  });
  await broker.invoke('native_renderer_set_vram_budget', { vram_budget_mb: 6144 });
  const clearDecodePreview = await broker.invoke('native_renderer_clear_decode_preview_cache');
  assert(
    Number(clearDecodePreview?.cleared_decode_preview_entries ?? -1) === 0,
    `decode preview clear should acknowledge empty native cache: ${JSON.stringify(clearDecodePreview)}`,
  );
  const policyStatus = await broker.invoke('native_renderer_get_status');
  const expectedDecodeBackend = process.platform === 'win32' ? 'ffmpeg_d3d11va' : 'ffmpeg_software';
  assert(
    policyStatus.decode_store_cpu_backup_frames === true &&
      policyStatus.decode_allow_synthetic_fallback === true &&
      policyStatus.decode_backend === expectedDecodeBackend &&
      Number(policyStatus.media_queue_capacity) === 3333 &&
      Number(policyStatus.decode_handoff_queue_capacity) === 4444 &&
      Number(policyStatus.media_high_burst_limit) === 11 &&
      Number(policyStatus.prefetch_cache_max_entries) === 5555 &&
      Number(policyStatus.prefetch_cache_prune_count) === 333 &&
      Number(policyStatus.media_drop_command_pressure_pct) === 88 &&
      Number(policyStatus.media_drop_decode_pressure_pct) === 77 &&
      Number(policyStatus.media_drop_io_pressure_pct) === 66 &&
      Number(policyStatus.media_drop_decode_priority_cutoff) === 111 &&
      Number(policyStatus.media_drop_io_priority_cutoff) === 99 &&
      Number(policyStatus.decode_preview_size) === 144 &&
      Number(policyStatus.decode_preview_cache_mb) === 192 &&
      policyStatus.decode_use_output_resolution === false &&
      Number(policyStatus.decode_upload_queue_cap_mb) === 384 &&
      Number(policyStatus.decode_handoff_byte_cap_mb) === 320 &&
      Number(policyStatus.decode_handoff_predecode_shed_pct) === 82 &&
      Number(policyStatus.decode_predecode_estimate_cache_cap_entries) === 12345 &&
      Number(policyStatus.vram_budget_mb) === 6144 &&
      Number(policyStatus.native_graph_buffer_budget_bytes) > 0 &&
      Number(policyStatus.native_graph_buffer_bytes) >= 0 &&
      Number(policyStatus.vram_evictions) >= 0 &&
      Number(policyStatus.vram_evicted_bytes) >= 0,
    `native policy setters did not round-trip through status or preserve the platform decode backend: ${JSON.stringify(policyStatus)}`,
  );
  assert(capabilities?.features?.native_output_mirror_texture, 'broker capabilities lost native output mirror support');
  assert(
    !!capabilities?.features?.shared_texture_source_frame_upload === (process.platform === 'darwin'),
    `broker shared source-frame capability should match macOS IOSurface support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    !!capabilities?.features?.shared_texture_output_export === outputExportExpected,
    `broker output shared-texture export capability should match macOS IOSurface support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    !!capabilities?.features?.shared_texture_upload === outputExportExpected,
    `broker shared-texture media transport capability should match macOS IOSurface support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    !!capabilities?.features?.native_texture_share_sender === outputExportExpected,
    `broker native texture-share sender capability should match app bridge support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    capabilities?.implemented_methods?.includes('upload_source_gpu_shared_texture'),
    `broker capabilities missing direct shared texture source-frame RPC: ${JSON.stringify(capabilities?.implemented_methods)}`,
  );
  assert(
    capabilities?.features?.frame_snapshot_export &&
      capabilities?.features?.native_frame_export &&
      capabilities?.features?.native_frame_sequence_export &&
      capabilities?.features?.native_mp4_frame_encoder &&
      capabilities?.features?.native_recording &&
      capabilities?.implemented_methods?.includes('export_frame_snapshot'),
    `broker capabilities missing native frame export RPC: ${JSON.stringify(capabilities?.implemented_methods)}`,
  );
  assert(
    !capabilities?.features?.native_recording ||
      (
        capabilities?.features?.frame_snapshot_export &&
        capabilities?.features?.native_frame_export &&
        capabilities?.features?.native_frame_sequence_export &&
        capabilities?.implemented_methods?.includes('export_frame_snapshot')
      ),
    `broker must not advertise native recording without native frame export: ${JSON.stringify(capabilities?.features)}`,
  );
  const graphInstruments = new Set(capabilities?.native_graph_instruments ?? []);
  const graphManifest = new Map(
    (capabilities?.native_graph_instrument_manifest ?? []).map((entry) => [entry.id, entry]),
  );
  assert(
    graphInstruments.size === REQUIRED_GRAPH_MANIFEST.length,
    `broker graph instrument list has drifted: ${JSON.stringify(capabilities?.native_graph_instruments)}`,
  );
  assert(
    capabilities?.features?.multi_pass_instruments === true &&
      capabilities?.features?.native_instrument_proxies === false,
    `broker graph capability flags should report real native graph instruments, not legacy proxies: ${JSON.stringify(capabilities?.features)}`,
  );
  for (const required of REQUIRED_GRAPH_MANIFEST) {
    assert(graphInstruments.has(required.id), `broker graph instruments missing ${required.id}: ${JSON.stringify(capabilities)}`);
    assert(capabilities?.features?.[required.feature], `broker capabilities missing ${required.feature}: ${JSON.stringify(capabilities?.features)}`);
    const entry = graphManifest.get(required.id);
    assert(entry, `broker graph manifest missing ${required.id}: ${JSON.stringify(capabilities?.native_graph_instrument_manifest)}`);
    assert(entry.render_target === 'source_frame', `broker graph ${required.id} lost source-frame target: ${JSON.stringify(entry)}`);
    assert(entry.source_uri_prefix === `native-graph://${required.id}/`, `broker graph ${required.id} URI prefix drifted: ${JSON.stringify(entry)}`);
    for (const shaderId of required.shaderIds) {
      assert(entry.shader_ids?.includes(shaderId), `broker graph ${required.id} missing shader ${shaderId}: ${JSON.stringify(entry)}`);
    }
    assert(Array.isArray(entry.features) && entry.features.includes(required.feature), `broker graph ${required.id} manifest missing ${required.feature}: ${JSON.stringify(entry)}`);
    assert(String(entry.parity ?? '').length > 0, `broker graph ${required.id} missing parity metadata: ${JSON.stringify(entry)}`);
  }

  const stage3dSummary = await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      id: 'contract-stage',
      name: 'Contract Stage',
      schemaVersion: 1,
      nodes: [
        { id: 'screen-1', type: 'led-screen', children: [] },
        {
          id: 'group-1',
          type: 'group',
          children: [
            { id: 'spot-1', type: 'spot-light' },
            { id: 'fog-1', type: 'fog-volume' },
          ],
        },
        { id: 'truss-1', type: 'truss' },
        { id: 'model-1', type: 'imported-glb' },
      ],
      userElements: [{ id: 'user-box', type: 'box' }],
      sceneryOverrides: { deck: { position: [0, 0, 0] } },
    },
  });
  assert(
    stage3dSummary?.scene_kind === 'stage3d' &&
      stage3dSummary?.screen_count === 1 &&
      stage3dSummary?.light_count === 1 &&
      stage3dSummary?.fog_volume_count === 1 &&
      stage3dSummary?.truss_count === 1 &&
      stage3dSummary?.model_count === 1 &&
      stage3dSummary?.user_element_count === 1 &&
      stage3dSummary?.scenery_override_count === 1,
    `native Stage3D scene summary did not round-trip: ${JSON.stringify(stage3dSummary)}`,
  );
  const storedStage3dSummary = await broker.invoke('native_renderer_get_stage3d_scene_summary');
  assert(
    storedStage3dSummary?.scene_id === 'contract-stage' &&
      storedStage3dSummary?.payload_bytes === stage3dSummary.payload_bytes,
    `native Stage3D stored summary drifted: ${JSON.stringify(storedStage3dSummary)}`,
  );

  tempDir = tempDir || mkdtempSync(join(tmpdir(), 'ghost-native-broker-frame-'));
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      id: 'contract-stage-empty',
      name: 'Contract Stage Empty',
      schemaVersion: 1,
      nodes: [],
      userElements: [],
    },
  });
  const stageEmptyPath = join(tempDir, 'broker-stage3d-empty.rgba');
  const stageEmptySnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageEmptyPath,
    time: 0.125,
    frame_index: 9,
  });
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      id: 'contract-stage-overlay',
      name: 'Contract Stage Overlay',
      schemaVersion: 1,
      nodes: [
        {
          id: 'native-overlay-screen',
          type: 'led-screen',
          visible: true,
          position: [0, 2.4, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          width: 12,
          height: 5,
          brightness: 1.25,
          children: [],
        },
      ],
      userElements: [],
    },
  });
  const stageOverlayPath = join(tempDir, 'broker-stage3d-overlay.rgba');
  const stageOverlaySnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageOverlayPath,
    time: 0.125,
    frame_index: 9,
  });
  assert(
    stageEmptySnapshot?.checksum !== stageOverlaySnapshot?.checksum &&
      Number(stageOverlaySnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0) &&
      Number(stageOverlaySnapshot?.average_luma ?? 0) > Number(stageEmptySnapshot?.average_luma ?? 0),
    `native Stage3D overlay preview did not affect exported frame pixels: ${JSON.stringify({ stageEmptySnapshot, stageOverlaySnapshot })}`,
  );
  const meshSceneBase = {
    id: 'contract-stage-mesh',
    name: 'Contract Stage Mesh',
    schemaVersion: 1,
    nodes: [
      {
        id: 'native-mesh-box',
        type: 'primitive',
        visible: true,
        position: [0, 2.4, 0],
        rotation: [0, 0.35, 0],
        scale: [1, 1, 1],
        dimensions: [5, 3.2, 2.4],
        material: {
          color: '#c8a9ff',
          emissive: '#7bdcff',
          emissiveIntensity: 1.4,
        },
        children: [],
      },
    ],
    userElements: [],
  };
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshSceneBase,
      camera: { position: [0, 3.1, 12], target: [0, 2.2, 0], fov: 42 },
    },
  });
  const stageMeshFrontPath = join(tempDir, 'broker-stage3d-mesh-front.rgba');
  const stageMeshFrontSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshFrontPath,
    time: 0.2,
    frame_index: 10,
  });
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshSceneBase,
      camera: { position: [8, 3.1, 8], target: [0, 2.2, 0], fov: 42 },
    },
  });
  const stageMeshAnglePath = join(tempDir, 'broker-stage3d-mesh-angle.rgba');
  const stageMeshAngleSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshAnglePath,
    time: 0.2,
    frame_index: 10,
  });
  assert(
    stageMeshFrontSnapshot?.checksum !== stageMeshAngleSnapshot?.checksum &&
      Number(stageMeshFrontSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0) &&
      Number(stageMeshAngleSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0),
    `native Stage3D mesh preview did not respond to camera/depth rendering: ${JSON.stringify({ stageMeshFrontSnapshot, stageMeshAngleSnapshot })}`,
  );
  const meshRotationSceneBase = {
    id: 'contract-stage-mesh-rotation',
    name: 'Contract Stage Mesh Rotation',
    schemaVersion: 1,
    camera: { position: [0, 3.1, 12], target: [0, 2.2, 0], fov: 42 },
    nodes: [
      {
        id: 'native-mesh-xyz-rotation',
        type: 'primitive',
        visible: true,
        position: [0, 2.4, 0],
        scale: [1, 1, 1],
        dimensions: [6.4, 1.8, 1.1],
        material: {
          color: '#f4d37e',
          emissive: '#ff7aa8',
          emissiveIntensity: 1.2,
        },
        children: [],
      },
    ],
    userElements: [],
  };
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshRotationSceneBase,
      nodes: [{ ...meshRotationSceneBase.nodes[0], rotation: [0, 0, 0] }],
    },
  });
  const stageMeshUnrotatedPath = join(tempDir, 'broker-stage3d-mesh-unrotated.rgba');
  const stageMeshUnrotatedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshUnrotatedPath,
    time: 0.21,
    frame_index: 11,
  });
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshRotationSceneBase,
      nodes: [{ ...meshRotationSceneBase.nodes[0], rotation: [0.72, 0, 0.58] }],
    },
  });
  const stageMeshRotatedPath = join(tempDir, 'broker-stage3d-mesh-xyz-rotated.rgba');
  const stageMeshRotatedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshRotatedPath,
    time: 0.21,
    frame_index: 11,
  });
  assert(
    stageMeshUnrotatedSnapshot?.checksum !== stageMeshRotatedSnapshot?.checksum &&
      Number(stageMeshUnrotatedSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0) &&
      Number(stageMeshRotatedSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0),
    `native Stage3D mesh preview did not honor XYZ scene rotation: ${JSON.stringify({ stageMeshUnrotatedSnapshot, stageMeshRotatedSnapshot })}`,
  );
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshRotationSceneBase,
      lighting: { roomDarkness: 0, roomIntensity: 1, exposure: 1, screenBoost: 1 },
      nodes: [{ ...meshRotationSceneBase.nodes[0], rotation: [0, 0, 0] }],
    },
  });
  const stageMeshRoomLitPath = join(tempDir, 'broker-stage3d-mesh-room-lit.rgba');
  const stageMeshRoomLitSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshRoomLitPath,
    time: 0.211,
    frame_index: 12,
  });
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...meshRotationSceneBase,
      lighting: { roomDarkness: 0.82, roomIntensity: 1, exposure: 1, screenBoost: 1 },
      nodes: [{ ...meshRotationSceneBase.nodes[0], rotation: [0, 0, 0] }],
    },
  });
  const stageMeshRoomDarkPath = join(tempDir, 'broker-stage3d-mesh-room-dark.rgba');
  const stageMeshRoomDarkSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageMeshRoomDarkPath,
    time: 0.211,
    frame_index: 12,
  });
  assert(
    stageMeshRoomLitSnapshot?.checksum !== stageMeshRoomDarkSnapshot?.checksum &&
      Number(stageMeshRoomLitSnapshot?.max_luma ?? 0) > Number(stageMeshRoomDarkSnapshot?.max_luma ?? 0) + 0.05 &&
      Number(stageMeshRoomLitSnapshot?.bright_pixels ?? 0) > Number(stageMeshRoomDarkSnapshot?.bright_pixels ?? 0),
    `native Stage3D mesh preview did not apply scene room-darkness lighting: ${JSON.stringify({ stageMeshRoomLitSnapshot, stageMeshRoomDarkSnapshot })}`,
  );
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upsert_layer',
        layer_id: 'stage3d-vj-layer-0',
        z_index: 0,
        vj_layer_index: 0,
        blend_mode: 'normal',
        opacity: 1,
        corners: FULLSCREEN_CORNERS,
      },
      {
        type: 'bind_media_source',
        layer_id: 'stage3d-vj-layer-0',
        source_id: 'stage3d-texture-source',
        uri: 'contract://stage3d-texture-source',
        source_type: 'image',
      },
      {
        type: 'upload_source_frame',
        source_id: 'stage3d-texture-source',
        width: 16,
        height: 16,
        rgba_buffer: makeSolidRgbaFrame(16, 16, [245, 40, 30, 255]),
        seq: 1,
      },
    ],
  });
  const texturedStageScene = {
    id: 'contract-stage-textured-mesh',
    name: 'Contract Stage Textured Mesh',
    schemaVersion: 1,
    camera: { position: [0, 3.2, 12], target: [0, 2.5, 0], fov: 42 },
    nodes: [],
    userElements: [
      {
        id: 'native-textured-panel',
        type: 'visualpanel',
        position: [0, 1.8, 0],
        rotationY: 0,
        scale: 1,
        params: {
          w: 7,
          h: 4,
          d: 0.16,
          color: '#ffffff',
          vjSource: '0',
          brightness: 1.8,
          opacity: 1,
          uvMode: 'standard',
          uvZoom: 1,
          uvOffsetX: 0,
          uvOffsetY: 0,
          uvRotation: 0,
        },
      },
    ],
  };
  await broker.invoke('native_renderer_set_stage3d_scene', { scene: texturedStageScene });
  const stageTexturedRedPath = join(tempDir, 'broker-stage3d-textured-red.rgba');
  const stageTexturedRedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageTexturedRedPath,
    time: 0.22,
    frame_index: 12,
  });
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_frame',
        source_id: 'stage3d-texture-source',
        width: 16,
        height: 16,
        rgba_buffer: makeSolidRgbaFrame(16, 16, [30, 235, 90, 255]),
        seq: 2,
      },
    ],
  });
  const stageTexturedGreenPath = join(tempDir, 'broker-stage3d-textured-green.rgba');
  const stageTexturedGreenSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageTexturedGreenPath,
    time: 0.22,
    frame_index: 13,
  });
  assert(
    stageTexturedRedSnapshot?.checksum !== stageTexturedGreenSnapshot?.checksum &&
      Number(stageTexturedRedSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0) &&
      Number(stageTexturedGreenSnapshot?.bright_pixels ?? 0) > Number(stageEmptySnapshot?.bright_pixels ?? 0),
    `native Stage3D textured mesh preview did not sample source-frame texture changes: ${JSON.stringify({ stageTexturedRedSnapshot, stageTexturedGreenSnapshot })}`,
  );
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...texturedStageScene,
      lighting: { roomDarkness: 0.6, roomIntensity: 0.4, exposure: 0.6, screenBoost: 0.35 },
    },
  });
  const stageTexturedDimPath = join(tempDir, 'broker-stage3d-textured-dim.rgba');
  const stageTexturedDimSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageTexturedDimPath,
    time: 0.23,
    frame_index: 14,
  });
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      ...texturedStageScene,
      lighting: { roomDarkness: 0.6, roomIntensity: 0.4, exposure: 0.6, screenBoost: 2.4 },
    },
  });
  const stageTexturedBoostedPath = join(tempDir, 'broker-stage3d-textured-boosted.rgba');
  const stageTexturedBoostedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: stageTexturedBoostedPath,
    time: 0.23,
    frame_index: 14,
  });
  assert(
    stageTexturedDimSnapshot?.checksum !== stageTexturedBoostedSnapshot?.checksum &&
      Number(stageTexturedBoostedSnapshot?.average_luma ?? 0) > Number(stageTexturedDimSnapshot?.average_luma ?? 0) + 0.035 &&
      Number(stageTexturedBoostedSnapshot?.max_luma ?? 0) > Number(stageTexturedDimSnapshot?.max_luma ?? 0) + 0.04,
    `native Stage3D textured mesh preview did not apply scene screen boost independently from room lighting: ${JSON.stringify({ stageTexturedDimSnapshot, stageTexturedBoostedSnapshot })}`,
  );
  await broker.invoke('native_renderer_set_stage3d_scene', {
    scene: {
      id: 'contract-stage-cleared-before-projection',
      name: 'Contract Stage Cleared Before Projection',
      schemaVersion: 1,
      nodes: [],
      userElements: [],
    },
  });
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'set_layer_visibility',
        layer_id: 'stage3d-vj-layer-0',
        visible: false,
      },
    ],
  });

  const projectionSummary = await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      id: 'contract-projection',
      name: 'Contract Projection',
      schemaVersion: 1,
      objects: [
        { id: 'cube', type: 'primitive', primitive: 'box' },
        { id: 'venue', type: 'model', assetFormat: 'glb' },
        { id: 'scan', type: 'pointcloud', assetFormat: 'ply' },
      ],
      projectors: [
        { id: 'proj-a', enabled: true },
        { id: 'proj-b', enabled: false },
      ],
    },
  });
  assert(
    projectionSummary?.scene_kind === 'projection-sim' &&
      projectionSummary?.object_count === 3 &&
      projectionSummary?.primitive_count === 1 &&
      projectionSummary?.model_count === 1 &&
      projectionSummary?.point_cloud_count === 1 &&
      projectionSummary?.projector_count === 2,
    `native Projection Sim scene summary did not round-trip: ${JSON.stringify(projectionSummary)}`,
  );
  await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      id: 'contract-projection-empty',
      name: 'Contract Projection Empty',
      schemaVersion: 1,
      objects: [],
      projectors: [],
    },
  });
  tempDir = tempDir || mkdtempSync(join(tmpdir(), 'ghost-native-broker-frame-'));
  const projectionEmptyPath = join(tempDir, 'broker-projection-empty.rgba');
  const projectionEmptySnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionEmptyPath,
    time: 0.25,
    frame_index: 11,
  });
  await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      id: 'contract-projection-overlay',
      name: 'Contract Projection Overlay',
      schemaVersion: 1,
      objects: [
        {
          id: 'native-projection-box',
          name: 'Native Projection Box',
          type: 'primitive',
          primitive: 'box',
          position: [0, 2.4, 0],
          rotation: [0, 0, 0],
          scale: [7, 4, 2],
          color: '#e8ddc4',
          visible: true,
          receiveProjection: true,
        },
      ],
      projectors: [
        {
          id: 'native-projection-projector',
          name: 'Native Projection Projector',
          enabled: true,
          position: [-5, 4.4, 5],
          target: [0, 2.4, 0],
          intensity: 1.4,
          opacity: 1,
          color: '#9fe8ff',
          source: 'slice',
          sliceId: 'stage3d-texture-source',
        },
      ],
    },
  });
  const projectionOverlayPath = join(tempDir, 'broker-projection-overlay.rgba');
  const projectionOverlaySnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionOverlayPath,
    time: 0.25,
    frame_index: 11,
  });
  assert(
    projectionEmptySnapshot?.checksum !== projectionOverlaySnapshot?.checksum &&
      Number(projectionOverlaySnapshot?.average_luma ?? 0) > Number(projectionEmptySnapshot?.average_luma ?? 0),
    `native Projection Sim mesh/overlay preview did not affect exported frame pixels: ${JSON.stringify({ projectionEmptySnapshot, projectionOverlaySnapshot })}`,
  );
  const projectionRotationSceneBase = {
    id: 'contract-projection-mesh-rotation',
    name: 'Contract Projection Mesh Rotation',
    schemaVersion: 1,
    camera: { position: [0, 2.8, 10], target: [0, 2.3, 0], fov: 34 },
    objects: [
      {
        id: 'native-projection-xyz-rotation',
        name: 'Native Projection XYZ Rotation',
        type: 'primitive',
        primitive: 'box',
        position: [0, 2.3, 0],
        scale: [4.8, 1.7, 1.0],
        color: '#b7f3ff',
        visible: true,
        receiveProjection: false,
      },
    ],
    projectors: [],
  };
  await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      ...projectionRotationSceneBase,
      objects: [{ ...projectionRotationSceneBase.objects[0], rotation: [0, 0, 0] }],
    },
  });
  const projectionMeshUnrotatedPath = join(tempDir, 'broker-projection-mesh-unrotated.rgba');
  const projectionMeshUnrotatedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionMeshUnrotatedPath,
    time: 0.26,
    frame_index: 12,
  });
  await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      ...projectionRotationSceneBase,
      objects: [{ ...projectionRotationSceneBase.objects[0], rotation: [0.65, 0, 0.48] }],
    },
  });
  const projectionMeshRotatedPath = join(tempDir, 'broker-projection-mesh-xyz-rotated.rgba');
  const projectionMeshRotatedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionMeshRotatedPath,
    time: 0.26,
    frame_index: 12,
  });
  assert(
    projectionMeshUnrotatedSnapshot?.checksum !== projectionMeshRotatedSnapshot?.checksum &&
      Number(projectionMeshUnrotatedSnapshot?.bright_pixels ?? 0) > Number(projectionEmptySnapshot?.bright_pixels ?? 0) &&
      Number(projectionMeshRotatedSnapshot?.bright_pixels ?? 0) > Number(projectionEmptySnapshot?.bright_pixels ?? 0),
    `native Projection Sim mesh preview did not honor XYZ scene rotation: ${JSON.stringify({ projectionMeshUnrotatedSnapshot, projectionMeshRotatedSnapshot })}`,
  );
  await broker.invoke('native_renderer_set_projection_sim_scene', {
    scene: {
      id: 'contract-projection-textured',
      name: 'Contract Projection Textured',
      schemaVersion: 1,
      camera: { position: [0, 2.4, 10], target: [0, 2.4, 0], fov: 28 },
      objects: [
        {
          id: 'native-projection-textured-plane',
          name: 'Native Projection Textured Plane',
          type: 'primitive',
          primitive: 'plane',
          position: [0, 2.4, 0],
          rotation: [0, 0, 0],
          scale: [18, 10, 0.1],
          color: '#e8ddc4',
          visible: true,
          receiveProjection: true,
        },
      ],
      projectors: [
        {
          id: 'native-projection-textured-projector',
          name: 'Native Projection Textured Projector',
          enabled: true,
          position: [-5, 4.4, 5],
          target: [0, 2.4, 0],
          intensity: 1.4,
          opacity: 1,
          color: '#ffffff',
          source: 'slice',
          sliceId: 'stage3d-texture-source',
          crop: [0, 0, 1, 1],
        },
      ],
    },
  });
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_frame',
        source_id: 'stage3d-texture-source',
        width: 16,
        height: 16,
        rgba_buffer: makeSolidRgbaFrame(16, 16, [250, 38, 42, 255]),
        seq: 3,
      },
    ],
  });
  const projectionTexturedRedPath = join(tempDir, 'broker-projection-textured-red.rgba');
  const projectionTexturedRedSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionTexturedRedPath,
    time: 0.27,
    frame_index: 14,
  });
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_frame',
        source_id: 'stage3d-texture-source',
        width: 16,
        height: 16,
        rgba_buffer: makeSolidRgbaFrame(16, 16, [28, 238, 96, 255]),
        seq: 4,
      },
    ],
  });
  const projectionTexturedGreenPath = join(tempDir, 'broker-projection-textured-green.rgba');
  const projectionTexturedGreenSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: projectionTexturedGreenPath,
    time: 0.27,
    frame_index: 15,
  });
  const redMean = projectionTexturedRedSnapshot?.mean_rgba ?? [];
  const greenMean = projectionTexturedGreenSnapshot?.mean_rgba ?? [];
  assert(
    projectionTexturedRedSnapshot?.checksum !== projectionTexturedGreenSnapshot?.checksum &&
      Number(redMean[0] ?? 0) > Number(greenMean[0] ?? 0) + 0.08 &&
      Number(greenMean[1] ?? 0) > Number(redMean[1] ?? 0) + 0.08,
    `native Projection Sim textured mesh preview did not sample source-frame texture changes: ${JSON.stringify({ projectionTexturedRedSnapshot, projectionTexturedGreenSnapshot })}`,
  );

  tempDir = tempDir || mkdtempSync(join(tmpdir(), 'ghost-native-broker-frame-'));
  const prefetchImagePath = join(tempDir, 'broker-prefetch.bmp');
  writeFileSync(prefetchImagePath, makeTinyBmpBytes());
  const beforePrefetchStatus = await broker.invoke('native_renderer_get_status');
  const prefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-image',
    uri: prefetchImagePath,
    source_type: 'image',
    priority: 2,
  });
  assert(
    Number(prefetchStatus.native_image_decodes ?? 0) >
      Number(beforePrefetchStatus.native_image_decodes ?? 0),
    `native static-image prefetch did not decode source: ${JSON.stringify(prefetchStatus)}`,
  );
  assert(
    prefetchStatus.source_frame_last_upload_transport === 'native-image',
    `native static-image prefetch did not report native-image transport: ${JSON.stringify(prefetchStatus)}`,
  );
  const secondPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-image',
    uri: prefetchImagePath,
    source_type: 'image',
    priority: 2,
  });
  assert(
    Number(secondPrefetchStatus.native_image_decodes ?? 0) ===
      Number(prefetchStatus.native_image_decodes ?? 0),
    `native static-image prefetch should reuse resident source frame: ${JSON.stringify(secondPrefetchStatus)}`,
  );
  await broker.invoke('native_renderer_clear_prefetch_cache');
  const thirdPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-image',
    uri: prefetchImagePath,
    source_type: 'image',
    priority: 2,
  });
  assert(
    Number(thirdPrefetchStatus.native_image_decodes ?? 0) >
      Number(secondPrefetchStatus.native_image_decodes ?? 0),
    `native static-image prefetch cache clear should force the next decode: ${JSON.stringify(thirdPrefetchStatus)}`,
  );

  const prefetchVideoPath = join(tempDir, 'broker-prefetch-video.mp4');
  writeTinyTestVideo(prefetchVideoPath);
  const beforeVideoPrefetchStatus = await broker.invoke('native_renderer_get_status');
  const videoPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-video',
    uri: prefetchVideoPath,
    source_type: 'video',
    decode_width: 64,
    decode_height: 64,
    priority: 2,
    seq: 501,
  });
  assert(
    Number(videoPrefetchStatus.source_frame_uploads ?? 0) >
      Number(beforeVideoPrefetchStatus.source_frame_uploads ?? 0),
    `native video frame prefetch did not upload a decoded source frame: ${JSON.stringify(videoPrefetchStatus)}`,
  );
  assert(
    ['native-video-frame', 'file'].includes(videoPrefetchStatus.source_frame_last_upload_transport) &&
      Number(videoPrefetchStatus.source_frame_last_upload_width ?? 0) === 64 &&
      Number(videoPrefetchStatus.source_frame_last_upload_height ?? 0) === 64 &&
      Number(videoPrefetchStatus.source_frame_last_input_bytes ?? 0) === 64 * 64 * 4 &&
      Number(videoPrefetchStatus.source_frame_last_upload_bytes ?? 0) > 0,
    `native video frame prefetch did not hand off the expected bounded RGBA frame: ${JSON.stringify(videoPrefetchStatus)}`,
  );

  const timedVideoPath = join(tempDir, 'broker-prefetch-video-two-color.mp4');
  writeTwoColorTestVideo(timedVideoPath);
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upsert_layer',
        layer_id: 'timed-video-prefetch-layer',
        z_index: 0,
        blend_mode: 'normal',
        opacity: 1,
        corners: FULLSCREEN_CORNERS,
      },
      {
        type: 'bind_media_source',
        layer_id: 'timed-video-prefetch-layer',
        source_id: 'broker-prefetch-video-timed',
        uri: timedVideoPath,
        source_type: 'video',
      },
    ],
  });
  const blueVideoPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-video-timed',
    uri: timedVideoPath,
    source_type: 'video',
    decode_width: 64,
    decode_height: 64,
    priority: 2,
    time_seconds: 0.05,
    seq: 50,
  });
  const redVideoFramePath = join(tempDir, 'broker-prefetch-video-red.rgba');
  const redVideoFrameSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: redVideoFramePath,
    time: 0.05,
    frame_index: 50,
  });
  const secondBlueVideoPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-video-timed',
    uri: timedVideoPath,
    source_type: 'video',
    decode_width: 64,
    decode_height: 64,
    priority: 2,
    time_seconds: 0.75,
    seq: 750,
  });
  const blueVideoFramePath = join(tempDir, 'broker-prefetch-video-blue.rgba');
  const blueVideoFrameSnapshot = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: blueVideoFramePath,
    time: 0.75,
    frame_index: 750,
  });
  const redVideoMean = redVideoFrameSnapshot?.mean_rgba ?? [];
  const blueVideoMean = blueVideoFrameSnapshot?.mean_rgba ?? [];
  assert(
    redVideoFrameSnapshot?.checksum !== blueVideoFrameSnapshot?.checksum &&
      Number(redVideoMean[0] ?? 0) > Number(blueVideoMean[0] ?? 0) + 0.08 &&
      Number(blueVideoMean[2] ?? 0) > Number(redVideoMean[2] ?? 0) + 0.08,
    `native video frame prefetch did not honor requested timestamp: ${JSON.stringify({ redVideoFrameSnapshot, blueVideoFrameSnapshot })}`,
  );
  const coreVideoFrameDecode = !!capabilities?.features?.native_video_frame_decode;
  let videoFrameCacheStatsBeforeRepeat = null;
  let videoFrameCacheHitsBeforeRepeat = 0;
  let videoFrameCacheMissesBeforeRepeat = 0;
  if (!coreVideoFrameDecode) {
    assert(
      Number(blueVideoPrefetchStatus.video_frame_prefetch_cache_entries ?? 0) > 0,
      `native video frame prefetch should expose broker cache entries in status: ${JSON.stringify(blueVideoPrefetchStatus)}`,
    );
    videoFrameCacheStatsBeforeRepeat = await broker.invoke('native_renderer_get_stats');
    videoFrameCacheHitsBeforeRepeat = Number(videoFrameCacheStatsBeforeRepeat.video_frame_prefetch_cache_hits ?? 0);
    videoFrameCacheMissesBeforeRepeat = Number(videoFrameCacheStatsBeforeRepeat.video_frame_prefetch_cache_misses ?? 0);
  }
  const repeatedBlueVideoPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
    source_id: 'broker-prefetch-video-timed',
    uri: timedVideoPath,
    source_type: 'video',
    decode_width: 64,
    decode_height: 64,
    priority: 2,
    time_seconds: 0.75,
    seq: 751,
  });
  if (coreVideoFrameDecode) {
    assert(
      Number(secondBlueVideoPrefetchStatus.native_video_frame_decodes ?? 0) > 0 &&
        secondBlueVideoPrefetchStatus.source_frame_last_upload_transport === 'native-video-frame',
      `native video frame prefetch should use the core decode path: ${JSON.stringify(secondBlueVideoPrefetchStatus)}`,
    );
    assert(
      Number(repeatedBlueVideoPrefetchStatus.native_video_frame_decodes ?? 0) ===
        Number(secondBlueVideoPrefetchStatus.native_video_frame_decodes ?? 0) &&
        Number(repeatedBlueVideoPrefetchStatus.source_frame_uploads ?? 0) ===
          Number(secondBlueVideoPrefetchStatus.source_frame_uploads ?? 0),
      `native video frame prefetch repeat should reuse the core video-frame signature for the same timestamp: ${JSON.stringify({ before: secondBlueVideoPrefetchStatus, after: repeatedBlueVideoPrefetchStatus })}`,
    );
    const crossSourceBlueVideoPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-timed-copy',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      time_seconds: 0.75,
      seq: 752,
    });
    assert(
      Number(crossSourceBlueVideoPrefetchStatus.native_video_frame_decodes ?? 0) ===
        Number(secondBlueVideoPrefetchStatus.native_video_frame_decodes ?? 0) &&
        Number(crossSourceBlueVideoPrefetchStatus.native_video_frame_cache_hits ?? 0) >
          Number(secondBlueVideoPrefetchStatus.native_video_frame_cache_hits ?? 0) &&
        Number(crossSourceBlueVideoPrefetchStatus.source_frame_uploads ?? 0) >
          Number(repeatedBlueVideoPrefetchStatus.source_frame_uploads ?? 0) &&
        crossSourceBlueVideoPrefetchStatus.source_frame_last_upload_transport === 'native-video-frame-cache',
      `native video frame prefetch should reuse the core decoded-frame cache across source ids: ${JSON.stringify({ before: secondBlueVideoPrefetchStatus, repeat: repeatedBlueVideoPrefetchStatus, copy: crossSourceBlueVideoPrefetchStatus })}`,
    );
    const windowBaseTime = 0.05;
    const windowNextTime = windowBaseTime + 1 / 30;
    const windowBasePrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-window',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      time_seconds: windowBaseTime,
      prefetch_window_frames: 1,
      prefetch_fps: 30,
      seq: 805,
    });
    const windowNextPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-window-next',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      time_seconds: windowNextTime,
      seq: 806,
    });
    assert(
      Number(windowNextPrefetchStatus.native_video_frame_decodes ?? 0) ===
        Number(windowBasePrefetchStatus.native_video_frame_decodes ?? 0) &&
        Number(windowNextPrefetchStatus.native_video_frame_cache_hits ?? 0) >
          Number(windowBasePrefetchStatus.native_video_frame_cache_hits ?? 0) &&
        Number(windowNextPrefetchStatus.source_frame_uploads ?? 0) >
          Number(windowBasePrefetchStatus.source_frame_uploads ?? 0) &&
        windowNextPrefetchStatus.source_frame_last_upload_transport === 'native-video-frame-cache',
      `native video frame prefetch window should warm the next timestamp in the core cache: ${JSON.stringify({ base: windowBasePrefetchStatus, next: windowNextPrefetchStatus })}`,
    );
    await broker.invoke('native_renderer_submit_commands', {
      commands: [
        { type: 'set_render_clock', mode: 'manual', time: 12, time_delta: 0, frame_index: 12000 },
        {
          type: 'set_media_source_playback',
          source_id: 'broker-prefetch-video-clocked',
          uri: timedVideoPath,
          source_type: 'video',
          time_seconds: windowBaseTime,
          clock_time_seconds: 12,
          playback_rate: 1,
          paused: false,
          loop_enabled: false,
          duration_seconds: 2,
          seq: 1,
        },
      ],
    });
    const clockedBasePrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-clocked',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      prefetch_window_frames: 1,
      prefetch_fps: 30,
      seq: 900,
    });
    await broker.invoke('native_renderer_submit_commands', {
      commands: [
        { type: 'set_render_clock', mode: 'manual', time: 12 + 1 / 30, time_delta: 1 / 30, frame_index: 12001 },
      ],
    });
    const clockedNextPrefetchStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-clocked',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      seq: 901,
    });
    assert(
      Number(clockedNextPrefetchStatus.native_video_frame_decodes ?? 0) ===
        Number(clockedBasePrefetchStatus.native_video_frame_decodes ?? 0) &&
        Number(clockedNextPrefetchStatus.native_video_frame_cache_hits ?? 0) >
          Number(clockedBasePrefetchStatus.native_video_frame_cache_hits ?? 0) &&
        clockedNextPrefetchStatus.source_frame_last_upload_transport === 'native-video-frame-cache',
      `native media source playback state should let timestamp-less prefetch follow the render clock: ${JSON.stringify({ base: clockedBasePrefetchStatus, next: clockedNextPrefetchStatus })}`,
    );
    const pumpVideoPath = join(tempDir, 'broker-pump-video-two-color.mp4');
    writeTwoColorTestVideo(pumpVideoPath);
    const beforePumpStatus = await broker.invoke('native_renderer_get_status');
    await broker.invoke('native_renderer_submit_commands', {
      commands: [
        {
          type: 'upsert_layer',
          layer_id: 'native-video-pump-layer',
          z_index: 1,
          blend_mode: 'normal',
          opacity: 1,
          corners: FULLSCREEN_CORNERS,
        },
        {
          type: 'bind_media_source',
          layer_id: 'native-video-pump-layer',
          source_id: 'broker-video-decode-pump',
          uri: pumpVideoPath,
          source_type: 'video',
        },
        { type: 'set_render_clock', mode: 'manual', time: 22, time_delta: 0, frame_index: 22000 },
        {
          type: 'set_media_source_playback',
          source_id: 'broker-video-decode-pump',
          uri: pumpVideoPath,
          source_type: 'video',
          time_seconds: 0.95,
          clock_time_seconds: 22,
          playback_rate: 1,
          paused: true,
          loop_enabled: false,
          duration_seconds: 1.2,
          seq: 1,
        },
      ],
    });
    let pumpStatus = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(50);
      pumpStatus = await broker.invoke('native_renderer_get_status');
      if (
        Number(pumpStatus.decode_jobs_completed ?? 0) > Number(beforePumpStatus.decode_jobs_completed ?? 0) &&
        Number(pumpStatus.source_frame_uploads ?? 0) > Number(beforePumpStatus.source_frame_uploads ?? 0) &&
        pumpStatus.source_frame_last_upload_transport === 'native-video-decode-pump'
      ) {
        break;
      }
    }
    assert(
      Number(pumpStatus?.decode_jobs_submitted ?? 0) > Number(beforePumpStatus.decode_jobs_submitted ?? 0) &&
        Number(pumpStatus?.decode_jobs_completed ?? 0) > Number(beforePumpStatus.decode_jobs_completed ?? 0) &&
        Number(pumpStatus?.native_video_frame_decodes ?? 0) > Number(beforePumpStatus.native_video_frame_decodes ?? 0) &&
        Number(pumpStatus?.native_video_frame_cache_entries ?? 0) >
          Number(beforePumpStatus.native_video_frame_cache_entries ?? 0) + 1 &&
        Number(pumpStatus?.source_frame_uploads ?? 0) > Number(beforePumpStatus.source_frame_uploads ?? 0) &&
        pumpStatus?.source_frame_last_upload_transport === 'native-video-decode-pump',
      `native video decode pump should upload a visible layer frame from render/media clocks without explicit prefetch: ${JSON.stringify({ before: beforePumpStatus, after: pumpStatus })}`,
    );
    const clearedVideoFramePrefetchStatus = await broker.invoke('native_renderer_clear_prefetch_cache');
    assert(
      Number(clearedVideoFramePrefetchStatus.cleared_native_video_frame_signatures ?? 0) > 0 &&
        Number(clearedVideoFramePrefetchStatus.cleared_native_video_frame_cache_entries ?? 0) > 0,
      `native prefetch clear should clear core video-frame signatures and decoded-frame cache: ${JSON.stringify(clearedVideoFramePrefetchStatus)}`,
    );
  } else {
    assert(
      Number(repeatedBlueVideoPrefetchStatus.video_frame_prefetch_cache_entries ?? 0) > 0,
      `native video frame prefetch status should retain broker cache entries after reuse: ${JSON.stringify(repeatedBlueVideoPrefetchStatus)}`,
    );
    const videoFrameCacheStatsAfterRepeat = await broker.invoke('native_renderer_get_stats');
    assert(
      Number(videoFrameCacheStatsAfterRepeat.video_frame_prefetch_cache_hits ?? 0) >
        videoFrameCacheHitsBeforeRepeat &&
        Number(videoFrameCacheStatsAfterRepeat.video_frame_prefetch_cache_misses ?? 0) ===
          videoFrameCacheMissesBeforeRepeat,
      `native video frame prefetch should reuse the broker timestamp cache: ${JSON.stringify({ before: videoFrameCacheStatsBeforeRepeat, after: videoFrameCacheStatsAfterRepeat })}`,
    );
    const brokerWindowStatsBefore = await broker.invoke('native_renderer_get_stats');
    const brokerWindowBaseTime = 0.05;
    const brokerWindowNextTime = brokerWindowBaseTime + 1 / 30;
    const brokerWindowBaseStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-window',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      time_seconds: brokerWindowBaseTime,
      prefetch_window_frames: 1,
      prefetch_fps: 30,
      seq: 805,
    });
    const brokerWindowNextStatus = await broker.invoke('native_renderer_prefetch_media', {
      source_id: 'broker-prefetch-video-window-next',
      uri: timedVideoPath,
      source_type: 'video',
      decode_width: 64,
      decode_height: 64,
      priority: 2,
      time_seconds: brokerWindowNextTime,
      seq: 806,
    });
    const brokerWindowStatsAfter = await broker.invoke('native_renderer_get_stats');
    assert(
      Number(brokerWindowNextStatus.video_frame_prefetch_cache_hits ?? 0) >
        Number(brokerWindowBaseStatus.video_frame_prefetch_cache_hits ?? 0) &&
        Number(brokerWindowStatsAfter.video_frame_prefetch_cache_hits ?? 0) >
          Number(brokerWindowStatsBefore.video_frame_prefetch_cache_hits ?? 0),
      `native video frame prefetch window should warm the next timestamp in the broker cache: ${JSON.stringify({ base: brokerWindowBaseStatus, next: brokerWindowNextStatus, before: brokerWindowStatsBefore, after: brokerWindowStatsAfter })}`,
    );
    const clearedVideoFramePrefetchStatus = await broker.invoke('native_renderer_clear_prefetch_cache');
    assert(
      Number(clearedVideoFramePrefetchStatus.cleared_video_frame_prefetch_entries ?? 0) > 0 &&
        Number(clearedVideoFramePrefetchStatus.video_frame_prefetch_cache_entries ?? -1) === 0,
      `native prefetch clear should empty the broker video-frame cache: ${JSON.stringify(clearedVideoFramePrefetchStatus)}`,
    );
  }

  const readiness = await broker.invoke('native_renderer_get_readiness_report');
  const checks = new Map((readiness?.checks ?? []).map((check) => [check.id, check]));
  assert(checks.get('core-capabilities')?.ok, `broker readiness did not confirm core capabilities: ${JSON.stringify(readiness)}`);
  for (const id of REQUIRED_CHECKS) {
    assert(checks.get(id)?.ok, `broker readiness has stale/missing ${id}: ${JSON.stringify(readiness)}`);
  }
  assert(checks.get('native-output-mirror')?.ok, `broker readiness omitted native output mirror: ${JSON.stringify(readiness)}`);
  assert(checks.get('native-output-driver')?.ok, `broker readiness omitted native output driver: ${JSON.stringify(readiness)}`);
  assert(readiness?.modes?.shadow?.ok, `broker readiness shadow mode should be ready: ${JSON.stringify(readiness?.modes)}`);
  assert(readiness?.modes?.output_driver?.ok, `broker readiness output-driver mode should be ready: ${JSON.stringify(readiness?.modes)}`);
  if (outputExportExpected) {
    assert(
      readiness?.modes?.full_v2?.ok === true &&
        Array.isArray(readiness?.modes?.full_v2?.blockers) &&
        readiness.modes.full_v2.blockers.length === 0,
      `broker readiness should mark full_v2 ready on macOS once native decode and IOSurface transport are active: ${JSON.stringify(readiness?.modes)}`,
    );
  } else {
    assert(
      readiness?.modes?.full_v2?.ok === false &&
        Array.isArray(readiness?.modes?.full_v2?.blockers) &&
        readiness.modes.full_v2.blockers.some((blocker) => String(blocker).includes('shared-texture media transport')) &&
        !readiness.modes.full_v2.blockers.some((blocker) => String(blocker).includes('continuous native video decode')),
      `broker readiness should keep full_v2 blocked on real unfinished native work: ${JSON.stringify(readiness?.modes)}`,
    );
  }
  assert(checks.get('native-static-image-prefetch')?.ok, `broker readiness omitted native static-image prefetch: ${JSON.stringify(readiness)}`);
  const mp4FrameEncoderCheck = checks.get('native-mp4-frame-encoder');
  const nativeRecordingCheck = checks.get('native-recording');
  assert(mp4FrameEncoderCheck?.ok, `broker readiness omitted native MP4 frame encoder: ${JSON.stringify(readiness)}`);
  assert(nativeRecordingCheck?.ok, `broker readiness omitted native recording: ${JSON.stringify(readiness)}`);
  assert(
    capabilities?.features?.native_recording === true &&
      capabilities?.features?.native_mp4_frame_encoder === true &&
      capabilities?.features?.native_frame_export === true &&
      String(nativeRecordingCheck?.detail ?? '').includes('MP4/JPEG encoders'),
    `broker recording readiness must require raw native frame export plus the desktop encoder bridge: ${JSON.stringify({ features: capabilities?.features, nativeRecordingCheck })}`,
  );
  assert(checks.has('managed-output'), `broker readiness omitted managed output check: ${JSON.stringify(readiness)}`);
  if (!checks.get('managed-output')?.ok) {
    console.warn(
      '[native-broker-contract] managed output did not present in this harness; continuing with core graph/source-frame readiness',
      JSON.stringify(checks.get('managed-output')),
    );
  }
  assert(
    checks.get('shared-texture-upload')?.ok === outputExportExpected,
    `broker shared texture media transport readiness should match platform support: ${JSON.stringify(readiness)}`,
  );
  assert(
    checks.get('shared-texture-output-export')?.ok === outputExportExpected,
    `broker output shared-texture export readiness should match platform support: ${JSON.stringify(readiness)}`,
  );
  assert(
    checks.get('native-texture-share-sender')?.ok === outputExportExpected,
    `broker native texture-share sender readiness should match app bridge support: ${JSON.stringify(readiness)}`,
  );
  assert(
    checks.get('shared-texture-source-frame-upload')?.ok === (process.platform === 'darwin'),
    `broker shared source-frame readiness should match macOS IOSurface support: ${JSON.stringify(readiness)}`,
  );

  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'precompile_shader',
        shader_id: 'broker-byte-buffer-compute',
        stage: 'compute',
        entry: 'cs_main',
        source: BYTE_BUFFER_COMPUTE_SOURCE,
      },
    ],
  });
  const seedBytes = new Uint8Array(new Uint32Array([7, 11, 13, 17]).buffer);
  const byteGraph = await broker.invoke('native_renderer_run_compute_graph', {
    buffers: [
      {
        id: 'byte-graph-seeds',
        kind: 'uniform',
        byte_length: 16,
        initial_buffer: seedBytes,
      },
      {
        id: 'byte-graph-output',
        kind: 'storage',
        byte_length: 16,
      },
    ],
    passes: [
      {
        name: 'byte-buffer-compute',
        shader_id: 'broker-byte-buffer-compute',
        entry: 'cs_main',
        dispatch: [1, 1, 1],
        bindings: [
          { binding: 0, resource: 'byte-graph-seeds', kind: 'uniform' },
          { binding: 1, resource: 'byte-graph-output', kind: 'storage' },
        ],
      },
    ],
    readbacks: ['byte-graph-output'],
  });
  assert(
    JSON.stringify(byteGraph?.readbacks?.['byte-graph-output']?.first_words?.slice(0, 4)) ===
      JSON.stringify([107, 112, 115, 120]),
    `compute graph binary initial buffer was not read correctly: ${JSON.stringify(byteGraph)}`,
  );
  const pruneGraph = await broker.invoke('native_renderer_run_compute_graph', {
    buffers: [
      {
        id: 'contract-prune:seeds',
        kind: 'uniform',
        byte_length: 16,
        initial_buffer: seedBytes,
      },
      {
        id: 'contract-prune:output',
        kind: 'storage',
        byte_length: 16,
        persistent: true,
        clear: true,
      },
    ],
    passes: [
      {
        name: 'contract-prune-compute',
        shader_id: 'broker-byte-buffer-compute',
        entry: 'cs_main',
        dispatch: [1, 1, 1],
        bindings: [
          { binding: 0, resource: 'contract-prune:seeds', kind: 'uniform' },
          { binding: 1, resource: 'contract-prune:output', kind: 'storage' },
        ],
      },
    ],
    readbacks: [],
  });
  assert(
    Number(pruneGraph?.persistent_buffer_count ?? 0) > 0,
    `persistent graph did not allocate a native buffer: ${JSON.stringify(pruneGraph)}`,
  );
  const pruneResult = await broker.invoke('native_renderer_clear_runtime_caches', {
    config: {
      clear_precompiled_shaders: false,
      clear_texture_pool: false,
      clear_metadata_caches: false,
      clear_prefetch_cache: false,
      native_graph_buffer_prefixes: ['contract-prune:'],
    },
  });
  assert(
    Number(pruneResult?.cleared_native_graph_buffers ?? 0) >= 1 &&
      Number(pruneResult?.remaining_native_graph_buffers ?? 0) === 0,
    `runtime cache prune did not release native graph buffers: ${JSON.stringify(pruneResult)}`,
  );

  const outputTexture = await broker.invoke('native_renderer_get_output_shared_texture');
  if (outputExportExpected) {
    assert(
      outputTexture?.available &&
        outputTexture.platform === 'iosurface' &&
        String(outputTexture.handle ?? '').length > 0 &&
        outputTexture.handle_encoding === 'integer' &&
        Number(outputTexture.width ?? 0) > 0 &&
        Number(outputTexture.height ?? 0) > 0,
      `broker output shared-texture metadata is incomplete: ${JSON.stringify(outputTexture)}`,
    );
  } else {
    assert(
      !outputTexture?.available,
      `broker output shared-texture should be unavailable on this platform: ${JSON.stringify(outputTexture)}`,
    );
  }

  if (outputExportExpected) {
    const beforeLoopbackStatus = await broker.invoke('native_renderer_get_status');
    const loopbackStatus = await broker.invoke('native_renderer_upload_source_gpu_shared_texture', {
      source_id: 'direct-iosurface-loopback-contract',
      width: Number(outputTexture.width),
      height: Number(outputTexture.height),
      shared_handle: String(outputTexture.handle),
      platform: outputTexture.platform,
      format: outputTexture.format,
      handle_encoding: outputTexture.handle_encoding,
      handle_byte_length: outputTexture.handle_byte_length,
      seq: 1,
    });
    assert(
      Number(loopbackStatus.source_frame_uploads ?? 0) >
        Number(beforeLoopbackStatus.source_frame_uploads ?? 0),
      `valid output IOSurface loopback did not count as a source-frame upload: ${JSON.stringify(loopbackStatus)}`,
    );
    assert(
      Number(loopbackStatus.source_frame_shared_texture_uploads ?? 0) >
        Number(beforeLoopbackStatus.source_frame_shared_texture_uploads ?? 0),
      `valid output IOSurface loopback did not count as a shared upload: ${JSON.stringify(loopbackStatus)}`,
    );
    assert(
      Number(loopbackStatus.source_frame_rejected_uploads ?? 0) ===
        Number(beforeLoopbackStatus.source_frame_rejected_uploads ?? 0),
      `valid output IOSurface loopback was unexpectedly rejected: ${JSON.stringify(loopbackStatus)}`,
    );
    assert(
      loopbackStatus.source_frame_last_upload_transport === 'shared-texture',
      `valid output IOSurface loopback did not preserve shared transport detail: ${JSON.stringify(loopbackStatus)}`,
    );
  }

  const byteFrame = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < byteFrame.length; i += 4) {
    const pixel = i / 4;
    byteFrame[i] = (pixel * 11) % 255;
    byteFrame[i + 1] = 80;
    byteFrame[i + 2] = 220;
    byteFrame[i + 3] = 255;
  }
  const beforeByteFrameStatus = await broker.invoke('native_renderer_get_status');
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_frame',
        source_id: 'byte-buffer-frame-contract',
        width: 16,
        height: 16,
        rgba_buffer: byteFrame,
        seq: 1,
      },
    ],
  });
  const byteFrameStatus = await broker.invoke('native_renderer_get_status');
  assert(
    Number(byteFrameStatus.source_frame_uploads ?? 0) >
      Number(beforeByteFrameStatus.source_frame_uploads ?? 0),
    `binary source-frame buffer did not count as an upload: ${JSON.stringify(byteFrameStatus)}`,
  );
  assert(
    Number(byteFrameStatus.source_frame_file_uploads ?? 0) >
      Number(beforeByteFrameStatus.source_frame_file_uploads ?? 0),
    `binary source-frame buffer was not handed off through a temp file: ${JSON.stringify(byteFrameStatus)}`,
  );
  assert(
    Number(byteFrameStatus.source_frame_base64_uploads ?? 0) ===
      Number(beforeByteFrameStatus.source_frame_base64_uploads ?? 0),
    `binary source-frame buffer unexpectedly used base64 transport: ${JSON.stringify(byteFrameStatus)}`,
  );
  assert(
    byteFrameStatus.source_frame_last_upload_transport === 'file',
    `binary source-frame buffer did not preserve file transport detail: ${JSON.stringify(byteFrameStatus)}`,
  );
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upsert_layer',
        layer_id: 'byte-buffer-frame-layer-contract',
        z_index: 0,
        blend_mode: 'normal',
        opacity: 1,
        corners: FULLSCREEN_CORNERS,
      },
      {
        type: 'bind_media_source',
        layer_id: 'byte-buffer-frame-layer-contract',
        source_id: 'byte-buffer-frame-contract',
        uri: 'contract://byte-buffer-frame',
        source_type: 'image',
      },
    ],
  });
  tempDir = tempDir || mkdtempSync(join(tmpdir(), 'ghost-native-broker-frame-'));
  const exportedFramePath = join(tempDir, 'broker-frame.rgba');
  const exportedFrame = await broker.invoke('native_renderer_export_frame_snapshot', {
    path: exportedFramePath,
    time: 0.25,
    frame_index: 3,
  });
  const exportedFrameBytes = statSync(exportedFramePath).size;
  assert(
    !exportedFrame?.dark_frame &&
      Number(exportedFrame?.nonzero_pixels ?? 0) > 0 &&
      Number(exportedFrame?.average_luma ?? 0) > 0.01,
    `broker frame export rendered blank/dark: ${JSON.stringify(exportedFrame)}`,
  );
  assert(
    exportedFrameBytes === Number(exportedFrame?.byte_length ?? 0) &&
      exportedFrameBytes === Number(exportedFrame?.bytes_written ?? 0) &&
      exportedFrameBytes === Number(exportedFrame?.width ?? 0) * Number(exportedFrame?.height ?? 0) * 4,
    `broker frame export byte count mismatch: ${JSON.stringify({ exportedFrameBytes, exportedFrame })}`,
  );
  assert(
    exportedFrame?.includes_pixels === false && !exportedFrame?.rgba_b64,
    `broker frame export should not return base64 pixels over IPC: ${JSON.stringify(exportedFrame)}`,
  );

  const beforeDirectSharedStatus = await broker.invoke('native_renderer_get_status');
  let directSharedError = null;
  try {
    await broker.invoke('native_renderer_upload_source_gpu_shared_texture', {
      source_id: 'direct-shared-frame-contract',
      width: 16,
      height: 16,
      shared_handle: 'fake',
      platform: process.platform === 'darwin' ? 'iosurface' : 'dxgi',
      handle_encoding: 'base64',
      seq: 1,
    });
  } catch (err) {
    directSharedError = err;
  }
  const directSharedStatus = await broker.invoke('native_renderer_get_status');
  assert(
    directSharedError,
    `invalid direct shared texture source-frame RPC should reject loudly: ${JSON.stringify(directSharedStatus)}`,
  );
  assert(
    /(IOSurface|shared texture source-frame upload|handle|base64)/.test(String(directSharedError?.message ?? directSharedError)),
    `invalid direct shared texture source-frame RPC did not expose a clear error: ${String(directSharedError?.message ?? directSharedError)}`,
  );
  assert(
    Number(directSharedStatus.source_frame_uploads ?? 0) ===
      Number(beforeDirectSharedStatus.source_frame_uploads ?? 0),
    `invalid direct shared texture source-frame must not count as an upload: ${JSON.stringify(directSharedStatus)}`,
  );
  assert(
    Number(directSharedStatus.source_frame_rejected_uploads ?? 0) >
      Number(beforeDirectSharedStatus.source_frame_rejected_uploads ?? 0),
    `invalid direct shared texture source-frame rejection was not counted: ${JSON.stringify(directSharedStatus)}`,
  );

  const beforeSharedFrameStatus = await broker.invoke('native_renderer_get_status');
  await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_frame',
        source_id: 'shared-frame-contract',
        width: 16,
        height: 16,
        shared_handle: 'fake',
        shared_texture_platform: process.platform === 'darwin' ? 'iosurface' : 'dxgi',
        shared_texture_handle_encoding: 'base64',
        seq: 1,
      },
    ],
  });
  const sharedFrameStatus = await broker.invoke('native_renderer_get_status');
  assert(
    Number(sharedFrameStatus.source_frame_uploads ?? 0) ===
      Number(beforeSharedFrameStatus.source_frame_uploads ?? 0),
    `shared texture source-frame fallback must not count as an upload: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    Number(sharedFrameStatus.source_frame_shared_texture_uploads ?? 0) ===
      Number(beforeSharedFrameStatus.source_frame_shared_texture_uploads ?? 0),
    `unsupported shared texture source-frame should not report a completed shared upload: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    Number(sharedFrameStatus.source_frames_active ?? 0) ===
      Number(beforeSharedFrameStatus.source_frames_active ?? 0),
    `failed shared texture import should not activate a source frame: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    Number(sharedFrameStatus.source_frame_rejected_uploads ?? 0) >
      Number(beforeSharedFrameStatus.source_frame_rejected_uploads ?? 0),
    `shared texture source-frame rejection was not counted: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    Number(sharedFrameStatus.source_frame_shared_texture_rejected_uploads ?? 0) >
      Number(beforeSharedFrameStatus.source_frame_shared_texture_rejected_uploads ?? 0),
    `shared texture source-frame rejection was not labelled: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    sharedFrameStatus.source_frame_last_upload_transport === 'shared-texture-unsupported',
    `shared texture rejection did not preserve transport detail: ${JSON.stringify(sharedFrameStatus)}`,
  );
  assert(
    /(IOSurface|shared texture source-frame upload)/.test(
      String(sharedFrameStatus.source_frame_last_reject_reason ?? ''),
    ),
    `shared texture rejection did not expose a clear reason: ${JSON.stringify(sharedFrameStatus)}`,
  );

  const beforeExplicitSharedFrameStatus = await broker.invoke('native_renderer_get_status');
  const explicitSharedSummary = await broker.invoke('native_renderer_submit_commands', {
    commands: [
      {
        type: 'upload_source_gpu_shared_texture',
        source_id: 'explicit-shared-frame-contract',
        width: 16,
        height: 16,
        shared_handle: 'fake',
        shared_texture_platform: process.platform === 'darwin' ? 'iosurface' : 'dxgi',
        shared_texture_handle_encoding: 'base64',
        seq: 1,
      },
    ],
  });
  assert(
    Number(explicitSharedSummary?.dropped ?? 0) === 0,
    `explicit shared texture command was dropped: ${JSON.stringify(explicitSharedSummary)}`,
  );
  const explicitSharedFrameStatus = await broker.invoke('native_renderer_get_status');
  assert(
    Number(explicitSharedFrameStatus.source_frame_shared_texture_rejected_uploads ?? 0) >
      Number(beforeExplicitSharedFrameStatus.source_frame_shared_texture_rejected_uploads ?? 0),
    `explicit shared texture command did not reach native importer: ${JSON.stringify(explicitSharedFrameStatus)}`,
  );

  console.log(
    `Native broker contract passed: backend=${status.backend} adapter=${status.adapter_name ?? 'unknown'} graphs=${graphInstruments.size}`,
  );
} finally {
  await broker.invoke('native_renderer_stop').catch(() => {});
  broker.shutdownSync();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
