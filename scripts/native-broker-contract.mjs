import { createNativeRendererBroker } from '../electron/native-renderer-broker.js';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  'native-projection-sim-overlay-preview',
  'native-projection-sim-mesh-preview',
  'native-projection-sim-textured-mesh-preview',
  'native-frame-sequence-export',
];

const REQUIRED_GRAPH_MANIFEST = [
  { id: 'planet', feature: 'native_planet_graph' },
  { id: 'smoke-3d', feature: 'native_3d_smoke_graph' },
  { id: 'particle-field', feature: 'native_particle_field_graph' },
  { id: 'volumetric-spheres', feature: 'native_volumetric_spheres_graph' },
  { id: 'smoke-riders', feature: 'native_smoke_riders_graph' },
  { id: 'ink-cloud', feature: 'native_ink_cloud_graph' },
  { id: 'flythrough', feature: 'native_flythrough_graph' },
  { id: 'pixel-particles', feature: 'native_pixel_particles_graph' },
  { id: 'point-cloud-fx', feature: 'native_point_cloud_fx_graph' },
];

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
  assert(
      capabilities?.features?.native_stage3d_scene_ingest &&
      capabilities?.features?.native_stage3d_overlay_preview &&
      capabilities?.features?.native_stage3d_mesh_preview &&
      capabilities?.features?.native_stage3d_textured_mesh_preview &&
      capabilities?.features?.native_stage3d_primitive_meshes &&
      capabilities?.features?.native_projection_sim_scene_ingest &&
      capabilities?.features?.native_projection_sim_overlay_preview &&
      capabilities?.features?.native_projection_sim_mesh_preview &&
      capabilities?.features?.native_projection_sim_textured_mesh_preview &&
      capabilities?.features?.native_stage3d === false &&
      capabilities?.features?.native_projection_sim === false,
    `broker scene bridge should advertise ingest/preview without claiming full native 3D rendering: ${JSON.stringify(capabilities?.features)}`,
  );
  const compositorBlendModes = new Map(
    (capabilities?.native_compositor_blend_modes ?? []).map((entry) => [entry.id, Number(entry.code)]),
  );
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
      decodeCapabilities?.vram_budget_enforcement === false &&
      decodeCapabilities?.native_media_decode === false &&
      decodeCapabilities?.video_decode === false &&
      decodeCapabilities?.supported_source_types?.includes('image'),
    `broker decode capabilities should report static-image-only native decode: ${JSON.stringify(decodeCapabilities)}`,
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
  assert(
    policyStatus.decode_store_cpu_backup_frames === true &&
      policyStatus.decode_allow_synthetic_fallback === true &&
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
      Number(policyStatus.vram_budget_mb) === 6144,
    `native policy setters did not round-trip through status: ${JSON.stringify(policyStatus)}`,
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
    !!capabilities?.features?.native_texture_share_sender === outputExportExpected,
    `broker native texture-share sender capability should match app bridge support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    capabilities?.implemented_methods?.includes('upload_source_gpu_shared_texture'),
    `broker capabilities missing direct shared texture source-frame RPC: ${JSON.stringify(capabilities?.implemented_methods)}`,
  );
  assert(
    capabilities?.features?.frame_snapshot_export &&
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
    assert(Array.isArray(entry.shader_ids) && entry.shader_ids.length > 0, `broker graph ${required.id} has no shader IDs: ${JSON.stringify(entry)}`);
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
  assert(
    readiness?.modes?.full_v2?.ok === false &&
      Array.isArray(readiness?.modes?.full_v2?.blockers) &&
      readiness.modes.full_v2.blockers.some((blocker) => String(blocker).includes('shared-texture media transport')),
    `broker readiness should keep full_v2 blocked on real unfinished native work: ${JSON.stringify(readiness?.modes)}`,
  );
  assert(checks.get('native-static-image-prefetch')?.ok, `broker readiness omitted native static-image prefetch: ${JSON.stringify(readiness)}`);
  assert(checks.get('native-mp4-frame-encoder')?.ok, `broker readiness omitted native MP4 frame encoder: ${JSON.stringify(readiness)}`);
  assert(checks.get('native-recording')?.ok, `broker readiness omitted native recording: ${JSON.stringify(readiness)}`);
  assert(checks.has('managed-output'), `broker readiness omitted managed output check: ${JSON.stringify(readiness)}`);
  if (!checks.get('managed-output')?.ok) {
    console.warn(
      '[native-broker-contract] managed output did not present in this harness; continuing with core graph/source-frame readiness',
      JSON.stringify(checks.get('managed-output')),
    );
  }
  assert(checks.get('shared-texture-upload')?.ok === false, 'broker should report shared texture upload as unavailable until implemented');
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
  const directSharedStatus = await broker.invoke('native_renderer_upload_source_gpu_shared_texture', {
    source_id: 'direct-shared-frame-contract',
    width: 16,
    height: 16,
    shared_handle: 'fake',
    platform: process.platform === 'darwin' ? 'iosurface' : 'dxgi',
    handle_encoding: 'base64',
    seq: 1,
  });
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
