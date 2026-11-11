import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Under the native driver only the editor window sends to LED controllers
 * (WLED and Art-Net/sACN). The Stage Sim and output windows mount the same
 * Canvas; a sender there sent its own frames to the same controllers
 * (without the Timeline's LED rows, which only the editor runs) and read a
 * 1280 px Stage Sim feed back from the GPU every frame to do it.
 */
const canvasSource = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'Canvas.svelte'), 'utf8').replace(/\r\n/g, '\n');

describe('LED senders run in the editor window only', () => {
  it('gates the native WLED mirror and the pixel-map output on the editor window', () => {
    const at = canvasSource.indexOf('const ledSender = !isOsrMode && !isOutputMode;');
    expect(at).toBeGreaterThan(-1);
    const block = canvasSource.slice(at, canvasSource.indexOf('canvas.addEventListener(\'mousemove\'', at));
    expect(block).toMatch(/const wantsWled = ledSender && /);
    expect(block).toMatch(/if \(ledSender\) nativeTeardownCallbacks\.push\(startPixelMapOutput\(\)\);/);
    // The mirror for the senders is the senders' size, not a large feed.
    expect(block).toMatch(/acquireNativeCompositeMirror\(\{ maxDim: 192, fps: 20,/);
  });
});
