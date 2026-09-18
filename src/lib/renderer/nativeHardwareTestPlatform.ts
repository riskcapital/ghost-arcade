import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

// A supported host with a built core must pass real hardware checks. Decoder,
// driver, codec-extension and GPU failures must not become runtime skips.
const windows = process.platform === 'win32';
const binary = join(process.cwd(), 'native-renderer/target/release',
  windows ? 'ghost-render-core.exe' : 'ghost-render-core');

export const hardwareTestPlatform = {
  windows,
  binary,
  runnable: (windows || process.platform === 'darwin') && existsSync(binary),
  rendererBackend: windows ? 'd3d12' : 'metal',
  decoderBackend: windows ? 'media-foundation' : 'videotoolbox',
  uploadTransport: windows ? 'native-video-dxgi' : 'native-video-iosurface',
  label: windows ? 'Media Foundation / D3D12' : 'VideoToolbox / Metal',
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
