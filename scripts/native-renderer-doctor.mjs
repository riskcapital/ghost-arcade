import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createNativeRendererBroker } from '../electron/native-renderer-broker.js';

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
  'compute_graph_source_frame_target',
  'persistent_compute_buffers',
  'native_output_mirror_texture',
  'native_planet_graph',
  'native_3d_smoke_graph',
  'native_particle_field_graph',
  'native_volumetric_spheres_graph',
  'native_smoke_riders_graph',
  'native_ink_cloud_graph',
  'native_flythrough_graph',
  'native_pixel_particles_graph',
  'native_point_cloud_fx_graph',
];

function check(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) return { ok: false, detail: result.error.message };
  return {
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || '').trim().split('\n')[0] || `exit ${result.status}`,
  };
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
    const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
    const ok = !!status?.backend_ready && missingFeatures.length === 0 && missingInstruments.length === 0 && blockers.length === 0;
    return {
      ok,
      detail: [
        `backend=${status?.backend ?? 'unknown'}`,
        `adapter=${status?.adapter_name ?? 'unknown'}`,
        `graphs=${instruments.size}/${REQUIRED_GRAPH_INSTRUMENTS.length}`,
        `outputMirror=${features.native_output_mirror_texture ? 'on' : 'missing'}`,
        `mediaSharedTexture=${features.shared_texture_upload ? 'on' : 'fallback'}`,
        `sourceSharedFrame=${features.shared_texture_source_frame_upload ? 'on' : 'fallback'}`,
        `outputSharedTexture=${features.shared_texture_output_export ? 'on' : 'pending'}`,
        `nativeShareSender=${features.native_texture_share_sender ? 'on' : 'pending'}`,
        missingFeatures.length ? `missingFeatures=${missingFeatures.join(',')}` : '',
        missingInstruments.length ? `missingGraphs=${missingInstruments.join(',')}` : '',
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
  const outputExportExpected = process.platform === 'darwin';
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
    const readiness = await broker.invoke('native_renderer_get_readiness_report');
    const features = capabilities?.features ?? {};
    const checks = new Map((readiness?.checks ?? []).map((check) => [check?.id, check]));
    const directSharedRpc = capabilities?.implemented_methods?.includes('upload_source_gpu_shared_texture');
    const ok =
      !!status?.backend_ready &&
      !!features.shared_texture_output_export === outputExportExpected &&
      !!features.native_texture_share_sender === outputExportExpected &&
      !!checks.get('native-texture-share-sender')?.ok === outputExportExpected &&
      !!directSharedRpc;
    return {
      ok,
      detail: [
        `bridge=${process.platform === 'darwin' ? 'Syphon' : process.platform === 'win32' ? 'Spout' : 'unsupported'}`,
        `outputSharedTexture=${features.shared_texture_output_export ? 'on' : 'pending'}`,
        `nativeShareSender=${features.native_texture_share_sender ? 'on' : 'pending'}`,
        `directSharedTextureRpc=${directSharedRpc ? 'on' : 'missing'}`,
        `textureShareCheck=${checks.get('native-texture-share-sender')?.ok ? 'on' : 'pending'}`,
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
