// Pixel checks for the native ISF pass host: multi-pass PASSES (persistent
// feedback, FLOAT targets, $WIDTH/$HEIGHT sizes, PASSINDEX) and live audio
// rows (audioFFT / audio inputs honouring MAX). Drives the real render core
// over RPC, renders frames explicitly with the live loop frozen so every
// feedback step is counted, and reads back the shader's own slot plus the
// composed output frame.
//
//   npm run native:isf-multipass
import { createRpcProcess } from './native-renderer-smoke.mjs';

const W = 320;
const H = 180;
const FULLSCREEN = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

const ACCUMULATE = `/*{
  "ISFVSN": "2",
  "INPUTS": [ { "NAME": "stepSize", "TYPE": "float", "DEFAULT": 0.1 } ],
  "PASSES": [ { "TARGET": "accum", "PERSISTENT": true }, {} ]
}*/
void main() {
  if (PASSINDEX == 0) {
    vec4 prev = IMG_NORM_PIXEL(accum, isf_FragNormCoord);
    gl_FragColor = vec4(min(prev.rgb + vec3(stepSize), vec3(1.0)), 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(accum, isf_FragNormCoord);
  }
}`;

// A dot sweeping left->right leaves a decaying trail in a persistent buffer.
const TRAIL = `/*{
  "ISFVSN": "2",
  "INPUTS": [ { "NAME": "decay", "TYPE": "float", "DEFAULT": 0.8 } ],
  "PASSES": [ { "TARGET": "trail", "PERSISTENT": true }, {} ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    vec2 dot = vec2(0.1 + 0.1 * TIME, 0.5);
    float d = length((uv - dot) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0));
    float ink = d < 0.04 ? 1.0 : 0.0;
    float prev = IMG_NORM_PIXEL(trail, uv).r * decay;
    gl_FragColor = vec4(vec3(max(prev, ink)), 1.0);
  } else {
    gl_FragColor = IMG_NORM_PIXEL(trail, uv);
  }
}`;

// Three passes: a half-size target (records its RENDERSIZE), a FLOAT target
// holding 3.0, and the output reading both plus IMG_SIZE.
const PLAN = `/*{
  "ISFVSN": "2",
  "INPUTS": [],
  "PASSES": [
    { "TARGET": "half", "WIDTH": "$WIDTH/2", "HEIGHT": "$HEIGHT/2" },
    { "TARGET": "fbuf", "FLOAT": true },
    {}
  ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    gl_FragColor = vec4(RENDERSIZE / 1000.0, 0.25, 1.0);
  } else if (PASSINDEX == 1) {
    gl_FragColor = vec4(0.0, 3.0 * float(PASSINDEX), 0.0, 1.0);
  } else {
    float halfWidth = IMG_NORM_PIXEL(half, uv).r;
    float floatValue = IMG_NORM_PIXEL(fbuf, uv).g / 4.0;
    float halfHeightFromSize = IMG_SIZE(half).y / 180.0;
    gl_FragColor = vec4(halfWidth, floatValue, halfHeightFromSize, 1.0);
  }
}`;

// 8 spectrum bars from an audioFFT input with MAX 8; green encodes the
// FFT row width the host bound (IMG_SIZE), blue the waveform row width.
const SPECTRUM = `/*{
  "ISFVSN": "2",
  "INPUTS": [
    { "NAME": "spectrum", "TYPE": "audioFFT", "MAX": 8 },
    { "NAME": "wave", "TYPE": "audio", "MAX": 64 }
  ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  float bin = floor(uv.x * 8.0);
  float mag = IMG_PIXEL(spectrum, vec2(bin + 0.5, 0.5)).r;
  float bar = uv.y < mag ? 1.0 : 0.0;
  gl_FragColor = vec4(bar, IMG_SIZE(spectrum).x / 255.0, IMG_SIZE(wave).x / 255.0, 1.0);
}`;

// Waveform row plus the built-in sampleWaveform() helper.
const WAVEFORM = `/*{
  "ISFVSN": "2",
  "INPUTS": [ { "NAME": "wave", "TYPE": "audio", "MAX": 64 } ]
}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  gl_FragColor = vec4(IMG_NORM_PIXEL(wave, vec2(uv.x, 0.5)).r, sampleWaveform(uv.x) * 0.5 + 0.5, 0.0, 1.0);
}`;

function fail(message) {
  throw new Error(message);
}

function near(actual, expected, tolerance, label) {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    fail(`${label}: expected ${expected.toFixed(4)} +/- ${tolerance}, got ${actual.toFixed(4)}`);
  }
}

