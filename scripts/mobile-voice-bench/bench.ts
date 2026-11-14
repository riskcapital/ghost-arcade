// Studio voices through the phone's own renderer (StandaloneRenderer, WebGL 1)
// and the phone's voice signals (studioVoices.ts), driven by music.
//
// Modes (query string):
//   mode=measure  compile each voice, then the time of one frame at the
//                 phone's normal size (1280x720, GPU-synchronised, averaged at
//                 several points of the song) and, with fps=1, the frame rate
//                 it holds drawn on screen; plus how much of the frame is lit.
//   mode=render   play the song from the start into each voice at a fixed
//                 frame rate and capture JPEG frames at the given times.
// music=<url>     a WAV/MP3 to analyse like the phone's analyser does; without
//                 it a steady synthetic groove drives the voices.
// Results are console lines (BENCH_*) and, with report=1, posts to the runner.
import { StandaloneRenderer } from '../../src/lib/mobile/standaloneRenderer';
import { StandaloneAudio, SILENT_AUDIO, type AudioUniforms } from '../../src/lib/mobile/standaloneAudio';
import { VoiceSignals, prepareVoiceSource, type VoiceAudioFrame } from '../../src/lib/mobile/studioVoices';
import { getInputDefault, parseISF } from '../../src/lib/isf/parser';

const params = new URLSearchParams(location.search);
const MODE = params.get('mode') ?? 'measure';
const WIDTH = Number(params.get('w') ?? 1280), HEIGHT = Number(params.get('h') ?? 720);
const MOMENTS: number[] = JSON.parse(params.get('moments') ?? '[8,24,40]');
const FRAMES = Number(params.get('frames') ?? 12);
const CAPTURE: number[] = JSON.parse(params.get('at') ?? '[30]');
const SIM_FPS = Number(params.get('simfps') ?? 30);
/** Seconds per frame while playing up to a measuring point. */
const STEP = Number(params.get('step') ?? 0.1);
const realNow = performance.now.bind(performance);
let virtualMs: number | null = null;
// The renderer reads its clock from performance.now: a virtual clock lets a song play faster than real time.
performance.now = () => (virtualMs ?? realNow());

const report = (line: string) => {
  console.log(line);
  if (params.has('report')) void fetch('/__bench-result', { method: 'POST', body: line }).catch(() => {});
};
addEventListener('error', (e) => report('BENCH_ERROR ' + e.message));
addEventListener('unhandledrejection', (e) => report('BENCH_ERROR ' + String(e.reason)));

// ── The phone's analyser, offline: 1024-point FFT, Blackman window, smoothing 0.7, -100..-30 dB.
const FFT = 1024, BINS = 512;
let pcm: Float32Array | null = null, rate = 48000;
const smoothMag = new Float32Array(BINS);
const window_ = Float32Array.from({ length: FFT }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT) + 0.08 * Math.cos((4 * Math.PI * i) / FFT));
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const re = new Float32Array(FFT), im = new Float32Array(FFT);
function analyse(t: number): { spectrum: Uint8Array<ArrayBuffer>; waveform: Uint8Array<ArrayBuffer> } {
  const spectrum = new Uint8Array(new ArrayBuffer(BINS)), waveform = new Uint8Array(new ArrayBuffer(FFT));
  if (!pcm) return { spectrum, waveform };
  const end = Math.floor((t % (pcm.length / rate)) * rate);
  for (let i = 0; i < FFT; i++) { const s = pcm[(end - FFT + i + pcm.length) % pcm.length]; re[i] = s * window_[i]; im[i] = 0; waveform[i] = Math.max(0, Math.min(255, 128 + s * 128)); }
  fft(re, im);
  for (let k = 0; k < BINS; k++) {
    const mag = Math.hypot(re[k], im[k]) / FFT;
    smoothMag[k] = 0.7 * smoothMag[k] + 0.3 * mag;
    const db = 20 * Math.log10(smoothMag[k] + 1e-12);
    spectrum[k] = Math.max(0, Math.min(255, Math.round(((db + 100) * 255) / 70)));
  }
  return { spectrum, waveform };
}

