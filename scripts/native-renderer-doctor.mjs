import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createNativeRendererBroker } from '../electron/native-renderer-broker.js';
import {
  COMPOSITOR_BLEND_MODES,
  COMPOSITOR_EFFECTS,
  assertNativeCompositorBlendParity,
  assertNativeCompositorEffectParity,
  assertNativeCompositorManifest,
  precompileNativeCompositorParityShaders,
} from './native-renderer-smoke.mjs';

const root = process.cwd();
const bin = join(root, 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const REQUIRED_GRAPH_INSTRUMENTS = [
  'planet',
  'smoke-3d',
  'particle-field',
  'volumetric-spheres',
  'smoke-riders',
  'ink-cloud',
  'flythrough',
  'pixel-particles',
  'point-cloud-fx',
];
const REQUIRED_FEATURES = [
  'compute_graph_host',
  'compute_graph_render',
  'compute_graph_multi_render',
  'compute_graph_instanced_render',
  'compute_graph_indirect_render',
  'compute_graph_texture_sampling',
  'compute_graph_depth_render',
  'compute_graph_line_render',
  'compute_graph_clear_color',
  'compute_graph_source_frame_target',
  'persistent_compute_buffers',
  'native_output_mirror_texture',
  'native_frame_export',
  'native_frame_sequence_export',
  'native_planet_graph',
  'native_3d_smoke_graph',
  'native_particle_field_graph',
  'native_volumetric_spheres_graph',
  'native_smoke_riders_graph',
  'native_ink_cloud_graph',
  'native_flythrough_graph',
  'native_pixel_particles_graph',
  'native_point_cloud_fx_graph',
  'native_stage3d_textured_mesh_preview',
  'native_stage3d_primitive_meshes',
  'native_stage3d_xyz_mesh_transforms',
  'native_stage3d_lighting_preview',
  'native_stage3d_output_renderer',
  'native_stage3d_recording_parity',
  'native_stage3d',
  'native_projection_sim_mesh_preview',
  'native_projection_sim_textured_mesh_preview',
  'native_projection_sim_xyz_mesh_transforms',
  'native_projection_sim_output_renderer',
  'native_projection_sim_recording_parity',
  'native_projection_sim',
];

function check(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) return { ok: false, detail: result.error.message };
  return {
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`,
  };
}

function formatBlockers(blockers) {
  if (!Array.isArray(blockers) || blockers.length === 0) return '';
  return blockers
    .map((blocker) => String(blocker || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}

function directCoreNativeShareSenderState(features = {}) {
  if (features.native_texture_share_sender) return 'on';
  if (features.shared_texture_output_export) return 'electron-bridge';
  return 'pending';
}

function createRpcProcess() {
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
      // Process may already be gone after a startup failure.
    }
    child.kill();
    return stderr.trim();
  };

  return { send, close };
}

async function inspectCore() {
  if (!existsSync(bin)) {
    return { ok: false, detail: 'render-core binary missing' };
  }
  const rpc = createRpcProcess();
  try {
    const status = await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    }, 12000);
    const capabilities = await rpc.send('capabilities', {}, 5000);
    const readiness = await rpc.send('readiness', {}, 5000);
    const features = capabilities?.features ?? {};
    const instruments = new Set(capabilities?.native_graph_instruments ?? []);
    const missingFeatures = REQUIRED_FEATURES.filter((feature) => !features[feature]);
    const missingInstruments = REQUIRED_GRAPH_INSTRUMENTS.filter((instrument) => !instruments.has(instrument));
    const proxyFallbackDisabled = features.native_instrument_proxies === false;
    const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
    assertNativeCompositorManifest(capabilities);
    await precompileNativeCompositorParityShaders(rpc);
    const blendParity = await assertNativeCompositorBlendParity(rpc);
    const effectParity = await assertNativeCompositorEffectParity(rpc);
    const blendParityChecksum = blendParity?.readbacks?.['native-compositor-blend-output']?.checksum;
    const effectParityChecksum = effectParity?.readbacks?.['native-compositor-effect-output']?.checksum;
    if (!blendParityChecksum || !effectParityChecksum) {
      throw new Error(`native compositor parity probes returned no checksums: ${JSON.stringify({ blendParity, effectParity })}`);
    }
    const ok =
      !!status?.backend_ready &&
      missingFeatures.length === 0 &&
      missingInstruments.length === 0 &&
      proxyFallbackDisabled &&
      blockers.length === 0;
    return {
      ok,
      detail: [
        `backend=${status?.backend ?? 'unknown'}`,
        `adapter=${status?.adapter_name ?? 'unknown'}`,
        `graphs=${instruments.size}/${REQUIRED_GRAPH_INSTRUMENTS.length}`,
        `graphHost=${features.compute_graph_host ? 'on' : 'missing'}`,
        `graphMultiRender=${features.compute_graph_multi_render ? 'on' : 'missing'}`,
        `graphInstancing=${features.compute_graph_instanced_render ? 'on' : 'missing'}`,
        `graphIndirect=${features.compute_graph_indirect_render ? 'on' : 'missing'}`,
        `graphTextureSampling=${features.compute_graph_texture_sampling ? 'on' : 'missing'}`,
        `graphDepth=${features.compute_graph_depth_render ? 'on' : 'missing'}`,
        `graphLines=${features.compute_graph_line_render ? 'on' : 'missing'}`,
        `graphClearColor=${features.compute_graph_clear_color ? 'on' : 'missing'}`,
        `proxyFallback=${proxyFallbackDisabled ? 'off' : 'on'}`,
        `outputFormat=${status?.output_format ?? 'unknown'}`,
        `outputMirror=${features.native_output_mirror_texture ? 'on' : 'missing'}`,
        `frameExport=${features.native_frame_export ? 'on' : 'missing'}`,
        `frameSequence=${features.native_frame_sequence_export ? 'on' : 'missing'}`,
        `staticImageDecode=${features.native_static_image_decode ? 'native' : 'fallback'}`,
        `staticImagePrefetch=${features.native_static_image_prefetch ? 'native' : 'fallback'}`,
        `normalMediaDecode=${features.native_media_decode ? 'native' : features.native_static_image_decode ? 'static-native/video-source-frame' : 'source-frame-fallback'}`,
        `videoFrameWindow=${features.native_video_frame_prefetch_window ? 'on' : 'pending'}`,
        `mediaSourceClock=${features.native_media_source_playback_state ? 'on' : 'pending'}`,
        `videoDecodePump=${features.native_video_decode_pump ? 'on' : 'pending'}`,
        `pumpWindow=${features.native_video_decode_pump_window ? 'on' : 'pending'}`,
        `liveSharedFrameImport=${features.shared_texture_source_frame_upload ? 'on' : 'fallback'}`,
        `fullMediaSharedTexture=${features.shared_texture_upload ? 'on' : 'pending'}`,
        `compositorParity=${COMPOSITOR_BLEND_MODES.length}b/${COMPOSITOR_EFFECTS.length}fx`,
        `blendParity=${blendParityChecksum}`,
        `effectParity=${effectParityChecksum}`,
        `outputSharedTexture=${features.shared_texture_output_export ? 'on' : 'pending'}`,
        `nativeShareSender=${directCoreNativeShareSenderState(features)}`,
        missingFeatures.length ? `missingFeatures=${missingFeatures.join(',')}` : '',
        missingInstruments.length ? `missingGraphs=${missingInstruments.join(',')}` : '',
        proxyFallbackDisabled ? '' : 'legacyProxyFallback=enabled',
        blockers.length ? `blockers=${blockers.join('|')}` : '',
      ].filter(Boolean).join(' '),
    };
  } finally {
    await rpc.close();
  }
}

async function inspectAppBridge() {
  if (!existsSync(bin)) {
    return { ok: false, detail: 'render-core binary missing' };
  }
  const fullNativeExpected = process.platform === 'darwin' || process.platform === 'win32';
  const outputExportExpected = fullNativeExpected;
  const broker = createNativeRendererBroker({
    appRoot: root,
    resourcesPath: null,
    isPackaged: false,
    platform: process.platform,
    env: process.env,
    textureShareStatusProvider: () => ({
      platform: process.platform === 'darwin' ? 'syphon' : 'spout',
      label: process.platform === 'darwin' ? 'Syphon' : 'Spout',
      available: process.platform === 'darwin',
      error: process.platform === 'darwin' ? null : 'native texture-share sender bridge is pending on this platform',
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

  try {
    const status = await broker.invoke('native_renderer_start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    });
    const capabilities = await broker.invoke('native_renderer_get_capabilities');
    const decodeCapabilities = await broker.invoke('native_renderer_get_decode_capabilities');
    const readiness = await broker.invoke('native_renderer_get_readiness_report');
    const features = capabilities?.features ?? {};
    const effectPassDescriptors = Array.isArray(capabilities?.native_effect_pass_descriptors)
      ? capabilities.native_effect_pass_descriptors
      : [];
    const checks = new Map((readiness?.checks ?? []).map((check) => [check?.id, check]));
    const directSharedRpc = capabilities?.implemented_methods?.includes('upload_source_gpu_shared_texture');
    const nativeOutputDriverReady = !!(
      checks.get('native-output-driver')?.ok &&
      readiness?.modes?.output_driver?.ok
    );
    const fullV2Ready = !!readiness?.modes?.full_v2?.ok;
    const fullV2Blockers = readiness?.modes?.full_v2?.blockers ?? [];
    const fullV2BlockerDetail = formatBlockers(fullV2Blockers);
    const ok =
      !!status?.backend_ready &&
      !!features.shared_texture_output_export === outputExportExpected &&
      !!features.native_texture_share_sender === outputExportExpected &&
      !!features.native_mp4_frame_encoder &&
      !!features.native_recording &&
      nativeOutputDriverReady &&
      fullV2Ready === fullNativeExpected &&
      !!checks.get('native-texture-share-sender')?.ok === outputExportExpected &&
      !!checks.get('native-mp4-frame-encoder')?.ok &&
      !!directSharedRpc;
    return {
      ok,
      detail: [
        `bridge=${process.platform === 'darwin' ? 'Syphon' : process.platform === 'win32' ? 'Spout' : 'unsupported'}`,
        `outputFormat=${status?.output_format ?? 'unknown'}`,
        `decodeBackend=${status?.decode_backend ?? 'unknown'}`,
        `outputSharedTexture=${features.shared_texture_output_export ? 'on' : 'pending'}`,
        `nativeShareSender=${features.native_texture_share_sender ? 'on' : 'pending'}`,
        `nativeMp4Encoder=${features.native_mp4_frame_encoder ? 'on' : 'missing'}`,
        `effectPass=${features.native_effect_pass_manifest ? `${effectPassDescriptors.length}fx` : 'pending'}`,
        `frameExport=${features.native_frame_export ? 'on' : 'missing'}`,
        `shadowMode=${readiness?.modes?.shadow?.ok ? 'on' : 'pending'}`,
        `outputDriver=${nativeOutputDriverReady ? 'on' : 'pending'}`,
        `outputActive=${readiness?.modes?.output_active?.ok ? 'on' : 'idle'}`,
        `fullV2Required=${fullNativeExpected ? 'yes' : 'no'}`,
        `fullV2=${readiness?.modes?.full_v2?.ok ? 'ready' : `pending(${fullV2Blockers.length})`}`,
        fullV2BlockerDetail ? `fullV2Blockers="${fullV2BlockerDetail}"` : '',
        `stage3dSceneIngest=${features.native_stage3d_scene_ingest ? 'on' : 'pending'}`,
        `stage3dOverlayPreview=${features.native_stage3d_overlay_preview ? 'on' : 'pending'}`,
        `stage3dMeshPreview=${features.native_stage3d_mesh_preview ? 'on' : 'pending'}`,
        `stage3dTexturedMeshPreview=${features.native_stage3d_textured_mesh_preview ? 'on' : 'pending'}`,
        `stage3dPrimitiveMeshes=${features.native_stage3d_primitive_meshes ? 'on' : 'pending'}`,
        `stage3dTransforms=${features.native_stage3d_xyz_mesh_transforms ? 'xyz' : 'pending'}`,
        `stage3dLighting=${features.native_stage3d_lighting_preview ? 'on' : 'pending'}`,
        `stage3dRenderer=${features.native_stage3d_output_renderer ? 'on' : 'pending'}`,
        `stage3dRecordingParity=${features.native_stage3d_recording_parity ? 'on' : 'pending'}`,
        `projectionSceneIngest=${features.native_projection_sim_scene_ingest ? 'on' : 'pending'}`,
        `projectionOverlayPreview=${features.native_projection_sim_overlay_preview ? 'on' : 'pending'}`,
        `projectionMeshPreview=${features.native_projection_sim_mesh_preview ? 'on' : 'pending'}`,
        `projectionTexturedMeshPreview=${features.native_projection_sim_textured_mesh_preview ? 'on' : 'pending'}`,
        `projectionTransforms=${features.native_projection_sim_xyz_mesh_transforms ? 'xyz' : 'pending'}`,
        `projectionRenderer=${features.native_projection_sim_output_renderer ? 'on' : 'pending'}`,
        `projectionRecordingParity=${features.native_projection_sim_recording_parity ? 'on' : 'pending'}`,
        `staticImageDecode=${features.native_static_image_decode ? 'native' : 'fallback'}`,
        `staticImagePrefetch=${features.native_static_image_prefetch ? 'native' : 'fallback'}`,
        `normalMediaDecode=${features.native_media_decode ? 'native' : features.native_static_image_decode ? 'static-native/video-source-frame' : 'source-frame-fallback'}`,
        `videoFramePrefetch=${decodeCapabilities?.native_video_frame_prefetch ? 'on' : 'pending'}`,
        `videoFrameWindow=${decodeCapabilities?.native_video_frame_prefetch_window ? 'on' : 'pending'}`,
        `mediaSourceClock=${features.native_media_source_playback_state ? 'on' : 'pending'}`,
        `videoDecodePump=${decodeCapabilities?.native_video_decode_pump ? 'on' : 'pending'}`,
        `pumpWindow=${decodeCapabilities?.native_video_decode_pump_window ? 'on' : 'pending'}`,
        `liveSharedFrameImport=${features.shared_texture_source_frame_upload ? 'on' : 'fallback'}`,
        `directSharedTextureRpc=${directSharedRpc ? 'on' : 'missing'}`,
        `textureShareCheck=${checks.get('native-texture-share-sender')?.ok ? 'on' : 'pending'}`,
        `recordingCheck=${checks.get('native-mp4-frame-encoder')?.ok ? 'on' : 'pending'}`,
      ].join(' '),
    };
  } finally {
    await broker.invoke('native_renderer_stop').catch(() => {});
    broker.shutdownSync();
  }
}

const cargo = check('cargo', ['--version']);
const rustc = check('rustc', ['--version']);
const binary = existsSync(bin);

console.log('Ghost Native Renderer Doctor');
console.log(`cargo: ${cargo.ok ? 'ok' : 'missing'} ${cargo.detail}`);
console.log(`rustc: ${rustc.ok ? 'ok' : 'missing'} ${rustc.detail}`);
console.log(`render-core binary: ${binary ? 'ok' : 'missing'} ${bin}`);

let core = { ok: false, detail: 'skipped' };
let appBridge = { ok: false, detail: 'skipped' };
if (binary) {
  try {
    core = await inspectCore();
  } catch (err) {
    core = { ok: false, detail: err?.message || String(err) };
  }
  console.log(`render-core capability/readiness: ${core.ok ? 'ok' : 'failed'} ${core.detail}`);

  try {
    appBridge = await inspectAppBridge();
  } catch (err) {
    appBridge = { ok: false, detail: err?.message || String(err) };
  }
  console.log(`electron bridge capability/readiness: ${appBridge.ok ? 'ok' : 'failed'} ${appBridge.detail}`);
}

if (!cargo.ok || !rustc.ok || !binary || !core.ok || !appBridge.ok) process.exitCode = 1;
