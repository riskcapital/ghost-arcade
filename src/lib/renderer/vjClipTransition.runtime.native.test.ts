import { describe, expect, it } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createLayer, type Layer } from '../types';
import { hardwareTestPlatform as platform, closeNativeTestCore } from './nativeHardwareTestPlatform';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands, buildVJClipTransitionUniformUpdate, type VJClipTransitionGraphOptions } from './vjClipTransitionNative';
import { buildVJMixGraph, buildVJMixPrecompileCommands } from './vjMixNative';
import { VJ_CROSSFADE_TRANSITION_IDS } from './vjCrossfadeNative';
const hardwareDescribe = platform.runnable ? describe : describe.skip;
const FULL = createLayer('', '', 'media').corners;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Command = Record<string, unknown>;

function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let nextId = 0;
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (value) => { stderr = (stderr + value).slice(-8000); });
  child.on('error', (error) => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(`${response.error}: ${stderr}`));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: ${stderr}`)); }, 15000);
    pending.set(id, {
      resolve(value) { clearTimeout(timeout); resolve(value); },
      reject(error) { clearTimeout(timeout); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  return {
    send, commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } finally { await closeNativeTestCore(child); } },
  };
}
type Core = ReturnType<typeof core>;

function solid(sourceId: string, rgba: number[], width = 16, height = 16, rect = false): Command {
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buffer.length; i += 4) buffer.set(rgba, i);
  return { type: 'upload_source_frame', source_id: sourceId, seq: 1, width, height,
    rgba_b64: buffer.toString('base64'), ...(rect ? { placement: 'rect' } : {}) };
}
function imageLayer(id: string, source: string, z: number, opacity: number): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'bind_media_source', layer_id: id, source_id: source, source_type: 'image', uri: `upload://${source}` },
  ];
}
function graphLayer(id: string, sourceId: string, config: unknown, z = 1, opacity = 1, kind = 'vj-crossfade'): Command[] {
  return [
    { type: 'upsert_layer', layer_id: id, z_index: z, opacity, corners: FULL },
    { type: 'set_layer_visibility', layer_id: id, visible: true },
    { type: 'set_native_graph_layer', layer_id: id, kind,
      instrument_source_id: sourceId, composite_source_id: sourceId,
      input_source_id: null, effect_graph: config, params: { vjclipTransition: true } },
  ];
}
function options(layerA?: Layer, layerB?: Layer): VJClipTransitionGraphOptions {
  return {
    outputSourceId: 'plugin:clip:vj-crossfade', sourceAId: 'src:red', sourceBId: 'src:blue',
    width: 64, height: 36, mix: 0.5, transition: 'dissolve', time: 0, frameIndex: 0,
    branchA: { layer: layerA ?? createLayer('out', '', 'media'), opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] },
    branchB: { layer: layerB ?? createLayer('in', '', 'media'), opacity: 1, premultiplied: false, uvTransform: [0, 0, 1, 1], uvFlags: [0, 1, 0, 0] },
  };
}
async function start(rpc: Core) {
  const status = await rpc.send('start', { config: { backend: platform.rendererBackend,
    width: 64, height: 36, source_frame_size: 256, target_fps: 60, native_quality_policy: 'fixed' } });
  expect(status.backend_ready).toBe(true);
  expect(status.adapter_is_software).toBe(false);
  await rpc.commands([
    ...buildVJClipTransitionPrecompileCommands(), ...buildVJMixPrecompileCommands(),
    solid('src:green', [0, 255, 0, 255]), ...imageLayer('background', 'src:green', 100, 1),
  ]);
}
async function settledMean(rpc: Core): Promise<number[]> {
  await sleep(100);
  return (await rpc.send('frame_snapshot')).mean_rgba;
}
async function eventuallyMean(rpc: Core, check: (value: number[]) => boolean): Promise<number[]> {
  let value: number[] = [];
  for (let i = 0; i < 80; i++) {
    value = await settledMean(rpc);
    if (check(value)) return value;
  }
  throw new Error(`Unexpected rendered colour: ${JSON.stringify(value)}; ${JSON.stringify(await rpc.send('status'))}`);
}