// ── Without music: a steady groove at 124 BPM, kick, snare, hats, bass and a chord, as spectra.
function synthetic(t: number) {
  const spectrum = new Uint8Array(new ArrayBuffer(BINS)), waveform = new Uint8Array(new ArrayBuffer(FFT)).fill(128);
  const beat = (t * 124) / 60, ph = beat % 1, bin = (hz: number) => Math.round(hz / (rate / FFT));
  const add = (hz: number, level: number, width = 1) => { for (let d = -width; d <= width; d++) { const i = bin(hz) + d; if (i > 0 && i < BINS) spectrum[i] = Math.max(spectrum[i], Math.round(level * (1 - Math.abs(d) / (width + 1)))); } };
  for (let i = 1; i < BINS; i++) spectrum[i] = 60 + ((i * 37) % 11);
  add(60, 120 + 120 * Math.exp(-ph * 9), 2);
  add(110, 150 + 30 * Math.sin(t), 1);
  if (Math.floor(beat) % 2 === 1) for (let hz = 1800; hz < 6000; hz += 200) add(hz, 80 + 140 * Math.exp(-ph * 12));
  for (let hz = 7000; hz < 15000; hz += 300) add(hz, 70 + 120 * Math.exp(-((beat * 2) % 1) * 18));
  for (const n of [57, 60, 64, 67]) add(440 * Math.pow(2, (n - 69 + 12 * Math.floor(t / 8 % 2)) / 12), 170);
  return { spectrum, waveform };
}

// The phone's audio smoothing on top (tempo, beat phase), fed from these frames.
let frame: { spectrum: Uint8Array<ArrayBuffer>; waveform: Uint8Array<ArrayBuffer> } = synthetic(0);
const phoneAudio = new StandaloneAudio();
Object.assign(phoneAudio as unknown as Record<string, unknown>, {
  native: { frame: () => ({ sequence: 0, source: 'player', sampleRate: rate, arriving: true, ...frame }), release() {} },
  freq: new Uint8Array(new ArrayBuffer(BINS)), ready: true, source: 'player',
});

class Drive {
  voices = new VoiceSignals();
  t = 0;
  step(dt: number): { audio: AudioUniforms; voice: VoiceAudioFrame } {
    this.t += dt;
    frame = pcm ? analyse(this.t) : synthetic(this.t);
    phoneAudio.update(this.t * 1000 + 1);
    const u = phoneAudio.uniforms;
    const voice: VoiceAudioFrame = { spectrum: frame.spectrum, sampleRate: rate, bpm: u.audioBPM, beatPhase: u.audioBeatPhase };
    this.voices.update(voice, dt);
    return { audio: u, voice };
  }
}

async function load(path: string, surface: HTMLCanvasElement) {
  const source = prepareVoiceSource(await (await fetch('/' + path.split('/').map(encodeURIComponent).join('/'))).text());
  const renderer = new StandaloneRenderer(surface);
  await renderer.loadShaderSource(source, true, undefined, { flow: 0, breath: 0, glow: false });
  const inputs = parseISF(source).metadata.INPUTS ?? [];
  const defaults: Record<string, number | boolean | number[]> = {};
  for (const i of inputs) defaults[i.NAME] = getInputDefault(i);
  defaults.vxAuto = false;
  const follows = Number(defaults.vxSource ?? 0);
  return { renderer, defaults, follows, gl: (renderer as unknown as { gl: WebGLRenderingContext }).gl };
}

function stats(gl: WebGLRenderingContext, w: number, h: number) {
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let lit = 0, luma = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 61) { n++; const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; luma += y; if (y > 24) lit++; }
  return { lit: Math.round((lit / n) * 100) / 100, luma: Math.round(luma / n) };
}

