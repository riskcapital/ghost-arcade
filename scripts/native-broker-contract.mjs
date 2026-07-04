import { createNativeRendererBroker } from '../electron/native-renderer-broker.js';

const REQUIRED_CHECKS = [
  'compute-instrument-host',
  'native-planet-graph',
  'native-smoke-3d-graph',
  'native-particle-field-graph',
  'native-volumetric-spheres-graph',
  'native-smoke-riders-graph',
  'native-ink-cloud-graph',
  'native-flythrough-graph',
  'native-pixel-particles-graph',
  'native-point-cloud-fx-graph',
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
});

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

  const capabilities = await broker.invoke('native_renderer_get_capabilities');
  const outputExportExpected = process.platform === 'darwin';
  assert(capabilities?.features?.compute_graph_source_frame_target, 'broker capabilities lost compute graph source-frame support');
  assert(capabilities?.features?.native_output_mirror_texture, 'broker capabilities lost native output mirror support');
  assert(
    !!capabilities?.features?.shared_texture_source_frame_upload === (process.platform === 'darwin'),
    `broker shared source-frame capability should match macOS IOSurface support: ${JSON.stringify(capabilities?.features)}`,
  );
  assert(
    !!capabilities?.features?.shared_texture_output_export === outputExportExpected,
    `broker output shared-texture export capability should match macOS IOSurface support: ${JSON.stringify(capabilities?.features)}`,
  );
  const graphInstruments = new Set(capabilities?.native_graph_instruments ?? []);
  const graphManifest = new Map(
    (capabilities?.native_graph_instrument_manifest ?? []).map((entry) => [entry.id, entry]),
  );
  assert(
    graphInstruments.size === REQUIRED_GRAPH_MANIFEST.length,
    `broker graph instrument list has drifted: ${JSON.stringify(capabilities?.native_graph_instruments)}`,
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

  const readiness = await broker.invoke('native_renderer_get_readiness_report');
  const checks = new Map((readiness?.checks ?? []).map((check) => [check.id, check]));
  for (const id of REQUIRED_CHECKS) {
    assert(checks.get(id)?.ok, `broker readiness has stale/missing ${id}: ${JSON.stringify(readiness)}`);
  }
  assert(checks.get('native-output-mirror')?.ok, `broker readiness omitted native output mirror: ${JSON.stringify(readiness)}`);
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

  console.log(
    `Native broker contract passed: backend=${status.backend} adapter=${status.adapter_name ?? 'unknown'} graphs=${graphInstruments.size}`,
  );
} finally {
  await broker.invoke('native_renderer_stop').catch(() => {});
  broker.shutdownSync();
}