hardwareDescribe('native clip transition pixels', () => {
  it('launches a mixed cut/fade column but rejects rebinding a fade input or carrier', async () => {
    const rpc=core();
    try {
      await start(rpc);
      expect((await rpc.send('capabilities')).features.native_mixed_column_launch).toBe(true);
      await rpc.commands([solid('src:red',[255,0,0,255]),solid('src:blue',[0,0,255,255]),
        ...imageLayer('cut','src:red',1,0.5),...imageLayer('fade-input','src:blue',0,0)]);
      const opts={...options(),mix:0,sourceBId:'layer-frame:fade-input'};
      const graph=graphLayer('fade',opts.outputSourceId,buildVJClipTransitionGraph(opts).config,2,0.5);
      graph.find(command=>command.type==='set_native_graph_layer')!.params={vjclipTransition:true,
        vjclipClockToken:81,vjclipClockDuration:0.6,vjclipClockRunning:false,vjxfadeMix:0};
      await rpc.commands(graph);
      await eventuallyMean(rpc,mean=>mean[0]>0.65 && mean[2]<0.05);
      const fade={type:'start_prepared_transition',layer_id:'fade',token:81,sources:[{source_id:'src:red'},{source_id:'src:blue'}]};
      const bind=(layer_id:string,source_id:string)=>({type:'bind_media_source',layer_id,source_id,uri:`upload://${source_id}`,source_type:'image'});
      for(const [index,target] of ['fade-input','fade'].entries()) {
        await rpc.send('schedule_launch',{id:`unsafe-${index}`,lane:'column:A',revision:index+1,delay_ms:30,
          commands:[bind('cut','src:blue'),bind(target,'src:red'),fade]});
        await sleep(100);
        expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
        expect((await rpc.send('layers_snapshot')).layers.find((row:any)=>row.layer_id==='cut').source_id).toBe('src:red');
      }
      await rpc.send('schedule_launch',{id:'mixed',lane:'column:A',revision:3,delay_ms:100,
        commands:[bind('cut','src:blue'),fade]});
      await sleep(250);
      const receipt=(await rpc.send('launch_status')).receipts.at(-1);
      expect(receipt.state).toBe('applied');expect(receipt.detail.summary.applied).toBe(2);
      expect((await rpc.send('layers_snapshot')).layers.find((row:any)=>row.layer_id==='cut').source_id).toBe('src:blue');
      const middle=(await rpc.send('frame_snapshot')).mean_rgba;
      expect(middle[0]).toBeGreaterThan(0.1);expect(middle[2]).toBeGreaterThan(0.1);
      await sleep(600);
      const final=(await rpc.send('frame_snapshot')).mean_rgba;
      expect(final[0]).toBeLessThan(0.05);expect(final[2]).toBeGreaterThan(0.65);
    } finally {await rpc.close();}
  },15000);

  it('starts a column of prepared fades together and rejects invalid participants atomically', async () => {
    const rpc=core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red',[255,0,0,255]),solid('src:blue',[0,0,255,255])]);
      const commands:Command[]=[];
      for(let row=0;row<2;row++) {
        const opts={...options(),mix:0,outputSourceId:`plugin:column-${row}:vj-crossfade`};
        const layers=graphLayer(`column-${row}`,opts.outputSourceId,buildVJClipTransitionGraph(opts).config,row+1,0.5);
        layers.find(command=>command.type==='set_native_graph_layer')!.params={vjclipTransition:true,
          vjclipClockToken:row+1,vjclipClockDuration:0.2+row*0.2,vjclipClockRunning:false,vjxfadeMix:0};
        commands.push(...layers);
      }
      await rpc.commands(commands);
      await eventuallyMean(rpc,mean=>mean[0]>0.65 && mean[2]<0.05);
      const starts=[0,1].map(row=>({type:'start_prepared_transition',layer_id:`column-${row}`,token:row+1,
        sources:[{source_id:'src:red'},{source_id:'src:blue'}]}));
      await rpc.send('schedule_launch',{id:'invalid-column-fade',lane:'column:A',revision:1,delay_ms:50,
        commands:[starts[0],{...starts[1],token:99}]});
      await sleep(500);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
      expect((await rpc.send('frame_snapshot')).mean_rgba[0]).toBeGreaterThan(0.65);
      await rpc.send('schedule_launch',{id:'column-fade',lane:'column:A',revision:2,delay_ms:150,commands:starts});
      expect((await rpc.send('frame_snapshot')).mean_rgba[2]).toBeLessThan(0.05);
      await sleep(700);
      const receipt=(await rpc.send('launch_status')).receipts.at(-1);
      expect(receipt.state).toBe('applied');expect(receipt.detail.summary.applied).toBe(2);
      const final=(await rpc.send('frame_snapshot')).mean_rgba;
      expect(final[0]).toBeLessThan(0.05);expect(final[2]).toBeGreaterThan(0.65);
    } finally {await rpc.close();}
  },15000);

  it('starts prepared video playback and ignores late paused preparation snapshots', async () => {
    const rpc=core(),dir=mkdtempSync(join(tmpdir(),'ghost-fade-')),uri=join(dir,'clip.mp4');
    try {
      execFileSync(process.env.GA_FFMPEG_PATH||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=128x96:r=30:d=4','-c:v','libx264','-pix_fmt','yuv420p',uri]);
      await start(rpc);
      expect((await rpc.send('capabilities')).features.native_prepared_fade_playback).toBe(true);
      await rpc.commands([solid('src:red',[255,0,0,255])]);
      const preparation={type:'set_media_source_playback',source_id:'fade-video',uri,source_type:'video',
        duration_seconds:4,time_seconds:0,paused:true,prepare_for_launch:true,loop_enabled:true,seek_generation:1,decode_width:128,decode_height:96};
      await rpc.commands([preparation]);
      let ready=false;
      for(let i=0;i<100;i++) {
        ready=(await rpc.send('get_source_frame_readiness',{source_id:'fade-video',seek_generation:1})).ready;
        if(ready)break;await sleep(20);
      }
      expect(ready).toBe(true);
      await rpc.commands([{type:'upsert_layer',layer_id:'fade-input',opacity:0,z_index:0,corners:FULL},
        {type:'bind_media_source',layer_id:'fade-input',source_id:'fade-video',uri,source_type:'video'}]);
      const opts={...options(),mix:0,sourceBId:'layer-frame:fade-input'};
      const commands=graphLayer('clip',opts.outputSourceId,buildVJClipTransitionGraph(opts).config);
      commands.find(command=>command.type==='set_native_graph_layer')!.params={vjclipTransition:true,vjclipTransitionActive:true,vjclipClockToken:71,
        vjclipClockDuration:0.3,vjclipClockRunning:false,vjxfadeMix:0};
      await rpc.commands(commands);
      await eventuallyMean(rpc,mean=>mean[0]>0.9);
      await rpc.send('schedule_launch',{id:'video-fade',lane:'fade',revision:1,delay_ms:100,commands:[
        {type:'set_media_source_playback',source_id:'fade-video',uri,time_seconds:0,paused:false,seek_generation:1},
        {type:'start_prepared_transition',layer_id:'clip',token:71,sources:[{source_id:'src:red'},{source_id:'fade-video',seek_generation:1}]}]});
      await sleep(250);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      const session=async()=> (await rpc.send('status')).native_video_sessions.find((value:any)=>value.source_id==='fade-video');
      const before=await session();
      await rpc.commands([preparation]); // delayed Canvas preparation metadata
      await sleep(200);
      const after=await session();
      expect(after.source_time_seconds).toBeGreaterThan(before.source_time_seconds+0.08);
      // A real transport pause is not preparation and must still be honored.
      await rpc.commands([{...preparation,prepare_for_launch:false,time_seconds:after.source_time_seconds}]);
      await sleep(150);const paused=await session();
      await sleep(150);expect((await session()).source_time_seconds).toBeCloseTo(paused.source_time_seconds,1);
      await rpc.commands([{...preparation,seek_generation:2,time_seconds:0.5}]);
      let nextReady=false;
      for(let i=0;i<100;i++) {
        nextReady=(await rpc.send('get_source_frame_readiness',{source_id:'fade-video',seek_generation:2})).ready;
        if(nextReady)break;await sleep(20);
      }
      expect(nextReady).toBe(true);

    } finally {await rpc.close();rmSync(dir,{recursive:true,force:true});}
  },15000);

  it('starts prepared fades on a native deadline with cancellation and token guards', async () => {
    const rpc=core();
    try {
      await start(rpc);
      expect((await rpc.send('capabilities')).features.native_scheduled_transition_start).toBe(true);
      await rpc.commands([solid('src:red',[255,0,0,255]),solid('src:blue',[0,0,255,255])]);
      const opts={...options(),mix:0};
      const commands=graphLayer('clip',opts.outputSourceId,buildVJClipTransitionGraph(opts).config);
      const graph=commands.find(command=>command.type==='set_native_graph_layer')!;
      const params={vjclipTransition:true,vjclipClockToken:41,vjclipClockDuration:0.25,vjclipClockRunning:false,vjxfadeMix:0};
      graph.params=params;
      await rpc.commands(commands);
      await eventuallyMean(rpc,mean=>mean[0]>0.9 && mean[2]<0.05);
      const startCommand={type:'start_prepared_transition',layer_id:'clip',token:41,
        sources:[{source_id:'src:red'},{source_id:'src:blue'}]};
      // Rejection must precede every other mutation in the transaction.
      await rpc.send('schedule_launch',{id:'bad-fade',lane:'fade',revision:1,delay_ms:30,
        commands:[{type:'set_layer_visibility',layer_id:'clip',visible:false},{...startCommand,token:40}]});
      await sleep(100);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
      expect((await rpc.send('layers_snapshot')).layers.find((row:any)=>row.layer_id==='clip').visible).toBe(true);
      await rpc.send('schedule_launch',{id:'cancel-fade',lane:'fade',revision:2,delay_ms:100,commands:[startCommand]});
      await rpc.send('cancel_launch',{lane:'fade',revision:3});
      await sleep(180);
      expect((await rpc.send('frame_snapshot')).mean_rgba[0]).toBeGreaterThan(0.9);
      await rpc.send('schedule_launch',{id:'start-fade',lane:'fade',revision:4,delay_ms:200,commands:[startCommand]});
      expect((await rpc.send('frame_snapshot')).mean_rgba[0]).toBeGreaterThan(0.9);
      await sleep(300);
      await rpc.commands([{...graph,effect_graph:null}]); // delayed prepared metadata must retain the running graph
      await sleep(250);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      expect((await rpc.send('frame_snapshot')).mean_rgba[2]).toBeGreaterThan(0.9);
      await rpc.commands([graph]); // stale prepared-state sync after native start
      expect((await settledMean(rpc))[2]).toBeGreaterThan(0.9);
      await rpc.commands([{...graph,params:{...params,vjclipClockToken:42}}]);
      await eventuallyMean(rpc,mean=>mean[0]>0.9);
      await rpc.send('schedule_launch',{id:'obsolete-fade',lane:'fade',revision:5,delay_ms:30,commands:[startCommand]});
      await sleep(100);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
      expect((await rpc.send('frame_snapshot')).mean_rgba[0]).toBeGreaterThan(0.9);
    } finally {await rpc.close();}
  },15000);

  it('finishes a started fade without further frontend updates', async () => {
    const rpc=core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red',[255,0,0,255]),solid('src:blue',[0,0,255,255])]);
      const opts={...options(),mix:0};
      const commands=graphLayer('clip',opts.outputSourceId,buildVJClipTransitionGraph(opts).config);
      const graph=commands.find(command=>command.type==='set_native_graph_layer')!;
      graph.params={vjclipTransition:true,vjclipClockToken:1,vjclipClockDuration:0.6,vjclipClockRunning:false,vjxfadeMix:0};
      await rpc.commands(commands);
      await eventuallyMean(rpc,mean=>mean[0]>0.9 && mean[2]<0.05);
      await rpc.commands([{...graph,params:{...(graph.params as Record<string,unknown>),vjclipClockRunning:true}}]);
      // No parameter or uniform writes during the native fade.
      await sleep(250);
      const middle=(await rpc.send('frame_snapshot')).mean_rgba;
      expect(middle[0]).toBeGreaterThan(0.1); expect(middle[2]).toBeGreaterThan(0.1);
      await sleep(550);
      const final=(await rpc.send('frame_snapshot')).mean_rgba;
      expect(final[0]).toBeLessThan(0.05); expect(final[2]).toBeGreaterThan(0.9);
      // A stale progress write for this same transition cannot rewind it.
      await rpc.commands([{...graph,params:{...(graph.params as Record<string,unknown>),vjclipClockRunning:true}}]);
      const stable=await settledMean(rpc);
      expect(stable[2]).toBeGreaterThan(0.9);
      await rpc.send('set_render_clock',{mode:'manual'});
      await rpc.commands([{...graph,params:{...(graph.params as Record<string,unknown>),vjclipClockRunning:true}}]);
      await sleep(700);
      const manual=await settledMean(rpc);
      expect(manual[0]).toBeGreaterThan(0.9); expect(manual[2]).toBeLessThan(0.05);

    } finally {await rpc.close();}
  },15000);

  it('preserves lower-row coverage through all ten transition styles', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 96]), solid('src:blue', [0, 0, 255, 96])]);
      for (const style of Object.keys(VJ_CROSSFADE_TRANSITION_IDS)) {
        const config = buildVJClipTransitionGraph({ ...options(), transition: style }).config;
        await rpc.commands(graphLayer('clip', 'plugin:clip:vj-crossfade', config));
        const mean = await eventuallyMean(rpc, ([r, g, b]) => r + b > 0.12 && g > 0.35);
        expect(mean[1], `${style} must retain the green row under partial-alpha clips`).toBeGreaterThan(0.35);
      }
      expect((await rpc.send('status')).shader_precompile_failed).toBe(0);
    } finally { await rpc.close(); }
  }, 60000);

  it('keeps independent geometry and opacity, including contain margins and translated outgoing corners', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 255]), solid('src:blue', [0, 0, 255, 255])]);
      const left = createLayer('out', '', 'media');
      left.corners = { topLeft: { x: 0, y: 1 }, topRight: { x: 0.5, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 0.5, y: 0 } };
      const base = options(left);
      base.branchA.opacity = 0.5;
      base.branchB.uvFlags = [2, 2, 0, 0]; // Contain a source twice as wide: half-height coverage.
      await rpc.commands(graphLayer('clip', base.outputSourceId, buildVJClipTransitionGraph({ ...base, mix: 0 }).config));
      const outgoing = await eventuallyMean(rpc, ([r, g, b]) => r > 0.20 && r < 0.30 && g > 0.70 && b < 0.02);
      expect(outgoing[0]).toBeCloseTo(0.25, 1);
      const update = buildVJClipTransitionUniformUpdate({ ...base, mix: 1 });
      await rpc.commands([{ type: 'update_native_graph_buffer', layer_id: 'clip', buffer_id: update.bufferId, initial_b64: update.initialB64 }]);
      const incoming = await eventuallyMean(rpc, ([r, g, b]) => r < 0.02 && g > 0.40 && g < 0.60 && b > 0.40 && b < 0.60);
      expect(incoming[2]).toBeCloseTo(0.5, 1);
    } finally { await rpc.close(); }
  }, 30000);

  it('keeps the outgoing picture while incoming is missing and resolves raw-video source rectangles', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 255], 32, 16, true)]);
      const base = options();
      await rpc.commands(graphLayer('clip', base.outputSourceId, buildVJClipTransitionGraph(base).config));
      await eventuallyMean(rpc, ([r, g, b]) => r > 0.95 && g < 0.02 && b < 0.02);
      await rpc.commands([solid('src:blue', [0, 0, 255, 255])]);
      await eventuallyMean(rpc, ([r, g, b]) => r > 0.55 && g < 0.02 && b > 0.55);
    } finally { await rpc.close(); }
  }, 30000);

  it('preserves alpha through nested clip → A/B → VJ Mix graph dependencies', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.commands([solid('src:red', [255, 0, 0, 128]), solid('src:blue', [0, 0, 255, 0])]);
      const clip = { ...options(), mix: 0 };
      const ab = { ...options(), outputSourceId: 'plugin:ab:vj-crossfade', sourceAId: 'layer-frame:clip', mix: 0,
        branchA: { ...options().branchA, premultiplied: true } };
      const mixSource = 'plugin:mix:vj-mix';
      const mix = buildVJMixGraph({ outputSourceId: mixSource, width: 64, height: 36, time: 0, frameIndex: 0,
        rows: [{ frameId: 'layer-frame:background', opacity: 1, blendMode: 'normal' }, { frameId: 'layer-frame:ab', opacity: 1, blendMode: 'normal' }] });
      // Deliberately opposite scene order: execution must follow producer dependencies.
      await rpc.commands([
        ...graphLayer('mix', mixSource, mix.config, 10, 1, 'vj-mix'),
        ...graphLayer('ab', ab.outputSourceId, buildVJClipTransitionGraph(ab).config, 9, 0),
        ...graphLayer('clip', clip.outputSourceId, buildVJClipTransitionGraph(clip).config, 8, 0),
      ]);
      const mean = await eventuallyMean(rpc, ([r, g, b]) => r > 0.45 && r < 0.55 && g > 0.45 && g < 0.55 && b < 0.02);
      expect(mean[0]).toBeCloseTo(0.5, 1);
      expect(mean[1]).toBeCloseTo(0.5, 1);
    } finally { await rpc.close(); }
  }, 30000);
});
