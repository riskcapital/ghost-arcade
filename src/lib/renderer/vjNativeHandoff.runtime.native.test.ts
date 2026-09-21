// Live A/B hand-offs through the real render core. Triggering deck B on a row
// deck A is already playing swaps that row onto a crossfade carrier in one
// transaction; neither the VJ Mix nor a Screen bound to the row may show
// anything but the row's picture while that happens.
//
// Each case runs in several fresh core processes: the core used to run graph
// jobs in HashMap order, which is seeded per process, so a single process
// could pass or fail on luck alone.
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLayer } from '../types';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands } from './vjClipTransitionNative';
import { buildVJCrossfadeGraph, buildVJCrossfadePrecompileCommands } from './vjCrossfadeNative';
import { buildVJMixGraph, buildVJMixPrecompileCommands, buildVJPipelineWarmupCommands } from './vjMixNative';

const nativeCoreBin = join(process.cwd(), 'native-renderer/target/release', process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;
// The live output readback the Screen case watches exists on macOS and Windows.
const itIfLiveOutput = existsSync(nativeCoreBin) && process.platform !== 'linux' ? it : it.skip;

type Rpc = {
  send: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>;
  close: () => void;
};

function createRpc(): Rpc {
  const child: ChildProcessWithoutNullStreams = spawn(nativeCoreBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let nextId = 1;
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const entry = message.id ? pending.get(message.id) : undefined;
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(JSON.stringify(message.error)));
      else entry.res(message.result);
    } catch {
      /* non-JSON core output */
    }
  });
  return {
    send(method, params = {}, timeoutMs = 15000) {
      const id = nextId++;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`native core RPC timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, {
          res: (v) => { clearTimeout(timer); res(v); },
          rej: (e) => { clearTimeout(timer); rej(e); },
        });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
      });
    },
    close() {
      try {
        child.stdin.write(JSON.stringify({ id: nextId++, method: 'shutdown', params: {} }) + '\n');
      } catch {
        /* already gone */
      }
      child.kill();
    },
  };
}

const W = 64;
const H = 36;
const FULL = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };
const COLOURS: Record<string, [number, number, number]> = {
  'src:red': [255, 0, 0],
  'src:green': [0, 255, 0],
  'src:blue': [0, 0, 255],
};

function solidB64([r, g, b]: [number, number, number]): string {
  const px = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px.toString('base64');
}

function mediaLayer(id: string, z: number, source: string, opacity: number) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, blend_mode: 'normal', opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'upload_source_frame', source_id: source, width: 16, height: 16, rgba_b64: solidB64(COLOURS[source]), seq: 1 },
    { type: 'bind_media_source', layer_id: id, source_id: source, uri: `upload://${source}`, source_type: 'image' },
  ];
}

function graphLayer(id: string, z: number, kind: 'vj-crossfade' | 'vj-mix', config: unknown, opacity: number) {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, blend_mode: 'normal', opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    {
      type: 'set_native_graph_layer',
      layer_id: id,
      kind,
      instrument_source_id: `plugin:${id}:${kind}`,
      composite_source_id: `plugin:${id}:${kind}`,
      input_source_id: null,
      effect_graph: config,
      params: {},
    },
  ];
}

function crossfadeConfig(outputSourceId: string) {
  return buildVJCrossfadeGraph({
    outputSourceId,
    sourceAId: 'layer-frame:vj-layer-0-A',
    sourceBId: 'layer-frame:vj-layer-0-B',
    width: W,
    height: H,
    mix: 0,
    transition: 'dissolve',
    blendMode: 'normal',
    opacityA: 1,
    opacityB: 1,
    time: 0,
    frameIndex: 0,
  }).config;
}

function mixConfig(topRowFrame: string) {
  return buildVJMixGraph({
    outputSourceId: 'plugin:__vj-mix__:vj-mix',
    rows: [
      { frameId: 'layer-frame:vj-layer-1-A', opacity: 1, blendMode: 'normal' },
      { frameId: topRowFrame, opacity: 1, blendMode: 'normal' },
    ],
    width: W,
    height: H,
    time: 0,
    frameIndex: 0,
  }).config;
}

/** 'red' | 'green' | 'blue' | 'black' | 'other', from a snapshot's mean colour. */
function colourOf(snapshot: { mean_rgba: number[] }): string {
  const [r, g, b] = snapshot.mean_rgba;
  if (r > 0.4 && g < 0.05 && b < 0.05) return 'red';
  if (g > 0.4 && r < 0.05 && b < 0.05) return 'green';
  if (b > 0.4 && r < 0.05 && g < 0.05) return 'blue';
  if (r < 0.02 && g < 0.02 && b < 0.02) return 'black';
  return 'other';
}

