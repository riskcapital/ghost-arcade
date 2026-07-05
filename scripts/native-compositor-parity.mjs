import {
  COMPOSITOR_BLEND_MODES,
  COMPOSITOR_EFFECTS,
  assertNativeCompositorBlendParity,
  assertNativeCompositorEffectParity,
  assertNativeCompositorManifest,
  assertNativeCompositorSourceContract,
  createRpcProcess,
  precompileNativeCompositorParityShaders,
} from './native-renderer-smoke.mjs';

const rpc = createRpcProcess();

try {
  assertNativeCompositorSourceContract();
  const status = await rpc.send('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: 320,
      height: 180,
      target_fps: 30,
    },
  }, 8000);
  if (!status?.backend_ready) {
    throw new Error(`native render core failed to start: ${JSON.stringify(status)}`);
  }

  const capabilities = await rpc.send('capabilities', {}, 5000);
  if (!capabilities?.features?.compute_graph_host || !capabilities?.features?.effect_descriptors) {
    throw new Error(`native compositor parity prerequisites missing: ${JSON.stringify(capabilities?.features)}`);
  }
  assertNativeCompositorManifest(capabilities);
  await precompileNativeCompositorParityShaders(rpc);

  const blendParity = await assertNativeCompositorBlendParity(rpc);
  const effectParity = await assertNativeCompositorEffectParity(rpc);
  const blendChecksum = blendParity?.readbacks?.['native-compositor-blend-output']?.checksum;
  const effectChecksum = effectParity?.readbacks?.['native-compositor-effect-output']?.checksum;
  if (!blendChecksum || !effectChecksum) {
    throw new Error(`native compositor parity probes returned no checksums: ${JSON.stringify({ blendParity, effectParity })}`);
  }

  console.log(
    [
      'Native compositor parity passed:',
      `backend=${status.backend}`,
      `adapter=${status.adapter_name ?? 'unknown'}`,
      `blends=${COMPOSITOR_BLEND_MODES.length}`,
      `effects=${COMPOSITOR_EFFECTS.length}`,
      `blendChecksum=${blendChecksum}`,
      `effectChecksum=${effectChecksum}`,
    ].join(' '),
  );
} finally {
  const stderr = await rpc.close();
  if (stderr) console.error(stderr.split('\n').slice(-12).join('\n'));
}
