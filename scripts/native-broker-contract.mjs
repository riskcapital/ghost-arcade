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
  'managed-output',
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
  throw new Error(`managed native output never presented a frame: ${JSON.stringify(latest)}`);
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
    available: false,
    error: 'contract test uses source-frame fallback',
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
  assert(capabilities?.features?.compute_graph_source_frame_target, 'broker capabilities lost compute graph source-frame support');
  assert(capabilities?.native_graph_instruments?.length >= 9, `broker graph manifest is incomplete: ${JSON.stringify(capabilities)}`);

  const readiness = await broker.invoke('native_renderer_get_readiness_report');
  const checks = new Map((readiness?.checks ?? []).map((check) => [check.id, check]));
  for (const id of REQUIRED_CHECKS) {
    assert(checks.get(id)?.ok, `broker readiness has stale/missing ${id}: ${JSON.stringify(readiness)}`);
  }
  assert(checks.get('shared-texture-upload')?.ok === false, 'broker should report shared texture upload as unavailable until implemented');

  let unsupportedErrored = false;
  try {
    await broker.invoke('native_renderer_upload_source_gpu_shared_texture', {
      source_id: 'contract',
      width: 16,
      height: 16,
      shared_handle: 'fake',
      seq: 1,
    });
  } catch (err) {
    unsupportedErrored = /shared texture media transport is not implemented yet/.test(String(err?.message || err));
  }
  assert(unsupportedErrored, 'broker shared-texture upload unexpectedly succeeded or returned the wrong error');

  console.log(
    `Native broker contract passed: backend=${status.backend} adapter=${status.adapter_name ?? 'unknown'} graphs=${capabilities.native_graph_instruments.length}`,
  );
} finally {
  await broker.invoke('native_renderer_stop').catch(() => {});
  broker.shutdownSync();
}