class Checker {
  constructor(rpc) {
    this.rpc = rpc;
    this.results = [];
  }

  async commands(commands, timeout = 12000) {
    await this.rpc.send('submit_commands', { commands }, timeout);
  }

  async precompile(shaderId, source) {
    const before = await this.rpc.send('status', {}, 5000);
    await this.commands([{ type: 'precompile_shader', shader_id: shaderId, stage: 'pixel', entry: 'main', source }]);
    const after = await this.rpc.send('status', {}, 5000);
    if (Number(after.shader_precompile_compiled) <= Number(before.shader_precompile_compiled)) {
      fail(`${shaderId} failed to precompile: ${after.last_shader_error}`);
    }
  }

  async bind(layerId, shaderId) {
    await this.commands([
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
    ]);
  }

  async render(layerId, shaderId, { time = 0, width = W, height = H, floats = {} } = {}) {
    await this.commands([
      {
        type: 'update_isf_uniforms',
        shader_id: shaderId,
        time,
        time_delta: 1 / 30,
        frame_index: Math.round(time * 30),
        render_width: width,
        render_height: height,
        float_inputs: floats,
        point_inputs: {},
        color_inputs: {},
      },
      { type: 'render_isf_to_layer', layer_id: layerId },
    ]);
    const status = await this.rpc.send('status', {}, 5000);
    if (String(status.last_shader_error || '').includes(shaderId)) {
      fail(`${shaderId} render error: ${status.last_shader_error}`);
    }
  }

  /** The shader's own slot, RGBA8 top-down, downscaled to `maxDim`. */
  async slot(layerId, maxDim = 64) {
    const snap = await this.rpc.send('frame_snapshot', { layer_id: layerId, max_dim: maxDim }, 12000);
    const bytes = Buffer.from(snap.rgba_b64, 'base64');
    const width = Number(snap.width);
    const height = Number(snap.height);
    const stride = Number(snap.padded_bytes_per_row || snap.bytes_per_row || width * 4);
    const px = (u, v, channel = 0) => {
      // u,v in ISF convention (0,0 bottom-left); rows are top-down.
      const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
      const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
      return bytes[y * stride + x * 4 + channel] / 255;
    };
    const columnFill = (u, channel = 0) => {
      const x = Math.min(width - 1, Math.floor(u * width));
      let lit = 0;
      for (let y = 0; y < height; y += 1) if (bytes[y * stride + x * 4 + channel] > 127) lit += 1;
      return lit / height;
    };
    const mean = (channel = 0) => {
      let sum = 0;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) sum += bytes[y * stride + x * 4 + channel];
      return sum / (width * height * 255);
    };
    return { px, columnFill, mean, width, height };
  }

  /** The composed native output frame (what the projector gets). The
   *  checks run with the live loop frozen (so each feedback step is an
   *  explicit render); unfreeze briefly so the output is really composed by
   *  the live render loop, then freeze again. */
  async output(waitMs = 120) {
    await this.rpc.send('set_output_state', { frozen: false }, 5000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const snap = await this.rpc.send('frame_snapshot', { include_pixels: false }, 12000);
    await this.rpc.send('set_output_state', { frozen: true }, 5000);
    return { luma: Number(snap.average_luma), nonzero: Number(snap.nonzero_pixels), checksum: snap.checksum };
  }

  pass(name, detail) {
    this.results.push({ name, detail });
    console.log(`ok - ${name}: ${detail}`);
  }
}

