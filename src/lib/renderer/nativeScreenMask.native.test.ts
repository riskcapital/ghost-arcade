import { projectorCalibrationUniforms, inverseProjectorHomography } from '../output/projectorCalibration';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
import { screenMaskAlpha } from '../stores/screenMaskGeometry';
import type { ScreenMask } from '../stores/settings';

let nativeScreenMasks: typeof import('../sync/nativeRendererSync').nativeScreenMasks;

beforeAll(async () => {
  // The sync module touches browser globals at import time.
  const storage = new Map<string, string>();
  const g = globalThis as any;
  g.localStorage ??= {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  };
  g.document ??= { documentElement: { style: { setProperty: () => {} } } };
  g.window ??= {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  ({ nativeScreenMasks } = await import('../sync/nativeRendererSync'));
});

/**
 * Per-screen masks on the real GPU.
 *
 * A screen output is a second composite of the master with that screen's
 * crop, warp, grade and blend. Masks are cut from the screen's own frame
 * after the crop and warp have been resolved, so the pixels read back here
 * come from the same presenter pass a slice display shows. The core takes
 * mask points in its y-up screen UV; the editor's y flip is covered by the
 * sync unit tests.
 */

const binary = platform.binary;
type Command = Record<string, unknown>;

function core() {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) {
      fail(new Error(`invalid native core response: ${String(error)}: ${line}`));
    }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 20000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) fail(error);
      });
    });
  };
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

const SIZE = 128;

/** Snapshot pixels are BGRA, top row first. Returns [r, g, b] at a pixel. */
function pixel(frame: any, x: number, y: number): [number, number, number] {
  const bytes = Buffer.from(frame.rgba_b64, 'base64');
  const stride = Number(frame.padded_bytes_per_row ?? frame.bytes_per_row ?? Number(frame.width) * 4);
  const offset = y * stride + x * 4;
  const p = [...bytes.subarray(offset, offset + 4)];
  if (String(frame.format).toLowerCase().startsWith('bgra')) [p[0], p[2]] = [p[2], p[0]];
  return [p[0], p[1], p[2]];
}

/** Pixel column for a screen-space u, row for a y-up v. */
const col = (u: number) => Math.round(u * SIZE - 0.5);
const row = (v: number) => Math.round((1 - v) * SIZE - 0.5);

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

function slice(id: string, extra: Command = {}): Command {
  return {
    id, width: SIZE, height: SIZE,
    cropX: 0, cropY: 0, cropW: 1, cropH: 1,
    warpMode: 'rect',
    ...extra,
  };
}

