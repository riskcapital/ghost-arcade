// Runs each mobile shader through the phone's own renderer (StandaloneRenderer,
// WebGL 1) with the audio patches active and a live, moving audio signal,
// and reports compile errors and the GPU time of one 1280x720 frame.
// Driven by scripts/mobile-shader-bench.mjs; results go to the console.
import { StandaloneRenderer } from '../../src/lib/mobile/standaloneRenderer';
import { SILENT_AUDIO } from '../../src/lib/mobile/standaloneAudio';
import { MOBILE_SHADERS } from '../../src/lib/mobile/standaloneShaderList';

const params = new URLSearchParams(location.search);
const WIDTH = 1280, HEIGHT = 720, WARM = 2, FRAMES = 8;
// Many shaders cost more or less as their animation moves (a camera flying
// through a scene): measure at several points of the timeline and average.
const MOMENTS: number[] = params.get('moments') ? JSON.parse(params.get('moments')!) : [0, 13, 37, 91];
const FRAME_COUNT = Number(params.get('frames') ?? FRAMES);
const paths: string[] = JSON.parse(decodeURIComponent(params.get('paths') ?? '[]'));
const canvas = document.getElementById('c') as HTMLCanvasElement;

function sync(gl: WebGLRenderingContext) {
  const pixel = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

/** Share of the frame that is not black: a broken or empty render shows up as ~0. */
function litShare(gl: WebGLRenderingContext): number {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let lit = 0, count = 0;
  for (let i = 0; i < pixels.length; i += 4 * 97) { count++; if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 24) lit++; }
  return lit / count;
}

async function measure(path: string): Promise<{ path: string; ms?: number; lit?: number; error?: string }> {
  // A fresh canvas and context per shader, so one bad shader cannot poison the next.
  const surface = document.createElement('canvas');
  surface.width = WIDTH; surface.height = HEIGHT;
  const renderer = new StandaloneRenderer(surface);
  const gl = (renderer as unknown as { gl: WebGLRenderingContext }).gl;
  try {
    const source = await (await fetch('/' + path.split('/').map(encodeURIComponent).join('/'))).text();
    const entry = MOBILE_SHADERS.find(s => s.path === path);
    const native = entry?.audioNative ?? /\baudio(Bass|Mid|High|Level|Beat)\b/.test(source);
    await renderer.loadShaderSource(source, native, entry?.audioInject, entry?.motion);
    let t = 0, total = 0;
    const audio = (k: number) => ({ ...SILENT_AUDIO, listening: true, audioBass: 0.5 + 0.4 * Math.sin(k), audioMid: 0.5, audioHigh: 0.4, audioLevel: 0.55, audioBeat: Math.max(0, Math.sin(k * 3)), audioFlow: 0.6 });
    const clock = renderer as unknown as { scaledTime: number };
    for (const moment of MOMENTS) {
      clock.scaledTime = moment;
      for (let i = 0; i < WARM; i++) { renderer.setAudio(audio(t += 0.1)); renderer.drawFrame(WIDTH, HEIGHT); }
      sync(gl);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) return { path, error: `GL error ${error}` };
      const start = performance.now();
      for (let i = 0; i < FRAME_COUNT; i++) { renderer.setAudio(audio(t += 0.1)); renderer.drawFrame(WIDTH, HEIGHT); }
      gl.finish(); sync(gl);
      total += (performance.now() - start) / FRAME_COUNT;
    }
    return { path, ms: total / MOMENTS.length, lit: Math.round(litShare(gl) * 100) / 100 };
  } catch (e) {
    return { path, error: e instanceof Error ? e.message.slice(0, 400) : String(e) };
  } finally {
    renderer.destroy();
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

(async () => {
  void canvas;
  const results = [];
  for (const path of paths) {
    const result = await measure(path);
    results.push(result);
    console.log('BENCH_ONE ' + JSON.stringify(result));
    await new Promise(r => setTimeout(r, 0));
  }
  console.log('BENCH_DONE ' + JSON.stringify(results));
})();
