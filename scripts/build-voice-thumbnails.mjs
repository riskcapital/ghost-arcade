#!/usr/bin/env node
/**
 * Bake a picture of every Studio visual voice (public/ISF/VX-*.fs) through
 * the native render core, into public/ISF/voice-thumbs/<file>.jpg. The
 * visual browser shows these first. The core draws every voice, including
 * the ones built from several passes and feedback that the browser cannot,
 * and the voice is stepped through a few seconds of a phrase (hits on the
 * beat, notes moving) so the picture is mid-phrase, not a blank first frame;
 * a little gamma lift keeps the darker voices readable at thumbnail size.
 *
 *   npm run native:build        (once, if the core is not built)
 *   node scripts/build-voice-thumbnails.mjs [--only VX-Name.fs] [--seconds 3]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const seconds = Number(args.includes('--seconds') ? args[args.indexOf('--seconds') + 1] : 3);
const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const isfDir = join(root, 'public', 'ISF');
const outDir = join(isfDir, 'voice-thumbs');
const coreBin = join(root, 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

function ffmpegBin() {
  try {
    const bin = require('ffmpeg-static');
    if (typeof bin === 'string' && bin) return bin;
  } catch { /* PATH below */ }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function rpcProcess() {
  if (!existsSync(coreBin)) throw new Error(`The native core is not built: ${coreBin}. Run npm run native:build first.`);
  const child = spawn(coreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i = buffer.indexOf('\n');
    while (i >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) {
        const msg = JSON.parse(line);
        const wait = pending.get(msg.id);
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(msg.id);
          if (msg.ok) wait.resolve(msg.result);
          else wait.reject(new Error(msg.error || `${wait.method} failed`));
        }
      }
      i = buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  const send = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`core timed out on ${method}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const close = async () => {
    try { await send('shutdown', {}, 1000); } catch { /* already gone */ }
    child.kill();
    return stderr;
  };
  return { send, close };
}

/** The ISF header's inputs. */
function inputsOf(code) {
  const m = /\/\*\s*(\{[\s\S]*?\})\s*\*\//.exec(code);
  if (!m) return [];
  try { return JSON.parse(m[1]).INPUTS ?? []; } catch { return []; }
}

/**
 * The sound inputs `t` seconds into a phrase at 120 BPM: a hit on every beat
 * that falls away, a note count that climbs, a pitch that walks. Matches the
 * resting values in src/lib/music/voiceThumbnails.ts.
 */
function phraseAt(t) {
  const beat = t * 2;
  const since = beat - Math.floor(beat);
  const notes = Math.floor(beat);
  return {
    vxPresence: 1,
    vxEnergy: 0.6 + 0.2 * Math.sin(t * 1.3),
    vxEnv: Math.max(0.35, 1 - since * 0.8),
    vxHit: Math.max(0, 1 - since * 3),
    vxVel: 0.65 + 0.25 * ((notes * 7) % 5) / 4,
    vxPitch: 0.3 + 0.4 * (((notes * 5) % 7) / 6),
    vxGlide: 0.4,
    vxCount: notes,
    vxPhase: t,
    vxBeat: beat % 4,
    vxBar: Math.floor(beat / 4),
    vxBars: 4,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(isfDir).filter((f) => /^VX-.*\.fs$/.test(f) && (!only || f === only)).sort();
  const temp = mkdtempSync(join(tmpdir(), 'ghost-voice-thumbs-'));
  const rpc = rpcProcess();
  let made = 0;
  try {
    await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: WIDTH, height: HEIGHT, target_fps: FPS } }, 20000);
    for (const file of files) {
      const code = readFileSync(join(isfDir, file), 'utf8');
      const layer = 'voice-thumb';
      const shaderId = `voice-thumb:${file}`;
      const statics = {};
      const colors = {};
      for (const input of inputsOf(code)) {
        if (input.TYPE === 'float' || input.TYPE === 'long') statics[input.NAME] = Number(input.DEFAULT ?? input.MIN ?? 0);
        else if (input.TYPE === 'bool') statics[input.NAME] = input.DEFAULT ? 1 : 0;
        else if (input.TYPE === 'color' && Array.isArray(input.DEFAULT)) colors[input.NAME] = input.DEFAULT;
      }
      try {
        await rpc.send('submit_commands', {
          commands: [
            { type: 'remove_layer', layer_id: layer },
            { type: 'upsert_layer', layer_id: layer, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULL },
            { type: 'set_layer_visibility', layer_id: layer, visible: true },
            { type: 'precompile_shader', shader_id: shaderId, stage: 'pixel', source: code, entry: 'main' },
            { type: 'bind_isf_shader', layer_id: layer, shader_id: shaderId },
          ],
        }, 30000);
        const frames = Math.max(1, Math.round(seconds * FPS));
        const raw = join(temp, `${file}.raw`);
        let snapshot = null;
        for (let f = 0; f < frames; f++) {
          const time = f / FPS;
          await rpc.send('submit_commands', {
            commands: [
              { type: 'set_render_clock', mode: 'manual', time, time_delta: 1 / FPS, frame_index: f },
              { type: 'update_isf_uniforms', shader_id: shaderId, time, time_delta: 1 / FPS, frame_index: f, render_width: WIDTH, render_height: HEIGHT, float_inputs: { ...statics, ...phraseAt(time) }, color_inputs: colors, point_inputs: {}, image_inputs: {} },
            ],
          });
          // Only the last frame is kept; the ones before build up the feedback.
          if (f === frames - 1) snapshot = await rpc.send('export_frame_snapshot', { path: raw, time, time_delta: 1 / FPS, frame_index: f }, 15000);
          else await rpc.send('export_frame_snapshot', { path: join(temp, 'scratch.raw'), time, time_delta: 1 / FPS, frame_index: f }, 15000);
        }
        const fmt = String(snapshot?.format ?? '').toLowerCase().includes('bgra') ? 'bgra' : 'rgba';
        const out = join(outDir, file.replace(/\.fs$/, '.jpg'));
        const enc = spawnSync(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', fmt, '-s:v', `${WIDTH}x${HEIGHT}`, '-i', raw, '-frames:v', '1', '-vf', 'eq=gamma=1.5:contrast=1.05', '-q:v', '4', out], { windowsHide: true, encoding: 'utf8' });
        if (enc.status !== 0) throw new Error(enc.stderr || 'ffmpeg failed');
        made++;
        console.log(`${file}: luma ${Number(snapshot?.average_luma ?? 0).toFixed(3)}`);
      } catch (err) {
        console.warn(`${file}: skipped (${err.message})`);
      }
    }
  } finally {
    const stderr = await rpc.close();
    rmSync(temp, { recursive: true, force: true });
    if (process.env.VOICE_THUMBS_VERBOSE === '1' && stderr) console.warn(stderr);
  }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(readdirSync(outDir).filter((f) => f.endsWith('.jpg')).sort())}\n`);
  console.log(`baked ${made}/${files.length} voice pictures into public/ISF/voice-thumbs`);
  syncLibrary();
}

