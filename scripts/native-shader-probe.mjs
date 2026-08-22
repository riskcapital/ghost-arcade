/*
 * Probe one or more ISF shaders against the real native render core.
 *
 * The corpus check answers "does the whole library still compile". This
 * answers the question you actually have while writing a shader: does naga
 * translate it, does it put light on the screen, and what does a frame cost.
 *
 * It renders at 1920x1080 rather than the corpus check's 320x180, because a
 * raymarcher's cost is per pixel and a thumbnail-sized timing tells you
 * nothing about whether the thing survives a projector.
 *
 * Usage:
 *   node scripts/native-shader-probe.mjs public/ISF/GA2-MinimalSurface.fs
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';

import { createRpcProcess } from './native-renderer-smoke.mjs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/native-shader-probe.mjs <shader.fs> [...]');
  process.exit(1);
}

const WIDTH = Number(process.env.PROBE_WIDTH || 1920);
const HEIGHT = Number(process.env.PROBE_HEIGHT || 1080);
const WARMUP_FRAMES = 8;
const TIMED_FRAMES = 24;

const FULLSCREEN_CORNERS = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

/* Audio values chosen to sit mid-range: a shader that only looks alive at
   beat=1 is a shader that looks dead most of the night. */
const AUDIO = {
  active: true,
  level: 0.42,
  bass: 0.55,
  mid: 0.34,
  high: 0.30,
  beat: 0.35,
  beat_phase: 0.4,
  bpm: 128,
  centroid: 0.52,
  kick: 0.40,
  snare: 0.22,
};

function uniforms(shaderId, time, frameIndex) {
  return {
    type: 'update_isf_uniforms',
    shader_id: shaderId,
    time,
    time_delta: 1 / 60,
    frame_index: frameIndex,
    render_width: WIDTH,
    render_height: HEIGHT,
    ...AUDIO,
    float_inputs: {},
    point_inputs: {},
    color_inputs: {},
  };
}

const rpc = createRpcProcess();
let failures = 0;

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

  for (const [index, file] of files.entries()) {
    if (!existsSync(file)) {
      console.error(`  MISSING  ${file}`);
      failures += 1;
      continue;
    }
    const source = readFileSync(file, 'utf8');
    const digest = createHash('sha1').update(source).digest('hex').slice(0, 8);
    const shaderId = `probe:${index}:${digest}`;
    const layerId = `probe-layer-${index}`;
    const name = basename(file);

    const before = await rpc.send('status', {}, 5000);
    await rpc.send('submit_commands', {
      commands: [{
        type: 'precompile_shader',
        shader_id: shaderId,
        stage: 'pixel',
        entry: 'main',
        source,
      }],
    }, 30000);
    const after = await rpc.send('status', {}, 5000);

    const compiled = Number(after.shader_precompile_compiled ?? 0)
      > Number(before.shader_precompile_compiled ?? 0);
    if (!compiled) {
      console.log(`\n${name}`);
      console.log(`  COMPILE FAILED`);
      console.log(`  ${String(after.last_shader_error || 'no error reported').slice(0, 600)}`);
      failures += 1;
      continue;
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

    for (let f = 0; f < WARMUP_FRAMES; f++) {
      await rpc.send('submit_commands', {
        commands: [
          uniforms(shaderId, 1.0 + f * 0.05, f),
          { type: 'render_isf_to_layer', layer_id: layerId },
        ],
      }, 20000);
    }

    const timedStart = await rpc.send('status', {}, 5000);
    const startGpuSamples = Number(timedStart.gpu_timing_samples ?? 0);

    /* Walk the clock across the timed run so a shader that is only
       interesting at one instant cannot fake a good average. */
    const lumaSamples = [];
    for (let f = 0; f < TIMED_FRAMES; f++) {
      const time = 2.0 + f * 0.37;
      await rpc.send('submit_commands', {
        commands: [
          uniforms(shaderId, time, 100 + f),
          { type: 'render_isf_to_layer', layer_id: layerId },
        ],
      }, 20000);
      if (f % 6 === 0) {
        const snap = await rpc.send('frame_snapshot', {
          include_pixels: false,
          time,
          frame_index: 100 + f,
        }, 20000);
        lumaSamples.push({
          time: time.toFixed(2),
          luma: Number(snap.average_luma ?? 0),
          nonzero: Number(snap.nonzero_pixels ?? 0),
          dark: Boolean(snap.dark_frame),
        });
      }
    }

    const end = await rpc.send('status', {}, 5000);
    const gpuMs = Number(end.avg_render_gpu_ms ?? 0);
    const maxGpuMs = Number(end.max_render_gpu_ms ?? 0);
    const cpuMs = Number(end.avg_render_cpu_ms ?? 0);
    const samples = Number(end.gpu_timing_samples ?? 0) - startGpuSamples;
    const shaderErr = String(end.last_shader_error || '');

    const blankFrames = lumaSamples.filter((s) => s.nonzero === 0 || s.dark).length;
    const lumas = lumaSamples.map((s) => s.luma);
    const lumaMin = Math.min(...lumas);
    const lumaMax = Math.max(...lumas);

    console.log(`\n${name}`);
    console.log(`  compile      ok`);
    console.log(`  gpu          avg ${gpuMs.toFixed(2)}ms   max ${maxGpuMs.toFixed(2)}ms   (${samples} samples @ ${WIDTH}x${HEIGHT})`);
    console.log(`  cpu          avg ${cpuMs.toFixed(2)}ms`);
    console.log(`  headroom     ${gpuMs > 0 ? (1000 / gpuMs).toFixed(0) : 'n/a'} fps if GPU-bound`);
    console.log(`  luma         ${lumaMin.toFixed(4)} .. ${lumaMax.toFixed(4)} across ${lumaSamples.length} clocks`);
    console.log(`  blank frames ${blankFrames}/${lumaSamples.length}`);
    if (shaderErr.includes(shaderId)) {
      console.log(`  RENDER ERROR ${shaderErr.slice(0, 400)}`);
      failures += 1;
    } else if (blankFrames > 0) {
      console.log(`  WARN         rendered blank at one or more clocks`);
      failures += 1;
    } else if (lumaMax - lumaMin < 0.0005) {
      console.log(`  WARN         output is static across the timed run`);
    }
  }
} finally {
  const stderr = await rpc.close();
  if (stderr && process.env.PROBE_VERBOSE) console.error(stderr.split('\n').slice(-15).join('\n'));
}

process.exit(failures > 0 ? 1 : 0);
