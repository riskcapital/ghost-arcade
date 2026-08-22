/*
 * Render one ISF shader through the native core and write PNG stills.
 *
 * Timings tell you a shader is cheap; they do not tell you it looks like
 * anything. This grabs real frames at several clocks so the result can be
 * judged rather than assumed.
 *
 * Usage:
 *   node scripts/native-shader-capture.mjs public/ISF/Foo.fs out/dir [t1,t2,...]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { createRpcProcess } from './native-renderer-smoke.mjs';

const file = process.argv[2];
const outDir = process.argv[3] || 'shader-caps';
const times = (process.argv[4] || '2.0,7.3,15.7,31.4').split(',').map(Number);

if (!file || !existsSync(file)) {
  console.error('usage: node scripts/native-shader-capture.mjs <shader.fs> [outDir] [t1,t2,...]');
  process.exit(1);
}

/* Named ISF inputs to force, as JSON: CAP_INPUTS='{"colorMode":2}'.
   long/bool inputs ride the same float channel as floats and are cast core
   side, so one map covers every scalar input. */
const INPUTS = JSON.parse(process.env.CAP_INPUTS || '{}');

const WIDTH = Number(process.env.CAP_WIDTH || 1280);
const HEIGHT = Number(process.env.CAP_HEIGHT || 720);

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* Minimal RGBA8 PNG writer — avoids pulling an image dependency into the repo
   for what is a debugging aid. */
function writePng(path, width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

mkdirSync(outDir, { recursive: true });

const source = readFileSync(file, 'utf8');
const digest = createHash('sha1').update(source).digest('hex').slice(0, 8);
const shaderId = `cap:${digest}`;
const layerId = 'cap-layer';
const stem = basename(file).replace(/\.fs$/i, '');

const rpc = createRpcProcess();
try {
  await rpc.send('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal'
        : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: WIDTH,
      height: HEIGHT,
      target_fps: 60,
    },
  }, 20000);

  await rpc.send('submit_commands', {
    commands: [{
      type: 'precompile_shader',
      shader_id: shaderId,
      stage: 'pixel',
      entry: 'main',
      source,
    }],
  }, 30000);

  const st = await rpc.send('status', {}, 5000);
  if (String(st.last_shader_error || '').includes(shaderId)) {
    console.error('compile failed:', st.last_shader_error);
    process.exit(1);
  }

  await rpc.send('submit_commands', {
    commands: [
      {
        type: 'upsert_layer',
        layer_id: layerId,
        z_index: 0,
        blend_mode: 'normal',
        opacity: 1,
        corners: FULLSCREEN_CORNERS,
      },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'bind_isf_shader', layer_id: layerId, shader_id: shaderId },
    ],
  }, 15000);

  for (const [i, time] of times.entries()) {
    await rpc.send('submit_commands', {
      commands: [
        {
          type: 'update_isf_uniforms',
          shader_id: shaderId,
          time,
          time_delta: 1 / 60,
          frame_index: 200 + i,
          render_width: WIDTH,
          render_height: HEIGHT,
          active: true,
          level: 0.42, bass: 0.55, mid: 0.34, high: 0.30,
          beat: 0.35, beat_phase: 0.4, bpm: 128,
          centroid: 0.52, kick: 0.40, snare: 0.22,
          float_inputs: INPUTS, point_inputs: {}, color_inputs: {},
        },
        { type: 'render_isf_to_layer', layer_id: layerId },
      ],
    }, 20000);

    const snap = await rpc.send('frame_snapshot', {
      include_pixels: true,
      time,
      frame_index: 200 + i,
    }, 25000);

    const w = Number(snap.width);
    const h = Number(snap.height);
    const padded = Number(snap.padded_bytes_per_row || snap.bytes_per_row);
    const src = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
    const fmt = String(snap.format || '');

    /* Readback rows are padded to the GPU's alignment; repack to tight RGBA
       and swizzle if the surface came back BGRA. */
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      src.copy(out, y * w * 4, y * padded, y * padded + w * 4);
    }
    if (/Bgra/i.test(fmt)) {
      for (let i2 = 0; i2 < out.length; i2 += 4) {
        const b = out[i2];
        out[i2] = out[i2 + 2];
        out[i2 + 2] = b;
      }
    }
    for (let i2 = 3; i2 < out.length; i2 += 4) out[i2] = 255;

    const path = join(outDir, `${stem}-t${String(time).replace('.', '_')}.png`);
    writePng(path, w, h, out);
    console.log(`${path}  ${w}x${h}  ${fmt}  luma=${Number(snap.average_luma ?? 0).toFixed(4)}`);
  }
} finally {
  await rpc.close();
}