/** The app's thumbnail key for a shader (src/lib/isf/thumbnail.ts shaderThumbnailKey). */
function thumbnailKey(code) {
  const text = code.replace(/\r\n?/g, '\n');
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return `thumb_${(h >>> 0).toString(36)}`;
}

/** Voices that are also in the VJ library get these pictures as their library thumbnails. */
function syncLibrary() {
  const thumbsDir = join(isfDir, 'thumbs');
  const indexPath = join(thumbsDir, 'index.json');
  const manifest = JSON.parse(readFileSync(join(isfDir, 'manifest.json'), 'utf8'));
  const library = (manifest.version === 2 ? manifest.shaders.map((s) => s.file) : manifest.shaders).filter((f) => /^VX-.*\.fs$/.test(f));
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  let linked = 0;
  for (const file of library) {
    const baked = join(outDir, file.replace(/\.fs$/, '.jpg'));
    if (!existsSync(baked)) continue;
    const key = thumbnailKey(readFileSync(join(isfDir, file), 'utf8'));
    const name = `${key.replace(/^-/, 'n')}.jpg`;
    writeFileSync(join(thumbsDir, name), readFileSync(baked));
    index[key] = name;
    linked++;
  }
  writeFileSync(indexPath, `${JSON.stringify(index, null, 0)}\n`);
  console.log(`linked ${linked} library thumbnails to the baked voice pictures`);
}

if (args.includes('--library-only')) {
  syncLibrary();
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});