async function measure(path: string) {
  const surface = document.createElement('canvas');
  surface.width = WIDTH; surface.height = HEIGHT;
  let gl: WebGLRenderingContext | undefined;
  let renderer: StandaloneRenderer | undefined;
  try {
    const loaded = await load(path, surface);
    renderer = loaded.renderer; gl = loaded.gl;
    const drive = new Drive();
    const pixel = new Uint8Array(4);
    const sync = () => gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixel);
    const frameAt = (dt: number) => {
      drive.step(dt);
      renderer!.setAudio(SILENT_AUDIO);
      renderer!.setShaderInputs({ ...loaded.defaults, ...drive.voices.inputs(loaded.follows) });
      renderer!.drawFrame(WIDTH, HEIGHT);
    };
    let total = 0, worst = 0;
    for (const moment of MOMENTS) {
      // Play up to the moment at a coarse step (state and clocks as at that point of the song).
      while (drive.t < moment) frameAt(STEP);
      for (let i = 0; i < 3; i++) frameAt(1 / 60);
      sync();
      const error = gl.getError();
      if (error !== gl.NO_ERROR) return { path, error: `GL error ${error}` };
      const start = realNow();
      for (let i = 0; i < FRAMES; i++) frameAt(1 / 60);
      gl.finish(); sync();
      const ms = (realNow() - start) / FRAMES;
      total += ms; worst = Math.max(worst, ms);
    }
    const look = stats(gl, WIDTH, HEIGHT);
    let fps: number | undefined;
    if (params.has('fps')) fps = await onScreen(path, loaded.defaults, loaded.follows);
    return { path, ms: Math.round((total / MOMENTS.length) * 100) / 100, worst: Math.round(worst * 100) / 100, ...look, fps };
  } catch (e) {
    return { path, error: e instanceof Error ? e.message.slice(0, 600) : String(e) };
  } finally {
    try { renderer?.destroy(); } catch { /* lost */ }
    (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

/** Frames a second the voice holds drawn on the visible canvas at the phone's normal size, for 2.5 s. */
async function onScreen(path: string, defaults: Record<string, number | boolean | number[]>, follows: number): Promise<number> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const source = prepareVoiceSource(await (await fetch('/' + path.split('/').map(encodeURIComponent).join('/'))).text());
  const renderer = new StandaloneRenderer(canvas);
  try {
    await renderer.loadShaderSource(source, true, undefined, { flow: 0, breath: 0, glow: false });
    const drive = new Drive();
    let frames = 0, last = realNow();
    const started = realNow();
    await new Promise<void>((done) => {
      const tick = () => {
        const now = realNow();
        drive.step(Math.min(0.1, (now - last) / 1000)); last = now;
        renderer.setShaderInputs({ ...defaults, ...drive.voices.inputs(follows) });
        renderer.drawFrame(WIDTH, HEIGHT);
        if (now - started > 500) frames++;
        if (now - started < 3000) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    return Math.round((frames / 2.5) * 10) / 10;
  } finally {
    renderer.destroy();
  }
}

async function render(path: string) {
  const surface = document.createElement('canvas');
  surface.width = WIDTH; surface.height = HEIGHT;
  const loaded = await load(path, surface);
  const drive = new Drive();
  const shots: { at: number; jpeg: string }[] = [];
  const out = document.createElement('canvas');
  out.width = WIDTH; out.height = HEIGHT;
  const ctx = out.getContext('2d')!;
  const px = new Uint8Array(WIDTH * HEIGHT * 4);
  virtualMs = 1000;
  try {
    for (const at of CAPTURE) {
      while (drive.t + 1e-6 < at) {
        const dt = 1 / SIM_FPS;
        virtualMs += dt * 1000;
        drive.step(dt);
        loaded.renderer.setShaderInputs({ ...loaded.defaults, ...drive.voices.inputs(loaded.follows) });
        loaded.renderer.drawFrame(WIDTH, HEIGHT);
      }
      loaded.gl.readPixels(0, 0, WIDTH, HEIGHT, loaded.gl.RGBA, loaded.gl.UNSIGNED_BYTE, px);
      // GL rows run bottom-up; the picture's rows top-down.
      const img = ctx.createImageData(WIDTH, HEIGHT);
      for (let y = 0; y < HEIGHT; y++) img.data.set(px.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4), y * WIDTH * 4);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
      shots.push({ at, jpeg: out.toDataURL('image/jpeg', 0.92) });
    }
    return { path, shots };
  } finally {
    virtualMs = null;
    loaded.renderer.destroy();
    (loaded.gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  }
}

(async () => {
  const musicUrl = params.get('music');
  if (musicUrl) {
    const data = await (await fetch(musicUrl)).arrayBuffer();
    const Ctx = (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext);
    const decoded = await new Ctx(1, 1, 48000).decodeAudioData(data);
    rate = decoded.sampleRate;
    pcm = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) { const ch = decoded.getChannelData(c); for (let i = 0; i < ch.length; i++) pcm[i] += ch[i] / decoded.numberOfChannels; }
  }
  let paths: string[] = params.get('paths') ? JSON.parse(params.get('paths')!) : [];
  if (!paths.length) paths = await (await fetch(params.get('list') ?? '/__bench-paths')).json();
  const gl = document.createElement('canvas').getContext('webgl');
  report('BENCH_START ' + JSON.stringify({ count: paths.length, mode: MODE, music: !!pcm, extensions: gl?.getSupportedExtensions() ?? [], renderer: gl?.getParameter(gl.RENDERER), units: gl?.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) }));
  (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  for (const path of paths) {
    const result = MODE === 'render' ? await render(path).catch((e) => ({ path, error: String(e).slice(0, 600) })) : await measure(path);
    report('BENCH_ONE ' + JSON.stringify(result));
    await new Promise((r) => setTimeout(r, 30));
  }
  report('BENCH_DONE');
})();
