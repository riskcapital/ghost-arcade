import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNativeEffectPassGraph, buildNativeEffectPassPrecompileCommands, type NativeEffectPassId } from './nativeEffectPass';
import { softwareVulkanRunner } from './nativeHardwareTestPlatform';

const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const FULLSCREEN_CORNERS = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const SIZE = 256;
// An hour, and ten, into a show: the live clock counts seconds since launch.
const HOUR = 3600;

type NativeRpc = {
  send(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<any>;
  close(): Promise<string>;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createNativeRpc(): NativeRpc {
  const child = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('native render-core stdio was not initialized');
  }
  let nextId = 1;
  let stdout = '';
  let stderr = '';
  const pending = new Map<number, { method: string; timer: ReturnType<typeof setTimeout>; resolve(value: unknown): void; reject(error: Error): void }>();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    let index = stdout.indexOf('\n');
    while (index >= 0) {
      const line = stdout.slice(0, index).trim();
      stdout = stdout.slice(index + 1);
      if (line) {
        const message = JSON.parse(line) as { id?: number; ok?: boolean; result?: unknown; error?: string };
        const wait = typeof message.id === 'number' ? pending.get(message.id) : null;
        if (wait) {
          clearTimeout(wait.timer);
          pending.delete(message.id as number);
          if (message.ok) wait.resolve(message.result);
          else wait.reject(new Error(message.error || `${wait.method} failed`));
        }
      }
      index = stdout.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const send: NativeRpc['send'] = (method, params = {}, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native render-core timed out handling ${method}: ${stderr.trim()}`));
      }, timeoutMs);
      pending.set(id, { method, timer, resolve, reject });
      child.stdin?.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already gone */ }
      child.kill();
      return stderr.trim();
    },
  };
}

/** Colour bars over a soft vertical gradient: sideways moves, slants and
 *  colour faults all change it. */
function testCard(): Uint8Array {
  const bars = [[235, 235, 235], [235, 220, 30], [30, 215, 225], [40, 200, 50], [220, 40, 200], [225, 40, 40], [40, 50, 220], [20, 20, 20]];
  const bytes = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const o = (y * SIZE + x) * 4;
    const bar = bars[Math.floor((x / SIZE) * bars.length)];
    const shade = 0.55 + 0.45 * (y / SIZE);
    bytes[o] = bar[0] * shade; bytes[o + 1] = bar[1] * shade; bytes[o + 2] = bar[2] * shade; bytes[o + 3] = 255;
  }
  return bytes;
}

/** The test card on the right half only; the left half is transparent. */
function halfCard(): Uint8Array {
  const bytes = testCard();
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE / 2; x += 1) bytes.fill(0, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 4);
  return bytes;
}

/** Share of the left (transparent) half that shows picture. */
function leftCoverage(a: Uint8Array): number {
  let lit = 0;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE / 2 - 8; x += 1) {
    const o = (y * SIZE + x) * 4;
    if (a[o] + a[o + 1] + a[o + 2] > 60) lit += 1;
  }
  return lit / (SIZE * (SIZE / 2 - 8));
}

type Picture = Uint8Array;

function pixelsOf(snapshot: any): Picture {
  const data = Buffer.from(String(snapshot.rgba_b64), 'base64');
  expect(data.byteLength).toBe(SIZE * SIZE * 4);
  return new Uint8Array(data);
}

/** Share of pixels that differ by more than a small threshold. */
function changedShare(a: Picture, b: Picture): number {
  let changed = 0;
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const o = i * 4;
    if (Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 24) changed += 1;
  }
  return changed / (SIZE * SIZE);
}

describe('Glitch effects', () => {
  const itIfNativeCore = existsSync(nativeCoreBin) && !softwareVulkanRunner ? it : it.skip;

  itIfNativeCore('keep breaking the picture up hours into a show, and each control changes it', async () => {
    const rpc = createNativeRpc();
    try {
      await rpc.send('start', { config: { backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan', width: SIZE, height: SIZE, target_fps: 30 } }, 12000);
      await delay(300);
      const precompiled = await rpc.send('submit_commands', { commands: buildNativeEffectPassPrecompileCommands() }, 8000);
      expect(Number(precompiled?.dropped ?? 0)).toBe(0);
      const sourceId = 'glitch-source', layerId = 'glitch-layer';
      const card = Buffer.from(testCard()).toString('base64');
      await rpc.send('submit_commands', { commands: [
        { type: 'upload_source_frame', source_id: sourceId, width: SIZE, height: SIZE, rgba_b64: card, seq: 1 },
        { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN_CORNERS },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: 'glitch-test://source', source_type: 'image' },
      ] }, 5000);
      const plainShot = await rpc.send('frame_snapshot', { include_pixels: true, time: 0, frame_index: 1 }, 8000);
      const plain = pixelsOf(plainShot);

      let frame = 2;
      let stale = String(plainShot.checksum);
      const render = async (effect: NativeEffectPassId, time: number, params: Record<string, number>, amount?: number, picture: string = card) => {
        const targetSourceId = 'glitch-output';
        await rpc.send('submit_commands', { commands: [{ type: 'upload_source_frame', source_id: sourceId, width: SIZE, height: SIZE, rgba_b64: picture, seq: frame }] }, 5000);
        const graph = buildNativeEffectPassGraph({ sourceId, targetSourceId, effect, width: SIZE, height: SIZE, time, frameDelta: 1 / 30, frameIndex: frame, mix: 1, amount, params });
        const result = await rpc.send('compute_graph', graph.config, 8000);
        expect(result?.render).toMatchObject({ target: 'source_frame', source_id: targetSourceId });
        await rpc.send('submit_commands', { commands: [{ type: 'bind_media_source', layer_id: layerId, source_id: targetSourceId, uri: `glitch-test://${targetSourceId}/${frame}`, source_type: 'image' }] }, 5000);
        const deadline = Date.now() + 5000;
        let shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000);
        // Identical output is a valid answer (Speed 0), so stop waiting after a short while.
        while (shot.checksum === stale && Date.now() < deadline) { await delay(25); shot = await rpc.send('frame_snapshot', { include_pixels: true, time, frame_index: frame }, 8000); }
        stale = String(shot.checksum);
        frame += 1;
        const pixels = pixelsOf(shot);
        if (process.env.GA_GLITCH_DUMP) dumps.push(Buffer.from(pixels).toString('base64'));
        return pixels;
      };
      const dumps: string[] = [];

      // Glitch, as added from the effect list. The shipped shader hashed
      // row * 311.7 + tick in floats: once the live clock passed a few
      // minutes that hash lost its fraction, so no band ever moved again.
      const glitch = { speed: 1, blockSize: 0.3, rgbSplit: 0.5, jitter: 0.3, verticalSlice: 0, blockHold: 0.3, tearChance: 0, triggerMode: 0, freezeBurst: 0 };
      for (const start of [HOUR, 10 * HOUR]) {
        const now = await render('glitch', start, glitch, 0.5);
        const later = await render('glitch', start + 0.25, glitch, 0.5);
        if (process.env.GA_GLITCH_LOG) console.log('glitch at', start, changedShare(now, plain), changedShare(now, later));
        expect(changedShare(now, plain)).toBeGreaterThan(0.05);
        expect(changedShare(now, later)).toBeGreaterThan(0.05);
      }
      // Speed 0 holds one broken frame still, with a Freeze burst too (the
      // burst gate used to swap patterns every half second).
      const held = await render('glitch', HOUR, { ...glitch, speed: 0 }, 0.5);
      const heldLater = await render('glitch', HOUR + 0.5, { ...glitch, speed: 0 }, 0.5);
      expect(changedShare(held, plain)).toBeGreaterThan(0.05);
      expect(changedShare(held, heldLater)).toBe(0);
      const frozen = [];
      for (const t of [HOUR, HOUR + 0.6, HOUR + 1.3, HOUR + 2.7, HOUR + 4.1]) frozen.push(await render('glitch', t, { ...glitch, speed: 0, freezeBurst: 0.8 }, 0.5));
      expect(changedShare(frozen[0], plain)).toBeGreaterThan(0.05);
      for (const later of frozen.slice(1)) expect(changedShare(frozen[0], later)).toBe(0);

      // Seeds: seed 0 is the pattern instances had before seeds; two
      // instances with different seeds break up differently.
      const seeded = await render('glitch', HOUR, { ...glitch, glitchSeed: 12345 }, 0.5);
      const seededOther = await render('glitch', HOUR, { ...glitch, glitchSeed: 777 }, 0.5);
      const unseeded = await render('glitch', HOUR, glitch, 0.5);
      expect(changedShare(seeded, plain)).toBeGreaterThan(0.05);
      expect(changedShare(seeded, unseeded)).toBeGreaterThan(0.05);
      expect(changedShare(seeded, seededOther)).toBeGreaterThan(0.05);
      expect(changedShare(unseeded, await render('glitch', HOUR, { ...glitch, glitchSeed: 0 }, 0.5))).toBe(0);
      // Speed 0 + seed still holds still.
      expect(changedShare(await render('glitch', HOUR, { ...glitch, speed: 0, glitchSeed: 9 }, 0.5), await render('glitch', HOUR + 3, { ...glitch, speed: 0, glitchSeed: 9 }, 0.5))).toBe(0);

      // Alpha moves with the picture: over a transparent left half, moved
      // bands and tears bring their picture along instead of vanishing.
      const half = Buffer.from(halfCard()).toString('base64');
      const torn = { ...glitch, blockSize: 0.6, tearChance: 1, jitter: 1 };
      let coverage = 0;
      for (let step = 0; step < 4; step += 1) coverage = Math.max(coverage, leftCoverage(await render('glitch', HOUR + step * 0.37, torn, 1, half)));
      if (process.env.GA_GLITCH_LOG) console.log('glitch alpha coverage', coverage);
      expect(coverage).toBeGreaterThan(0.02);
      let bendCoverage = 0;
      for (let step = 0; step < 4; step += 1) bendCoverage = Math.max(bendCoverage, leftCoverage(await render('data-bend', HOUR + step * 0.9, { dbSpeed: 0.6, dbStride: 1, dbBandSize: 0.45, dbChannelSlip: 0.5, dbBitCrush: 0, dbMix: 1, dbIntensity: 1 }, undefined, half)));
      let corruptCoverage = 0;
      for (let step = 0; step < 4; step += 1) corruptCoverage = Math.max(corruptCoverage, leftCoverage(await render('block-corrupt', HOUR + step * 0.8, { bcSpeed: 0.8, bcBlockSize: 32, bcSmear: 0, bcRun: 0.8, bcColorFault: 0, bcMotion: 1, bcMix: 1, bcIntensity: 1 }, undefined, half)));
      if (process.env.GA_GLITCH_LOG) console.log('bend alpha coverage', bendCoverage, 'corrupt alpha coverage', corruptCoverage);
      expect(bendCoverage).toBeGreaterThan(0.01);
      expect(corruptCoverage).toBeGreaterThan(0.01);
      // Each control changes the picture.
      const base = await render('glitch', HOUR, glitch, 0.5);
      for (const change of [{ blockSize: 0.9 }, { rgbSplit: 0 }, { jitter: 1 }, { verticalSlice: 1 }, { blockHold: 1 }, { tearChance: 1 }]) {
        const varied = await render('glitch', HOUR, { ...glitch, ...change }, 0.5);
        if (process.env.GA_GLITCH_LOG) console.log(JSON.stringify(change), changedShare(base, varied));
        expect(changedShare(base, varied), JSON.stringify(change)).toBeGreaterThan(0.01);
      }
      // Audio reactive follows the music: next to nothing in silence, the
      // full effect when loud. Beat snap fires on the beat.
      const quiet = await render('glitch', HOUR, { ...glitch, triggerMode: 1, audioLevel: 0 }, 0.5);
      const loud = await render('glitch', HOUR, { ...glitch, triggerMode: 1, audioLevel: 0.8 }, 0.5);
      const onBeat = await render('glitch', HOUR, { ...glitch, triggerMode: 2, audioBeat: 1 }, 0.5);
      if (process.env.GA_GLITCH_LOG) console.log('quiet', changedShare(quiet, plain), 'loud', changedShare(loud, plain), 'beat', changedShare(onBeat, plain));
      expect(changedShare(quiet, plain)).toBeLessThan(0.02);
      expect(changedShare(loud, plain)).toBeGreaterThan(0.05);
      expect(changedShare(onBeat, plain)).toBeGreaterThan(0.05);
      // Intensity 0 leaves the picture alone.
      expect(changedShare(await render('glitch', HOUR, glitch, 0), plain)).toBe(0);

      // Block Corrupt: runs of broken blocks with clean picture between them.
      const corrupt = { bcSpeed: 0.8, bcBlockSize: 32, bcSmear: 0.6, bcRun: 0.5, bcColorFault: 0.45, bcMotion: 0.5, bcMix: 1 };
      const corruptShares: number[] = [];
      let previous: Picture | null = null;
      let moved = 0;
      for (let step = 0; step < 6; step += 1) {
        const picture = await render('block-corrupt', HOUR + step * 0.8, { ...corrupt, bcIntensity: 0.6 });
        corruptShares.push(changedShare(picture, plain));
        if (previous) moved = Math.max(moved, changedShare(picture, previous));
        previous = picture;
      }
      if (process.env.GA_GLITCH_LOG) console.log('corrupt', corruptShares, moved);
      expect(Math.max(...corruptShares)).toBeGreaterThan(0.04);
      expect(Math.max(...corruptShares)).toBeLessThan(0.8);
      expect(moved).toBeGreaterThan(0.03);
      expect(changedShare(await render('block-corrupt', HOUR, { ...corrupt, bcIntensity: 0 }), plain)).toBe(0);
      // Seeds split identical Block Corrupt instances; seed 0 is unchanged.
      const corruptBase = await render('block-corrupt', HOUR, { ...corrupt, bcIntensity: 0.6 });
      expect(changedShare(corruptBase, await render('block-corrupt', HOUR, { ...corrupt, bcIntensity: 0.6, bcSeed: 0 }))).toBe(0);
      expect(changedShare(corruptBase, await render('block-corrupt', HOUR, { ...corrupt, bcIntensity: 0.6, bcSeed: 4242 }))).toBeGreaterThan(0.02);
      // Audio reactivity alone breaks the stream when the music is loud.
      const corruptLoud = await render('block-corrupt', HOUR, { ...corrupt, bcIntensity: 0, bcAudioReact: 1, audioLevel: 1 });
      expect(changedShare(corruptLoud, plain)).toBeGreaterThan(0.01);

      // Data Bend: whole bands slant, slip and crush; the rest stays put.
      const bend = { dbSpeed: 0.6, dbStride: 0.4, dbBandSize: 0.45, dbChannelSlip: 0.5, dbBitCrush: 0.35, dbMix: 1 };
      const bendShares: number[] = [];
      previous = null;
      moved = 0;
      for (let step = 0; step < 6; step += 1) {
        const picture = await render('data-bend', 10 * HOUR + step * 0.9, { ...bend, dbIntensity: 0.6 });
        bendShares.push(changedShare(picture, plain));
        if (previous) moved = Math.max(moved, changedShare(picture, previous));
        previous = picture;
      }
      if (process.env.GA_GLITCH_LOG) console.log('bend', bendShares, moved);
      expect(Math.max(...bendShares)).toBeGreaterThan(0.1);
      expect(Math.min(...bendShares)).toBeLessThan(0.95);
      expect(moved).toBeGreaterThan(0.05);
      expect(changedShare(await render('data-bend', HOUR, { ...bend, dbIntensity: 0 }), plain)).toBe(0);
      const bendBase = await render('data-bend', HOUR, { ...bend, dbIntensity: 0.6 });
      expect(changedShare(bendBase, await render('data-bend', HOUR, { ...bend, dbIntensity: 0.6, dbSeed: 0 }))).toBe(0);
      expect(changedShare(bendBase, await render('data-bend', HOUR, { ...bend, dbIntensity: 0.6, dbSeed: 4242 }))).toBeGreaterThan(0.02);
      // Slant alone (no slip, no bit damage) still bends the bars.
      const slanted = await render('data-bend', HOUR, { ...bend, dbIntensity: 1, dbStride: 1, dbChannelSlip: 0, dbBitCrush: 0 });
      expect(changedShare(slanted, plain)).toBeGreaterThan(0.1);

      // Effects that re-roll their grain, dropouts or tiles on a clock tick
      // keep doing it an hour, and ten, into a show. With float hashes of
      // cell + tick these froze once the tick count ran into the thousands.
      const ticking: Array<[NativeEffectPassId, Record<string, number>]> = [
        ['film-grain', { grainSize: 1, grainShadow: 0.7, grainMid: 1, grainHigh: 0.5, grainMono: 0, grainStock: 1, grainColorJitter: 0.3, grainAnimSpeed: 1 }],
        ['tape-dropout', { tapeDropoutDensity: 0.8, tapeDropoutLength: 0.5, tapeDropoutColor: 0, tapeDropoutSpeed: 1, tapeDropoutNoise: 0.7 }],
        ['datamosh-lite', { amount: 0.6, amount2: 0.3, amount3: 0.4 }],
        ['night-vision', { nightVisionNoise: 0.6, nightVisionRollingNoise: 0.6 }],
        ['vhs-full-deck', { vhsFdTracking: 0.5, vhsFdHeadSwitch: 0.4, vhsFdDropouts: 0.6, vhsFdTapeNoise: 0.6, vhsFdTrackingJump: 0.1 }],
        ['noise', { noiseAnimSpeed: 1 }],
      ];
      for (const [effect, params] of ticking) {
        for (const start of [HOUR, 10 * HOUR]) {
          const now = await render(effect, start + 0.1, params);
          const later = await render(effect, start + 0.7, params);
          if (process.env.GA_GLITCH_LOG) console.log(effect, start, changedShare(now, later));
          expect(changedShare(now, later), `${effect} at ${start} s`).toBeGreaterThan(0.01);
        }
      }
      // VHS snow stays fine-grained a day into a show: its drift (t * 100
      // cells) used to swamp the f32 pixel position, so neighbouring pixels
      // read the same noise and the snow turned into blocks.
      const snowOnly = { tracking: 0, noise: 1, distortion: 0, colorBleed: 0, scanlines: 0, saturation: 1 };
      const equalNeighbours = (a: Picture) => {
        let same = 0, pairs = 0;
        for (let y = 0; y < SIZE; y += 2) for (let x = 0; x < SIZE - 1; x += 1) {
          const o = (y * SIZE + x) * 4;
          if (a[o] === a[o + 4] && a[o + 1] === a[o + 5] && a[o + 2] === a[o + 6]) same += 1;
          pairs += 1;
        }
        return same / pairs;
      };
      const snowShow = equalNeighbours(await render('vhs', 10, snowOnly, 1));
      const snowDay = equalNeighbours(await render('vhs', 30 * HOUR + 0.3, snowOnly, 1));
      if (process.env.GA_GLITCH_LOG) console.log('vhs equal neighbours', snowShow, snowDay);
      expect(snowDay).toBeLessThan(snowShow + 0.1);

      if (process.env.GA_GLITCH_DUMP) (await import('node:fs')).writeFileSync(process.env.GA_GLITCH_DUMP, JSON.stringify(dumps));
    } finally {
      const log = await rpc.close();
      if (process.env.GA_GLITCH_LOG) console.log(String(log).slice(-3000));
    }
  }, 120000);
});