const suite = platform.runnable ? describe : describe.skip;
suite('Native screen masks', () => {
  it('calibrates two trapezoidal projectors with complementary angled overlap and retains it across content changes', async () => {
    const rpc=core();
    try {
      await rpc.send('start',{config:{backend:platform.rendererBackend,width:SIZE,height:SIZE,source_frame_size:128,target_fps:30}});
      // Electron asks this BEFORE opening any screen. A false DXGI capability
      // used to silently route Windows to the uncalibrated browser fallback.
      expect(await rpc.send('get_slice_output_state')).toMatchObject({available:true, slices:[]});
      const upload=(value:number,seq:number)=>({type:'upload_source_frame',source_id:'calibration-image',width:32,height:32,seq,rgba_b64:Buffer.from(Array.from({length:1024},()=>[value,value,value,255]).flat()).toString('base64')});
      await rpc.commands([upload(180,1),{type:'upsert_layer',layer_id:'calibration-image',opacity:1,corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:0,y:0}}},{type:'bind_media_source',layer_id:'calibration-image',source_id:'calibration-image',uri:'test://image',source_type:'image'}]);
      const corners=[{x:.2,y:.1},{x:.8,y:.1},{x:.95,y:.9},{x:.05,y:.9}];
      const band={enabled:true,startTop:.46,startBottom:.36,endTop:.54,endBottom:.64};
      const output=(side:'left'|'right')=>slice(side,{cropX:side==='left'?0:.36,cropW:.64,projectorCalibration:projectorCalibrationUniforms({projectorCalibration:{enabled:true,corners},overlapBand:{...band,side}})});
      await rpc.send('set_slice_outputs',{slices:[output('left'),output('right')]});
      // Invert the inverse homography to locate the SAME composition point on each projector.
      const [a,b,c,d,e,f,g,h,i]=inverseProjectorHomography(corners)!;
      const forward=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
      const locate=(x:number,y:number,side:string)=>{const u=(x-(side==='left'?0:.36))/.64,v=1-y;const z=forward[6]*u+forward[7]*v+forward[8];return [Math.round((forward[0]*u+forward[1]*v+forward[2])/z*SIZE-.5),Math.round((forward[3]*u+forward[4]*v+forward[5])/z*SIZE-.5)];};
      const linear=(v:number)=>{const x=v/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;};
      for(const [value,seq] of [[180,1],[100,2]]) {
        if(seq>1) await rpc.commands([upload(value,seq)]);
        await new Promise(r=>setTimeout(r,100));
        const state = await rpc.send('get_slice_output_state');
        expect(state.available).toBe(true);
        expect(state.slices.map((s:any)=>s.id).sort()).toEqual(['left','right']);
        const handles = state.slices.map((s:any)=>s.shared_name ?? s.handle);
        expect(new Set(handles).size).toBe(2);
        expect(state.slices.every((s:any)=>s.frame>0)).toBe(true);
        const left=await rpc.send('output_shared_texture_snapshot',{include_pixels:true,capture_source:'slice:left'}),right=await rpc.send('output_shared_texture_snapshot',{include_pixels:true,capture_source:'slice:right'});
        expect(pixel(left,0,0)).toEqual([0,0,0]);
        expect(pixel(left,5,5)).toEqual([0,0,0]);
        for(const y of [.25,.5,.75]) {
          const start=band.startTop*y+band.startBottom*(1-y),end=band.endTop*y+band.endBottom*(1-y);
          for(const t of [.25,.5,.75]) {
            const x=start+(end-start)*t;
            const [lx,ly]=locate(x,y,'left'),[rx,ry]=locate(x,y,'right');
            const total=linear(pixel(left,lx,ly)[0])+linear(pixel(right,rx,ry)[0]);
            expect(Math.abs(total-linear(value)),`brightness at ${x},${y}, content ${value}`).toBeLessThan(.05);
          }
        }
      }
      // A coordinate image catches crop/geometry errors that a uniform gray cannot.
      await rpc.commands([{type:'upload_source_frame',source_id:'calibration-image',width:128,height:128,seq:3,
        rgba_b64:Buffer.from(Array.from({length:128*128},(_,i)=>[Math.round((i%128)/127*255),Math.round(Math.floor(i/128)/127*255),0,255]).flat()).toString('base64')}]);
      await new Promise(r=>setTimeout(r,100));
      const images: any[]=[];
      for (const id of ['left','right']) images.push(await rpc.send('output_shared_texture_snapshot',{include_pixels:true,capture_source:`slice:${id}`}));
      for(const y of [.25,.5,.75]) {
        const samples=['left','right'].map((side,index)=>{const [px,py]=locate(.5,y,side);return pixel(images[index],px,py);});
        // Complementary weights restore the original coordinate image's light.
        expect(Math.abs(linear(samples[0][0])+linear(samples[1][0])-linear(128))).toBeLessThan(.035);
        expect(Math.abs(linear(samples[0][1])+linear(samples[1][1])-linear((1-y)*255))).toBeLessThan(.04);
      }
      // Edit already-open outputs: keep the export handles and verify the
      // live pixels change without reopening or using frame_snapshot.
      const before = await rpc.send('get_slice_output_state');
      await rpc.commands([upload(180,4)]);
      await rpc.send('set_slice_outputs',{slices:[slice('left'),slice('right')]});
      await new Promise(r=>setTimeout(r,100));
      const after = await rpc.send('get_slice_output_state');
      for (const original of before.slices) {
        const updated = after.slices.find((s:any)=>s.id===original.id);
        expect(updated.shared_name ?? updated.handle).toBe(original.shared_name ?? original.handle);
        expect(updated.frame).toBeGreaterThan(original.frame);
      }
      const reset = await rpc.send('output_shared_texture_snapshot',{include_pixels:true,capture_source:'slice:left'});
      expect(pixel(reset,5,5)[0]).toBeGreaterThan(150);
    } finally { await rpc.close(); }
  },30000);

  it('keeps inside, cuts inverted holes, feathers monotonically and follows a corner-pinned screen', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 32, target_fps: 30 } });
      // One solid white layer over the whole master, so every non-black
      // output pixel is the mask alone.
      await rpc.commands([
        { type: 'upload_source_frame', source_id: 'white', width: 32, height: 32, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 32 * 32 }, () => [255, 255, 255, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'white', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'white', source_id: 'white', uri: 'mask-test://white', source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: 'white', visible: true },
      ]);
      await expect.poll(async () => {
        const frame = await rpc.send('frame_snapshot', { include_pixels: true });
        return pixel(frame, 64, 64);
      }, { timeout: 8000, interval: 30 }).toEqual([255, 255, 255]);

      const masks = [
        // Keep the middle of the frame with a wide feather...
        { id: 'keep', enabled: true, invert: false, feather: 0.3, points: rect(0.05, 0.05, 0.95, 0.95) },
        // ...and punch a hard hole near the top-right corner.
        { id: 'hole', enabled: true, invert: true, feather: 0, points: rect(0.7, 0.7, 0.9, 0.9) },
        // Neither of these may change anything.
        { id: 'off', enabled: false, invert: true, feather: 0, points: rect(0.4, 0.4, 0.6, 0.6) },
        { id: 'line', enabled: true, invert: true, feather: 0, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ];
      const pinned = {
        topLeft: { x: 0.1, y: 0.95 }, topRight: { x: 0.8, y: 0.9 },
        bottomRight: { x: 0.95, y: 0.15 }, bottomLeft: { x: 0.2, y: 0.05 },
      };
      const applied = await rpc.send('set_slice_outputs', { slices: [
        slice('plain', { masks }),
        slice('pinned', { warpMode: 'corners', corners: pinned, masks }),
        slice('bare'),
      ] });
      expect(applied.slices).toEqual(['plain', 'pinned', 'bare']);

      const plain = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(Number(plain.width)).toBe(SIZE);
      // Inside the kept region, past the feather: untouched white.
      expect(pixel(plain, col(0.5), row(0.5))).toEqual([255, 255, 255]);
      // Outside the keep polygon: black on every side.
      expect(pixel(plain, col(0.02), row(0.5))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.98), row(0.5))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.5), row(0.02))).toEqual([0, 0, 0]);
      expect(pixel(plain, col(0.5), row(0.98))).toEqual([0, 0, 0]);
      // Inside the inverted hole: black, even though the keep mask covers it.
      expect(pixel(plain, col(0.8), row(0.8))).toEqual([0, 0, 0]);
      // Just outside the hole, still inside the keep ramp: lit.
      expect(pixel(plain, col(0.65), row(0.65))[0]).toBeGreaterThan(40);
      // The feather ramps monotonically from the keep edge (u=0.05) to full
      // strength 0.3 further in, and is genuinely partial in the middle.
      const ramp = Array.from({ length: col(0.36) - col(0.05) + 1 }, (_, i) => pixel(plain, col(0.05) + i, row(0.5))[0]);
      for (let i = 1; i < ramp.length; i++) expect(ramp[i], `ramp step ${i}: ${ramp.join(',')}`).toBeGreaterThanOrEqual(ramp[i - 1]);
      expect(ramp[0]).toBeLessThan(20);
      expect(ramp[ramp.length - 1]).toBe(255);
      const middle = pixel(plain, col(0.2), row(0.5))[0];
      expect(middle).toBeGreaterThan(20);
      expect(middle).toBeLessThan(235);

      // Corner-pinning the screen re-maps what the projector samples, but
      // the masks are cut from the projector's frame, so every masked
      // pixel stays exactly where it was.
      const warped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'pinned' });
      expect(Buffer.from(warped.rgba_b64, 'base64').equals(Buffer.from(plain.rgba_b64, 'base64'))).toBe(true);

      // Same under the Master Warp, which is how the Screens panel corner-
      // pins today: the screen samples the master-warped frame, the mask is
      // still cut from the screen's own frame. The pull-in (0.03) stays
      // inside the region the keep mask already blacks out.
      await rpc.send('submit_commands', { commands: [{ type: 'set_output_stage', masterWarp: {
        enabled: true, mode: 'corners', corners: {
          topLeft: { x: 0.03, y: 0.02 }, topRight: { x: 0.98, y: 0.03 },
          bottomRight: { x: 0.97, y: 0.98 }, bottomLeft: { x: 0.02, y: 0.97 },
        },
      } }] });
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks }), slice('bare')] });
      const masterWarped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(Buffer.from(masterWarped.rgba_b64, 'base64').equals(Buffer.from(plain.rgba_b64, 'base64'))).toBe(true);
      // The warp really is on: an unmasked screen loses its outer corner.
      const bareWarped = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' });
      expect(pixel(bareWarped, 0, 0)).toEqual([0, 0, 0]);
      expect(pixel(bareWarped, 64, 64)).toEqual([255, 255, 255]);
      await rpc.send('submit_commands', { commands: [{ type: 'set_output_stage', masterWarp: { enabled: false } }] });
      // Slices copy the master warp when applied, so re-send them unwarped.
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks }), slice('bare')] });

      // A screen without masks, and a screen whose only masks are unusable,
      // show the full frame.
      const bare = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'bare' });
      expect(pixel(bare, col(0.02), row(0.5))).toEqual([255, 255, 255]);
      expect(pixel(bare, col(0.8), row(0.8))).toEqual([255, 255, 255]);
      await rpc.send('set_slice_outputs', { slices: [slice('plain', { masks: masks.slice(2) })] });
      const unusable = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'plain' });
      expect(pixel(unusable, col(0.5), row(0.5))).toEqual([255, 255, 255]);
      expect(pixel(unusable, col(0.02), row(0.5))).toEqual([255, 255, 255]);

      await expect(rpc.send('frame_snapshot', { include_pixels: false, slice_id: 'missing' })).rejects.toThrow(/unknown screen output/);
      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error ?? null).toBeNull();
      expect(status.last_frame_error ?? null).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 90000);

  it('cuts a curved mask along its cubic with a monotonic feather, matching the preview', async () => {
    // An arch: the top edge is one cubic from (0.1, 0.6) to (0.9, 0.6)
    // through handles at (0.3, 0.05) and (0.7, 0.05), authored in the
    // editor's screen space (y down), so snapshot rows are editor y.
    const a = { x: 0.1, y: 0.6 }, c1 = { x: 0.3, y: 0.05 }, c2 = { x: 0.7, y: 0.05 }, b = { x: 0.9, y: 0.6 };
    const arch = (feather: number): ScreenMask => ({
      id: 'arch', name: 'Arch', enabled: true, invert: false, feather,
      points: [{ ...a, cpOut: c1 }, { ...b, cpIn: c2 }, { x: 0.9, y: 0.97 }, { x: 0.1, y: 0.97 }],
    });
    const cubicAt = (t: number) => {
      const mt = 1 - t;
      const w = [mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t];
      return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y };
    };
    /** The arch's y at canvas x (x(t) rises monotonically here). */
    const archY = (x: number) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cubicAt(mid).x < x) lo = mid; else hi = mid; }
      return cubicAt((lo + hi) / 2).y;
    };
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 32, target_fps: 30 } });
      await rpc.commands([
        { type: 'upload_source_frame', source_id: 'white', width: 32, height: 32, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 32 * 32 }, () => [255, 255, 255, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'white', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'white', source_id: 'white', uri: 'mask-test://white', source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: 'white', visible: true },
      ]);
      await expect.poll(async () => pixel(await rpc.send('frame_snapshot', { include_pixels: true }), 64, 64),
        { timeout: 8000, interval: 30 }).toEqual([255, 255, 255]);

      // Hard edge: the cut follows the cubic to the pixel.
      await rpc.send('set_slice_outputs', { slices: [slice('hard', { masks: nativeScreenMasks([arch(0)]) })] });
      const hard = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'hard' });
      let worst = 0;
      for (let c = col(0.14); c <= col(0.86); c++) {
        const x = (c + 0.5) / SIZE;
        let first = SIZE;
        for (let r = 0; r < SIZE; r++) if (pixel(hard, c, r)[0] > 127) { first = r; break; }
        const expected = archY(x) * SIZE - 0.5;
        worst = Math.max(worst, Math.abs(first - expected));
        expect(Math.abs(first - expected), `column ${c}: first lit row ${first}, curve at ${expected.toFixed(2)}`).toBeLessThanOrEqual(1);
      }
      // It is a curve, not the straight chord from a to b: the apex is lit
      // far above y = 0.6.
      expect(pixel(hard, col(0.5), Math.round(0.35 * SIZE))).toEqual([255, 255, 255]);
      expect(pixel(hard, col(0.5), Math.round(archY(0.5) * SIZE) - 3)).toEqual([0, 0, 0]);

      // Feathered: straight down from the curve the ramp only ever rises,
      // from black at the edge to full white once 0.1 away from it, at the apex
      // and on the flanks.
      await rpc.send('set_slice_outputs', { slices: [slice('soft', { masks: nativeScreenMasks([arch(0.1)]) })] });
      const soft = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'soft' });
      for (const x of [0.3, 0.5, 0.72]) {
        const c = col(x);
        const top = Math.floor(archY((c + 0.5) / SIZE) * SIZE) - 1;
        const ramp = Array.from({ length: Math.ceil(0.25 * SIZE) }, (_, i) => pixel(soft, c, top + i)[0]);
        for (let i = 1; i < ramp.length; i++) expect(ramp[i], `x=${x} step ${i}: ${ramp.join(',')}`).toBeGreaterThanOrEqual(ramp[i - 1]);
        expect(ramp[0]).toBeLessThan(10);
        expect(ramp[ramp.length - 1]).toBe(255);
        expect(ramp.some(v => v > 40 && v < 215), `x=${x}: ${ramp.join(',')}`).toBe(true);
      }

      // The editor preview shades exactly what the projector loses, a
      // curved hole included.
      const masks: ScreenMask[] = [arch(0.1), {
        id: 'hole', name: 'Hole', enabled: true, invert: true, feather: 0.04,
        points: [{ x: 0.4, y: 0.7, cpOut: { x: 0.5, y: 0.55 } }, { x: 0.6, y: 0.7, cpIn: { x: 0.5, y: 0.55 }, cpOut: { x: 0.6, y: 0.9 } },
          { x: 0.4, y: 0.9, cpIn: { x: 0.6, y: 0.9 } }],
      }];
      await rpc.send('set_slice_outputs', { slices: [slice('both', { masks: nativeScreenMasks(masks) })] });
      const both = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'both' });
      let off = 0;
      let worstLevel = 0;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const expected = 255 * screenMaskAlpha(masks, { x: (c + 0.5) / SIZE, y: (r + 0.5) / SIZE });
          const diff = Math.abs(pixel(both, c, r)[0] - expected);
          worstLevel = Math.max(worstLevel, diff);
          if (diff > 2) off++;
        }
      }
      expect(off, `${off} pixels differ from the preview by more than 2 levels, worst ${worstLevel}`).toBe(0);
      expect(worst).toBeLessThanOrEqual(1);
      const status = await rpc.send('status', {}, 5000);
      expect(status.last_shader_error ?? null).toBeNull();
    } finally {
      await rpc.close();
    }
  }, 90000);

  it('matches the editor preview mask shading pixel for pixel, through a corner pin and projector calibration', async () => {
    // Authored the way the Screens inspector stores them: screen content
    // space, y=0 at the top. They reach the core through the real sync
    // conversion, and the snapshot is top row first, so snapshot pixel
    // (col, row) and editor point ((col + .5) / SIZE, (row + .5) / SIZE)
    // are the same spot on the projector with no flips in this test.
    const editorMasks: ScreenMask[] = [
      { id: 'a', name: 'Arch', enabled: true, invert: false, feather: 0.3,
        points: [{ x: 0.08, y: 0.9 }, { x: 0.12, y: 0.2 }, { x: 0.5, y: 0.04 }, { x: 0.93, y: 0.22 }, { x: 0.9, y: 0.92 }] },
      { id: 'b', name: 'Door', enabled: true, invert: true, feather: 0,
        points: [{ x: 0.42, y: 0.55 }, { x: 0.61, y: 0.55 }, { x: 0.61, y: 0.97 }, { x: 0.42, y: 0.97 }] },
    ];
    const calibration = [{ x: 0.15, y: 0.08 }, { x: 0.88, y: 0.18 }, { x: 0.95, y: 0.92 }, { x: 0.04, y: 0.85 }];
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: SIZE, height: SIZE, source_frame_size: 32, target_fps: 30 } });
      await rpc.commands([
        { type: 'upload_source_frame', source_id: 'white', width: 32, height: 32, seq: 1,
          rgba_b64: Buffer.from(Array.from({ length: 32 * 32 }, () => [255, 255, 255, 255]).flat()).toString('base64') },
        { type: 'upsert_layer', layer_id: 'white', z_index: 0, opacity: 1, blend_mode: 'normal',
          corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } },
        { type: 'bind_media_source', layer_id: 'white', source_id: 'white', uri: 'mask-test://white', source_type: 'image' },
        { type: 'set_layer_visibility', layer_id: 'white', visible: true },
      ]);
      await expect.poll(async () => pixel(await rpc.send('frame_snapshot', { include_pixels: true }), 64, 64),
        { timeout: 8000, interval: 30 }).toEqual([255, 255, 255]);
      await rpc.send('set_slice_outputs', { slices: [
        slice('flat', { masks: nativeScreenMasks(editorMasks) }),
        slice('pinned', { warpMode: 'corners', masks: nativeScreenMasks(editorMasks), corners: {
          topLeft: { x: 0.2, y: 0.05 }, topRight: { x: 0.9, y: 0.1 },
          bottomRight: { x: 0.8, y: 0.95 }, bottomLeft: { x: 0.05, y: 0.85 },
        } }),
        // Masks live in the screen's content space, so a keystone-corrected
        // projector carries them onto the surface with the picture.
        slice('calibrated', { masks: nativeScreenMasks(editorMasks),
          projectorCalibration: projectorCalibrationUniforms({ projectorCalibration: { enabled: true, corners: calibration } }) }),
      ] });
      for (const id of ['flat', 'pinned']) {
        const frame = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: id });
        let worst = 0;
        let off = 0;
        for (let row = 0; row < SIZE; row++) {
          for (let c = 0; c < SIZE; c++) {
            const expected = 255 * screenMaskAlpha(editorMasks, { x: (c + 0.5) / SIZE, y: (row + 0.5) / SIZE });
            const diff = Math.abs(pixel(frame, c, row)[0] - expected);
            worst = Math.max(worst, diff);
            if (diff > 2) off++;
          }
        }
        // The core evaluates in f32, the preview in f64; allow rounding only.
        expect(off, `${id}: ${off} pixels differ by more than 2 levels, worst ${worst}`).toBe(0);
      }
      // Calibrated: projector pixel -> inverse homography -> content point,
      // black outside the corrected quad. Pixels the quad edge crosses are
      // partial coverage either way, so they are left out.
      const h = inverseProjectorHomography(calibration)!;
      const calibrated = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'calibrated' });
      let calibratedOff = 0;
      let calibratedWorst = 0;
      for (let row = 0; row < SIZE; row++) {
        for (let c = 0; c < SIZE; c++) {
          const px = (c + 0.5) / SIZE, py = (row + 0.5) / SIZE;
          const z = h[6] * px + h[7] * py + h[8];
          const q = { x: (h[0] * px + h[1] * py + h[2]) / z, y: (h[3] * px + h[4] * py + h[5]) / z };
          const edge = Math.min(q.x, q.y, 1 - q.x, 1 - q.y);
          if (Math.abs(edge) < 2 / SIZE) continue;
          const expected = edge < 0 ? 0 : 255 * screenMaskAlpha(editorMasks, q);
          const diff = Math.abs(pixel(calibrated, c, row)[0] - expected);
          calibratedWorst = Math.max(calibratedWorst, diff);
          if (diff > 3) calibratedOff++;
        }
      }
      expect(calibratedOff, `calibrated: ${calibratedOff} pixels off, worst ${calibratedWorst}`).toBe(0);
      // The doorway is on the bottom edge of the projected image, as drawn.
      const flat = await rpc.send('frame_snapshot', { include_pixels: true, slice_id: 'flat' });
      expect(pixel(flat, col(0.5), SIZE - 4)).toEqual([0, 0, 0]);
      expect(pixel(flat, col(0.5), 51)).toEqual([255, 255, 255]);
    } finally {
      await rpc.close();
    }
  }, 90000);
});