async function watch(rpc: Rpc, method: string, ms: number): Promise<string[]> {
  const seen: string[] = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    // The live output readback refuses while a capture is in flight.
    const snapshot = await rpc.send(method, {}).catch(() => null);
    if (!snapshot) continue;
    const colour = colourOf(snapshot);
    if (seen[seen.length - 1] !== colour) seen.push(colour);
  }
  return seen;
}

async function settleOn(rpc: Rpc, colour: string) {
  for (let i = 0; i < 400; i++) {
    if (colourOf(await rpc.send('frame_snapshot', {})) === colour) return;
  }
  throw new Error(`output never settled on ${colour}`);
}

async function startCore(rpc: Rpc, targetFps: number) {
  await rpc.send('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width: W,
      height: H,
      target_fps: targetFps,
      native_quality_policy: 'fixed',
    },
  }, 20000);
  await rpc.send('submit_commands', {
    commands: [...buildVJCrossfadePrecompileCommands(), ...buildVJMixPrecompileCommands()],
  });
}

describe('native VJ A/B row hand-off', () => {
  itIfNativeCore('scheduled cuts reach VJ Mix through the steady transition wrapper', async () => {
    const rpc=createRpc();
    try {
      await startCore(rpc,60);
      const row='vj-layer-0', input='__vj-clip:vj-layer-0:steady:in';
      const output=`plugin:${row}:vj-crossfade`;
      const branch={layer:createLayer(row,'','media'),opacity:1,premultiplied:false,
        uvTransform:[0,0,1,1],uvFlags:[0,1,0,0]};
      const wrapper=buildVJClipTransitionGraph({outputSourceId:output,sourceAId:`layer-frame:${input}`,
        sourceBId:`layer-frame:${input}`,width:W,height:H,mix:1,transition:'dissolve',
        branchA:branch,branchB:branch,time:0,frameIndex:0}).config;
      const mix=buildVJMixGraph({outputSourceId:'plugin:__vj-mix__:vj-mix',
        rows:[{frameId:`layer-frame:${row}`,opacity:1,blendMode:'normal'}],width:W,height:H,time:0,frameIndex:0}).config;
      await rpc.send('submit_commands',{commands:[...buildVJClipTransitionPrecompileCommands(),
        ...mediaLayer(input,0,'src:red',0),...graphLayer(row,1,'vj-crossfade',wrapper,0),
        ...graphLayer('__vj-mix__',2,'vj-mix',mix,1)]});
      await settleOn(rpc,'red');
      await rpc.send('submit_commands',{commands:[{type:'upload_source_frame',source_id:'src:blue',
        width:16,height:16,rgba_b64:solidB64(COLOURS['src:blue']),seq:1}]});
      // Images must be registered for a prepared binding just like video sources.
      await rpc.send('submit_commands',{commands:[{type:'set_media_source_playback',source_id:'src:blue',uri:'upload://src:blue',source_type:'image',paused:true}]});
      await rpc.send('schedule_launch',{id:'wrapped-cut',lane:'vj-cut:A:0',revision:1,delay_ms:100,
        expected_sources:{[input]:{source_id:'src:red'}},
        commands:[{type:'bind_media_source',layer_id:input,source_id:'src:blue',uri:'upload://src:blue',source_type:'image'}]});
      await new Promise(resolve=>setTimeout(resolve,180));
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      await settleOn(rpc,'blue');
      // A delayed pre-cut scene sync must not restore the old input.
      await rpc.send('submit_commands',{commands:[{type:'bind_media_source',layer_id:input,source_id:'src:red',uri:'upload://src:red',source_type:'image'}]});
      expect(await watch(rpc,'frame_snapshot',150)).toEqual(['blue']);
      const rows=(await rpc.send('layers_snapshot')).layers;
      expect(rows.find((value:any)=>value.layer_id===row).source_id).toBe(output);
      expect(rows.find((value:any)=>value.layer_id===input).source_id).toBe('src:blue');
    } finally { rpc.close(); }
  },20000);

  itIfNativeCore('scheduled deck cuts preserve the live crossfade graph and opposite deck', async () => {
    const rpc=createRpc();
    try {
      await startCore(rpc,60);
      const output='plugin:vj-xfade-0:vj-crossfade';
      const config=buildVJCrossfadeGraph({outputSourceId:output,sourceAId:'layer-frame:vj-layer-0-A',
        sourceBId:'layer-frame:vj-layer-0-B',width:W,height:H,mix:0.5,transition:'dissolve',
        blendMode:'normal',opacityA:1,opacityB:1,time:0,frameIndex:0}).config;
      await rpc.send('submit_commands',{commands:[
        ...mediaLayer('vj-layer-0-A',0,'src:red',0),
        ...mediaLayer('vj-layer-0-B',1,'src:blue',0),
        ...mediaLayer('prepare',2,'src:green',0),
        ...graphLayer('vj-xfade-0',3,'vj-crossfade',config,1),
      ]});
      const mean=async()=> (await rpc.send('frame_snapshot')).mean_rgba as number[];
      let before=await mean();
      for(let i=0;i<100 && !(before[0]>0.15 && before[2]>0.15);i++) {
        await new Promise(resolve=>setTimeout(resolve,20)); before=await mean();
      }
      expect(before[0]).toBeGreaterThan(0.15); expect(before[2]).toBeGreaterThan(0.15);
      await rpc.send('schedule_launch',{id:'deck-b',lane:'vj-cut:B:0',revision:1,delay_ms:80,
        expected_sources:{'vj-layer-0-B':{source_id:'src:blue'}},
        commands:[{type:'bind_media_source',layer_id:'vj-layer-0-B',source_id:'src:green',uri:'upload://src:green',source_type:'image'}]});
      await new Promise(resolve=>setTimeout(resolve,180));
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      const after=await mean();
      expect(after[0]).toBeCloseTo(before[0],1);
      expect(after[1]).toBeGreaterThan(0.15); expect(after[2]).toBeLessThan(0.05);
      const rows=(await rpc.send('layers_snapshot')).layers;
      expect(rows.find((row:any)=>row.layer_id==='vj-layer-0-A').source_id).toBe('src:red');
      expect(rows.find((row:any)=>row.layer_id==='vj-layer-0-B').source_id).toBe('src:green');
      await rpc.send('submit_commands',{commands:mediaLayer('prepare-a',2,'src:blue',0)});
      await rpc.send('schedule_launch',{id:'deck-a',lane:'vj-cut:A:0',revision:2,delay_ms:80,
        expected_sources:{'vj-layer-0-A':{source_id:'src:red'}},
        commands:[{type:'bind_media_source',layer_id:'vj-layer-0-A',source_id:'src:blue',uri:'upload://src:blue',source_type:'image'}]});
      await new Promise(resolve=>setTimeout(resolve,180));
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      const final=await mean();
      expect(final[0]).toBeLessThan(0.05); expect(final[2]).toBeGreaterThan(0.15);
      expect(final[1]).toBeCloseTo(after[1],1);

    } finally { rpc.close(); }
  },20000);

  itIfNativeCore('the VJ Mix never shows the row beneath while a row moves onto its crossfade carrier', async () => {
    for (let run = 0; run < 4; run++) {
      const rpc = createRpc();
      try {
        // A slow frame clock, so the snapshots in between see every frame.
        await startCore(rpc, 6);
        await rpc.send('submit_commands', {
          commands: [
            ...mediaLayer('vj-layer-0-A', 0, 'src:red', 0),
            ...mediaLayer('vj-layer-1-A', 1, 'src:green', 0),
            ...graphLayer('__vj-mix__', 5, 'vj-mix', mixConfig('layer-frame:vj-layer-0-A'), 1),
          ],
        });
        await settleOn(rpc, 'red');
        // Deck B joins row 0: bank B, the carrier, and the mix now reading
        // the carrier, all in one transaction, as the renderer sync sends it.
        await rpc.send('submit_commands', {
          commands: [
            ...mediaLayer('vj-layer-0-B', 2, 'src:blue', 0),
            ...graphLayer('vj-xfade-0', 3, 'vj-crossfade', crossfadeConfig('plugin:vj-xfade-0:vj-crossfade'), 0),
            ...graphLayer('__vj-mix__', 5, 'vj-mix', mixConfig('layer-frame:vj-xfade-0'), 1),
          ],
        });
        const seen = await watch(rpc, 'frame_snapshot', 1200);
        expect(seen, `run ${run}`).toEqual(['red']);
      } finally {
        rpc.close();
      }
    }
  }, 120000);

  itIfLiveOutput('a Screen bound to the row never goes black when it switches to its crossfade copy', async () => {
    for (let run = 0; run < 3; run++) {
      const rpc = createRpc();
      try {
        await startCore(rpc, 60);
        await rpc.send('submit_commands', { commands: buildVJPipelineWarmupCommands() });
        await new Promise((resolve) => setTimeout(resolve, 400));
        await rpc.send('submit_commands', {
          commands: [
            ...mediaLayer('vj-layer-0-A', 0, 'src:red', 0),
            ...mediaLayer('vj-layer-0-B', 1, 'src:blue', 0),
            ...mediaLayer('screen', 5, 'src:red', 1),
          ],
        });
        await settleOn(rpc, 'red');
        await rpc.send('submit_commands', {
          commands: graphLayer('screen', 5, 'vj-crossfade', crossfadeConfig('plugin:screen:vj-crossfade'), 1),
        });
        // What was actually presented, not a snapshot composited between frames.
        const seen = await watch(rpc, 'output_shared_texture_snapshot', 600);
        expect(seen, `run ${run}`).toEqual(['red']);
      } finally {
        rpc.close();
      }
    }
  }, 120000);
});