async function checkAccumulation(c) {
  await c.precompile('mp-accum', ACCUMULATE);
  await c.bind('L-accum', 'mp-accum');
  const values = [];
  for (let frame = 1; frame <= 5; frame += 1) {
    await c.render('L-accum', 'mp-accum', { time: frame / 30 });
    values.push((await c.slot('L-accum')).mean(0));
  }
  // 8-bit persistent target: +0.1 per frame quantises to +26/255.
  values.forEach((value, index) => near(value, ((index + 1) * 26) / 255, 0.012, `accumulate frame ${index + 1}`));
  c.pass('persistent buffer accumulates one step per rendered frame', `slot mean ${values.map((v) => v.toFixed(3)).join(' -> ')}`);

  // Reload (re-precompile the same shader id) resets persistent buffers.
  await c.precompile('mp-accum', ACCUMULATE);
  await c.render('L-accum', 'mp-accum', { time: 6 / 30 });
  const afterReload = (await c.slot('L-accum')).mean(0);
  near(afterReload, 26 / 255, 0.012, 'after reload');
  await c.render('L-accum', 'mp-accum', { time: 7 / 30 });
  const secondAfterReload = (await c.slot('L-accum')).mean(0);
  near(secondAfterReload, 52 / 255, 0.012, 'second frame after reload');
  c.pass('reload resets persistent buffers', `${values.at(-1).toFixed(3)} -> ${afterReload.toFixed(3)} -> ${secondAfterReload.toFixed(3)}`);

  // Output resize (new render size) resets them too.
  await c.render('L-accum', 'mp-accum', { time: 8 / 30, width: 640, height: 360 });
  const afterResize = (await c.slot('L-accum')).mean(0);
  near(afterResize, 26 / 255, 0.012, 'after resize');
  c.pass('resize resets persistent buffers', `${secondAfterReload.toFixed(3)} -> ${afterResize.toFixed(3)}`);

  // Live loop: with a small step the composed native output keeps getting
  // brighter frame after frame (the buffer survives across live frames).
  await c.precompile('mp-accum', ACCUMULATE);
  await c.render('L-accum', 'mp-accum', { time: 9 / 30, floats: { stepSize: 0.01 } });
  const lumas = [];
  for (let sample = 0; sample < 5; sample += 1) lumas.push((await c.output(150)).luma);
  for (let index = 1; index < lumas.length; index += 1) {
    if (!(lumas[index] > lumas[index - 1])) fail(`native output luma did not rise across live frames: ${lumas.join(', ')}`);
  }
  if (!(lumas[0] < 0.9)) fail(`live accumulation started saturated: ${lumas[0]}`);
  c.pass('native output accumulates across live frames', `output luma ${lumas.map((v) => v.toFixed(3)).join(' -> ')}`);
  const status = await c.rpc.send('status', {}, 5000);
  await c.commands([{ type: 'remove_layer', layer_id: 'L-accum' }]);
  return status;
}

async function checkTrail(c) {
  await c.precompile('mp-trail', TRAIL);
  await c.bind('L-trail', 'mp-trail');
  const frames = 6;
  for (let frame = 0; frame < frames; frame += 1) {
    await c.render('L-trail', 'mp-trail', { time: frame, floats: { decay: 0.8 } });
  }
  const s = await c.slot('L-trail', 128);
  // Dot centres: x = 0.1 + 0.1 * t for t = 0..5; the head is at 0.6.
  const head = s.px(0.6, 0.5);
  const oneBack = s.px(0.5, 0.5);
  const fourBack = s.px(0.2, 0.5);
  const untouched = s.px(0.9, 0.5);
  const offRow = s.px(0.3, 0.9);
  near(head, 1, 0.02, 'trail head');
  near(oneBack, 0.8, 0.03, 'trail one frame back');
  near(fourBack, 0.8 ** 4, 0.03, 'trail four frames back');
  near(untouched, 0, 0.01, 'trail ahead of the dot');
  near(offRow, 0, 0.01, 'trail off the dot row');
  const out = await c.output();
  if (!(out.nonzero > 0)) fail('trail output frame is blank');
  c.pass('feedback trail decays per frame', `head ${head.toFixed(3)}, -1 ${oneBack.toFixed(3)}, -4 ${fourBack.toFixed(3)} (0.8^4=${(0.8 ** 4).toFixed(3)}), ahead ${untouched.toFixed(3)}; output nonzero=${out.nonzero}`);
  await c.commands([{ type: 'remove_layer', layer_id: 'L-trail' }]);
}

async function checkPlan(c) {
  await c.precompile('mp-plan', PLAN);
  await c.bind('L-plan', 'mp-plan');
  await c.render('L-plan', 'mp-plan', { time: 1 });
  const s = await c.slot('L-plan');
  const r = s.px(0.5, 0.5, 0);
  const g = s.px(0.5, 0.5, 1);
  const b = s.px(0.5, 0.5, 2);
  near(r, 0.16, 0.006, 'pass 0 RENDERSIZE.x from $WIDTH/2');
  near(g, 0.75, 0.006, 'FLOAT target keeps 3.0 (8-bit would clamp to 0.25)');
  near(b, 0.5, 0.006, 'IMG_SIZE(half).y / 180');
  c.pass('$WIDTH/2 target, FLOAT target, PASSINDEX, IMG_SIZE', `r=${r.toFixed(3)} (0.160) g=${g.toFixed(3)} (0.750) b=${b.toFixed(3)} (0.500)`);
  await c.commands([{ type: 'remove_layer', layer_id: 'L-plan' }]);
}

function spectrumBytes(values, bins = 64) {
  const bytes = Buffer.alloc(bins);
  for (let i = 0; i < bins; i += 1) bytes[i] = Math.round(values[Math.floor((i * values.length) / bins)] * 255);
  return bytes.toString('base64');
}

