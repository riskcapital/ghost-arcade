import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

// A supported host with a built core must pass real hardware checks. Decoder,
// driver, codec-extension and GPU failures must not become runtime skips.
const windows = process.platform === 'win32';
// Linux has no hardware video decode or shared-texture path, so the suites
// that need those cannot pass there and Linux stays off by default. The
// render-and-read-back suites do run on Vulkan: GA_NATIVE_TESTS_LINUX=1 opts
// a Linux host in, for checking the core there (pick the suites to run).
const linux = process.platform === 'linux' && process.env.GA_NATIVE_TESTS_LINUX === '1';
const binary = join(process.cwd(), 'native-renderer/target/release',
  windows ? 'ghost-render-core.exe' : 'ghost-render-core');

// Geometry/compositing tests also run on Linux Vulkan (including CI lavapipe).
// Keep hardware-decoder tests separate: Linux uses the software decode path.
export const gpuTestPlatform = {
  windows,
  binary,
  runnable: ['win32', 'darwin', 'linux'].includes(process.platform) && existsSync(binary),
  rendererBackend: windows ? 'd3d12' : process.platform === 'darwin' ? 'metal' : 'vulkan',
};

// CI's Linux runner has no GPU: lavapipe renders about one frame a second and
// answers RPCs between frames. Tests that measure the core against real time
// (a fixed RPC deadline, "the picture changed within N ms", a warm video grid)
// cannot pass there and are skipped by name; everything else still runs.
export const softwareVulkanRunner = process.env.GA_TEST_SOFTWARE_VULKAN === '1';
/** RPC deadlines in the runtime tests are tuned for a GPU; stretch them there. */
export const rpcDeadlineScale = softwareVulkanRunner ? 4 : 1;

export const hardwareTestPlatform = {
  windows,
  linux,
  binary,
  runnable: (windows || process.platform === 'darwin' || linux) && existsSync(binary),
  rendererBackend: windows ? 'd3d12' : linux ? 'vulkan' : 'metal',
  decoderBackend: windows ? 'media-foundation' : 'videotoolbox',
  uploadTransport: windows ? 'native-video-dxgi' : 'native-video-iosurface',
  label: windows ? 'Media Foundation / D3D12' : linux ? 'Vulkan (no hardware video)' : 'VideoToolbox / Metal',
};

// Windows keeps fixture files locked until the decoder process has exited.
export async function closeNativeTestCore(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      child.off('exit', done);
      resolve();
    };
    const timer = setTimeout(done, 2000);
    child.once('exit', done);
    child.kill();
  });
}