async function checkSpectrum(c) {
  await c.precompile('mp-spectrum', SPECTRUM);
  await c.bind('L-spectrum', 'mp-spectrum');
  const rising = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => i / 8);
  const falling = [...rising].reverse();
  const measure = async (values, label) => {
    await c.commands([{ type: 'set_audio_spectrum', active: true, fft_b64: spectrumBytes(values), waveform_b64: spectrumBytes([0.5], 256) }]);
    await c.render('L-spectrum', 'mp-spectrum', { time: 1 });
    const s = await c.slot('L-spectrum', 128);
    const fills = [];
    for (let bin = 0; bin < 8; bin += 1) fills.push(s.columnFill((bin + 0.5) / 8));
    fills.forEach((fill, bin) => near(fill, values[bin], 0.03, `${label} bar ${bin}`));
    near(s.px(0.5, 0.5, 1), 8 / 255, 0.002, 'IMG_SIZE(spectrum).x honours MAX 8');
    near(s.px(0.5, 0.5, 2), 64 / 255, 0.002, 'IMG_SIZE(wave).x honours MAX 64');
    return fills;
  };
  const up = await measure(rising, 'rising');
  const outUp = await c.output();
  const down = await measure(falling, 'falling');
  const outDown = await c.output();
  if (outUp.checksum === outDown.checksum) fail('native output did not change with the spectrum');
  const status = await c.rpc.send('status', {}, 5000);
  if (!status.isf_audio_spectrum_live) fail('status does not report a live spectrum');
  c.pass('audioFFT bars follow the synthetic spectrum', `rising ${up.map((v) => v.toFixed(2)).join(' ')} | falling ${down.map((v) => v.toFixed(2)).join(' ')}; output checksum changed`);

  // Producer stops: the rows fall back to band levels instead of freezing.
  await c.commands([{ type: 'set_audio_spectrum', active: false }]);
  await c.render('L-spectrum', 'mp-spectrum', { time: 2 });
  const stale = await c.slot('L-spectrum', 128);
  const staleFill = stale.columnFill(0.5 / 8);
  if (Math.abs(staleFill - down[0]) < 0.05) fail(`spectrum stayed frozen after active:false (${staleFill})`);
  c.pass('inactive spectrum stops driving the bars', `bar 0 ${down[0].toFixed(2)} -> ${staleFill.toFixed(2)}`);
  await c.commands([{ type: 'remove_layer', layer_id: 'L-spectrum' }]);
}

async function checkWaveform(c) {
  await c.precompile('mp-wave', WAVEFORM);
  await c.bind('L-wave', 'mp-wave');
  const ramp = Array.from({ length: 256 }, (_, i) => i / 255);
  await c.commands([{ type: 'set_audio_spectrum', active: true, fft_b64: spectrumBytes([0]), waveform_b64: spectrumBytes(ramp, 256) }]);
  await c.render('L-wave', 'mp-wave', { time: 1 });
  const s = await c.slot('L-wave', 64);
  const samples = [0.125, 0.375, 0.625, 0.875].map((u) => [s.px(u, 0.5, 0), s.px(u, 0.5, 1)]);
  samples.forEach(([row, helper], index) => {
    const u = [0.125, 0.375, 0.625, 0.875][index];
    near(row, u, 0.03, `waveform row at ${u}`);
    near(helper, u, 0.03, `sampleWaveform at ${u}`);
  });
  c.pass('audio waveform row + sampleWaveform()', samples.map(([row, helper]) => `${row.toFixed(2)}/${helper.toFixed(2)}`).join(' '));
  await c.commands([{ type: 'remove_layer', layer_id: 'L-wave' }]);
}

async function main() {
  const rpc = createRpcProcess();
  const c = new Checker(rpc);
  try {
    await rpc.send('start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: W,
        height: H,
        target_fps: 30,
      },
    }, 5000);
    // Freeze the live loop so only explicit render_isf_to_layer commands
    // advance the feedback buffers.
    await rpc.send('set_output_state', { frozen: true }, 5000);
    const status = await checkAccumulation(c);
    await checkTrail(c);
    await checkPlan(c);
    await checkSpectrum(c);
    await checkWaveform(c);
    console.log(`native ISF pass host: ${c.results.length} checks passed (pass-host shaders=${status.isf_pass_host_shaders}, multipass renders=${status.isf_multipass_renders}, targets=${status.isf_pass_targets}, target bytes=${status.isf_pass_target_bytes})`);
  } finally {
    const stderr = await rpc.close();
    if (stderr) console.error(stderr.split('\n').slice(-8).join('\n'));
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
