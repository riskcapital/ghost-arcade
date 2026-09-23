import { createLayer } from '../types';
import { buildVJClipTransitionGraph, buildVJClipTransitionPrecompileCommands } from './vjClipTransitionNative';
import { buildNativeEffectPassChainGraph, buildNativeEffectPassPrecompileCommands } from './nativeEffectPass';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const require = createRequire(import.meta.url);
let ffmpeg = require('ffmpeg-static');
const binary = platform.binary;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Command = Record<string, unknown>;
function core() {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
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
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
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
type Core = ReturnType<typeof core>;

async function waitUntil<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value: T | undefined;
  do {
    value = await read();
    if (ready(value)) return value;
    await sleep(10);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value, (key, item) => key === 'rgba' || key === 'rgba_b64' ? '[pixel buffer]' : item)}`);
}


const testSuite = platform.runnable ? describe : describe.skip;
testSuite('HAP compressed textures through native output', () => {
  let directory: string;
  const fixtures = new Map<string, {uri:string; reference:Buffer}>();
  beforeAll(async () => {
    ffmpeg = await require('../../../electron/conversion-ffmpeg.cjs').resolveConversionFfmpeg(ffmpeg, 'hap');
    directory = mkdtempSync(join(tmpdir(), 'ghost-hap-gpu-'));
    const raw=Buffer.alloc(64*64*4*25);
    for(let frame=0;frame<25;frame++) for(let p=0;p<64*64;p++) {
      const y=Math.floor(p/64),x=p%64; raw.set([frame<12?220:20,y<32?24:160,frame<12?16:220,x<16?0:x<48?102:255],(frame*64*64+p)*4);
    }
    const input=join(directory,'input.rgba');writeFileSync(input,raw);
    const h264=join(directory,'interframe.mp4');
    execFileSync(ffmpeg,['-v','error','-f','rawvideo','-pixel_format','rgba','-video_size','64x64','-framerate','25','-i',input,'-c:v','libx264','-pix_fmt','yuv420p','-g','25','-bf','2',h264],{timeout:30000});
    fixtures.set('h264',{uri:h264,reference:execFileSync(ffmpeg,['-v','error','-i',h264,'-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:1024*1024,timeout:30000})});
    for(const format of ['hap','hap_alpha','hap_q']) {
      const uri=join(directory,format+'.mov');
      execFileSync(ffmpeg,['-v','error','-f','rawvideo','-pixel_format','rgba','-video_size','64x64','-framerate','25','-i',input,'-c:v','hap','-format',format,'-compressor','snappy','-chunks','4',uri],{timeout:30000});
      const reference=execFileSync(ffmpeg,['-v','error','-i',uri,'-pix_fmt','rgba','-f','rawvideo','pipe:1'],{maxBuffer:1024*1024,timeout:30000});
      fixtures.set(format,{uri,reference});
    }
  },30000);
  afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
  it.each(['hap', 'hap_alpha', 'h264'])('applies video effects to %s without an extra raw-media layer', async (format) => {
    const rpc = core();
    const { uri, reference } = fixtures.get(format)!;
    const inverted = Buffer.from(reference.subarray(0, 64*64*4));
    for (let i=0;i<inverted.length;i+=4) for (let c=0;c<3;c++) inverted[i+c]=255-inverted[i+c];
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 64, height: 64, source_frame_size: 256, target_fps: 60, native_quality_policy: 'fixed' } });
      await rpc.commands([
        ...buildNativeEffectPassPrecompileCommands(),
        { type: 'upsert_layer', layer_id: 'alpha', opacity: 1, z_index: 0, blend_mode: 'normal', corners: { topLeft: {x:0,y:1}, topRight:{x:1,y:1}, bottomRight:{x:1,y:0}, bottomLeft:{x:0,y:0} } },
        { type: 'bind_media_source', layer_id: 'alpha', source_id: 'raw-hap', uri, source_type: 'video' },
        { type: 'set_media_source_playback', source_id: 'raw-hap', uri, source_type: 'video', time_seconds: 0, paused: true, decode_width:64, decode_height:64, duration_seconds:1, seek_generation:1 },
      ]);
      await waitUntil(() => rpc.send('status'), s => s.native_video_sessions.some((v:any) => v.source_id==='raw-hap' && v.frames_presented > 0), 'video first frame');
      const cropPreview = await rpc.send('frame_snapshot', {source_id:'raw-hap',max_dim:64,include_pixels:true});
      expect([cropPreview.width,cropPreview.height]).toEqual([64,64]);
      const cropPixels = Buffer.from(cropPreview.rgba_b64,'base64');
      for (const y of [16,48]) for (const x of [8,32,56]) for (let c=0;c<4;c++) {
        const offset=(y*64+x)*4+c;
        expect(Math.abs(cropPixels[offset]-reference[offset])).toBeLessThanOrEqual(10);
      }
      const graph = buildNativeEffectPassChainGraph({ sourceId:'raw-hap', targetSourceId:'effect-pass:alpha', effects:[{effect:'invert',amount:1,mix:1}], width:64,height:64,time:0,frameDelta:1/60,frameIndex:1,seq:1 });
      await rpc.commands([
        {type:'bind_media_source',layer_id:'alpha',source_id:'effect-pass:alpha',uri:'native-effect-pass://alpha',source_type:'image',effect_input_source_id:'raw-hap'},
        {type:'queue_compute_graph',...graph.config},
        {type:'upsert_layer',layer_id:'alpha',opacity:1,z_index:0,corners:{topLeft:{x:0,y:1},topRight:{x:.5,y:1},bottomRight:{x:.5,y:0},bottomLeft:{x:0,y:0}}},
        {type:'upsert_layer',layer_id:'expected',opacity:1,z_index:0,corners:{topLeft:{x:.5,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:.5,y:0}}},
        {type:'upload_source_frame',source_id:'inverted-reference',width:64,height:64,seq:1,rgba_b64:inverted.toString('base64')},
        {type:'bind_media_source',layer_id:'expected',source_id:'inverted-reference',source_type:'image'},
      ]);
      // Exercise the same hidden clip input -> row carrier path as VJ mode.
      const branchLayer = createLayer('alpha', 'Video input', 'media');
      branchLayer.corners = {topLeft:{x:0,y:1},topRight:{x:.5,y:1},bottomRight:{x:.5,y:0},bottomLeft:{x:0,y:0}};
      const branch = {layer:branchLayer, opacity:1, premultiplied:false, uvTransform:[0,0,1,1], uvFlags:[0,1,0,0]};
      const carrier = buildVJClipTransitionGraph({outputSourceId:'row-output',sourceAId:'layer-frame:alpha',sourceBId:'layer-frame:alpha',
        width:64,height:64,mix:1,transition:'dissolve',branchA:branch,branchB:branch,time:0,frameIndex:0});
      await rpc.commands([
        ...buildVJClipTransitionPrecompileCommands(),
        {type:'upsert_layer',layer_id:'alpha',opacity:0},
        {type:'upsert_layer',layer_id:'row',opacity:1,z_index:0,corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:0,y:0}}},
        {type:'set_native_graph_layer',layer_id:'row',kind:'vj-crossfade',instrument_source_id:'row-output',composite_source_id:'row-output',params:{},effect_graph:carrier.config},
      ]);
      await waitUntil(() => rpc.send('output_shared_texture_snapshot', {include_pixels:true}), snap => {
        if (!snap.rgba_b64) return false;
        const bytes=Buffer.from(snap.rgba_b64,'base64');
        const red=snap.format.toLowerCase().startsWith('bgra')?2:0;
        for (const x of [.125,.5,.875]) {
          const actual=(Math.floor(snap.height*.25)*snap.width+Math.floor(snap.width*x*.5))*4;
          const expected=(Math.floor(snap.height*.25)*snap.width+Math.floor(snap.width*(.5+x*.5)))*4;
          for(let c=0;c<4;c++) if(Math.abs(bytes[actual+c]-bytes[expected+c])>10) { snap.probe={x,actual:Array.from(bytes.subarray(actual,actual+4)),expected:Array.from(bytes.subarray(expected,expected+4))}; return false; }
          if(x===.875 && !(bytes[actual+red]<80 && bytes[actual+2-red]>150)) return false;
        }
        return true;
      }, 'inverted video colors with transparent background');
      const status = await rpc.send('status');
      expect(status.native_video_sessions.some((v:any) => v.source_id === 'raw-hap')).toBe(true);
      // A retained input must also remain active in the decoder pump.
      // The clip input is hidden (opacity zero), as it is in the VJ mixer.
      await rpc.commands([{type:'set_media_source_playback',source_id:'raw-hap',uri,source_type:'video',
        time_seconds:0,paused:false,playback_rate:1,loop_enabled:false,decode_width:64,decode_height:64,
        duration_seconds:1,seek_generation:2}]);
      await waitUntil(() => rpc.send('status'), state => state.native_video_sessions.some((v:any) =>
        v.source_id==='raw-hap' && v.seek_generation===2 && v.frames_presented>=12 && v.source_time_seconds>=.52),
        'effect input continues playing', 5000);
      await waitUntil(async () => {
        await rpc.commands([{type:'queue_compute_graph',...graph.config}]);
        return rpc.send('output_shared_texture_snapshot',{include_pixels:true});
      }, snap => {
        if(!snap.rgba_b64)return false;
        const pixels=Buffer.from(snap.rgba_b64,'base64');
        const red=snap.format.toLowerCase().startsWith('bgra')?2:0;
        const offset=(Math.floor(snap.height*.25)*snap.width+Math.floor(snap.width*.4375))*4;
        return pixels[offset+red]>150 && pixels[offset+2-red]<80;
      }, 'processed video advances to its second color');
      await rpc.commands([{type:'remove_layer',layer_id:'row'}, {type:'remove_layer',layer_id:'alpha'}]);
      expect((await rpc.send('status')).native_video_sessions.some((v:any) => v.source_id === 'raw-hap')).toBe(false);
    } finally { await rpc.close(); }
  }, 30000);
  it.each(['hap','hap_alpha','hap_q'])('renders %s with reference colors and seeks on the prepared session',async format=>{
    const rpc=core();const {uri,reference}=fixtures.get(format)!;
    const source='hap-video';
    const playback=(time=0,generation=1)=>({source_id:source,uri,source_type:'video',time_seconds:time,decode_width:64,decode_height:64,playback_rate:1,loop_enabled:true,duration_seconds:1,trim_start:0,trim_end:1,seek_generation:generation,seq:generation});
    const layer=(id:string,x:number)=>({type:'upsert_layer',layer_id:id,opacity:1,z_index:0,blend_mode:'normal',corners:{topLeft:{x,y:1},topRight:{x:x+.5,y:1},bottomRight:{x:x+.5,y:0},bottomLeft:{x,y:0}}});
    let referenceSequence=0;
    const refFrame=(index:number)=>({type:'upload_source_frame',source_id:'reference',width:64,height:64,seq:++referenceSequence,rgba_b64:reference.subarray(index*64*64*4,(index+1)*64*64*4).toString('base64')});
    const compare = async (blue = false) => {
      await waitUntil(()=>rpc.send('output_shared_texture_snapshot',{include_pixels:true}),snapshot=>{
        if(!snapshot.rgba_b64)return false;
        const pixels=Buffer.from(snapshot.rgba_b64,'base64'),width=snapshot.width,height=snapshot.height;
        const red=snapshot.format.toLowerCase().startsWith('bgra')?2:0; const blueChannel=2-red;
        for(const y of [.25,.75]) for(const x of [.125,.5,.875]) {
          const a=(Math.floor(y*height)*width+Math.floor(width*x*.5))*4;
          const b=(Math.floor(y*height)*width+Math.floor(width*(.5+x*.5)))*4;
          if(x===.5) {
            if(pixels[a]+pixels[a+1]+pixels[a+2]<20)return false;
            if(blue ? pixels[a+blueChannel]<=pixels[a+red] : pixels[a+red]<=pixels[a+blueChannel])return false;
          }
          for(let c=0;c<4;c++)if(Math.abs(pixels[a+c]-pixels[b+c])>10)return false;
        }
        return true;
      },'GPU HAP must match independently decoded reference');
    };
    try {
      expect((await rpc.send('start',{config:{backend:platform.rendererBackend,width:128,height:64,source_frame_size:256,target_fps:60,native_quality_policy:'fixed',decode_handoff_byte_cap_mb:64}})).backend_ready).toBe(true);
      await rpc.send('prefetch_media',{...playback(),source_id:'library:hap-ready'});
      const armed=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id==='library:hap-ready'&&v.state==='prerolled'),'HAP preroll');
      expect(armed.native_video_sessions.find((s:any)=>s.source_id==='library:hap-ready').backend).toBe('hap-texture');
      await rpc.commands([layer('hap',0),layer('ref',.5),refFrame(0),{type:'bind_media_source',layer_id:'ref',source_id:'reference',source_type:'image'},
        {type:'set_media_source_playback',...playback(),paused:false},{type:'bind_media_source',layer_id:'hap',source_id:source,uri,source_type:'video'},{type:'set_media_source_playback',...playback(),paused:true}]);
      await compare();
      await rpc.commands([refFrame(15),{type:'set_media_source_playback',...playback(.6,2),paused:true}]);
      await compare(true);
      for (const generation of [3,4]) {
        await rpc.commands([{type:'set_media_source_playback',...playback(.6,generation),paused:true,frame_step:1}]);
        const stepped=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===generation&&v.frames_presented>0),'HAP exact step');
        expect(stepped.native_video_sessions.find((v:any)=>v.source_id===source).source_time_seconds).toBeCloseTo(.6+(generation-2)/25,5);
      }
      // Reverse uses the same prepared decoder and presents decreasing PTS.
      await rpc.commands([{type:'set_media_source_playback',...playback(.96,5),playback_rate:-1,loop_enabled:false,paused:false}]);
      const backwards = await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===5&&v.frames_presented>=8),'reverse HAP playback');
      expect(backwards.native_video_sessions.find((v:any)=>v.source_id===source).source_time_seconds).toBeLessThan(.72);
      const finished = await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.source_time_seconds===0),'reverse reaches first frame');
      expect(finished.native_video_frame_decode_failures).toBe(0);
      await rpc.commands([refFrame(0)]);
      await compare(false);
      await rpc.commands([refFrame(24),{type:'set_media_source_playback',...playback(.96,6),playback_rate:-1,loop_enabled:false,paused:true}]);
      const retriggered=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===6&&v.frames_presented>0),'warm reverse retrigger');
      expect(retriggered.native_video_sessions.find((v:any)=>v.source_id===source).source_time_seconds).toBeCloseTo(.96,5);
      await compare(true);
      await rpc.commands([{type:'set_media_source_playback',...playback(.96,7),playback_rate:-1,loop_enabled:false,paused:true,frame_step:-1}]);
      const reversedStep=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===7&&v.frames_presented>0),'reverse exact step');
      expect(reversedStep.native_video_sessions.find((v:any)=>v.source_id===source).source_time_seconds).toBeCloseTo(.92,5);
      await rpc.commands([{type:'set_media_source_playback',...playback(.8,8),playback_rate:-2,trim_start:.2,trim_end:.8,paused:false}]);
      const looped = await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===8&&v.frames_presented>=35),'reverse trimmed loops');
      const reverseSession=looped.native_video_sessions.find((v:any)=>v.source_id===source);
      expect(reverseSession.source_time_seconds).toBeGreaterThanOrEqual(.2-1e-6);
      expect(reverseSession.source_time_seconds).toBeLessThan(.8);
      await rpc.commands([{type:'set_media_source_playback',...playback(.3,9),playback_rate:1,trim_start:.2,trim_end:.8,paused:false}]);
      await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id===source&&v.seek_generation===9&&v.frames_presented>=8&&v.source_time_seconds>.5),'forward HAP after reverse');
      const status=await rpc.send('status');const session=status.native_video_sessions.find((s:any)=>s.source_id===source);
      expect(session.backend).toBe('hap-texture');expect(session.source_frame_step_exact).toBe(true);
      expect(status.native_video_hap_frames).toBeGreaterThan(0);expect(status.native_video_software_frames).toBe(0);
      expect(status.native_video_hardware_frames).toBe(0);expect(status.native_video_frame_decode_failures).toBe(0);
      expect(status.source_frame_last_upload_transport).toBe('native-video-hap-bc');
    } finally {await rpc.close();}
  },30000);
  it('previews full image and shader sources independently of the mapped output', async () => {
    const rpc=core();
    try {
      await rpc.send('start',{config:{backend:platform.rendererBackend,width:64,height:64,source_frame_size:256,target_fps:30}});
      const pixels=Buffer.alloc(64*64*4);
      for(let y=0;y<64;y++) for(let x=0;x<64;x++) {
        const offset=(y*64+x)*4; pixels[offset]=x<32?255:0; pixels[offset+1]=x<32?0:255;
        pixels[offset+3]=y<32?255:128;
      }
      await rpc.commands([{type:'upload_source_frame',source_id:'crop-image',width:64,height:64,seq:1,rgba_b64:pixels.toString('base64')}]);
      const image=await rpc.send('frame_snapshot',{source_id:'crop-image',max_dim:64});
      const actual=Buffer.from(image.rgba_b64,'base64');
      for(const y of [16,48]) for(const x of [16,48]) for(let c=0;c<4;c++) {
        const offset=(y*64+x)*4+c;expect(Math.abs(actual[offset]-pixels[offset])).toBeLessThanOrEqual(2);
      }
      await rpc.commands([
        {type:'upsert_layer',layer_id:'crop-shader',opacity:1,corners:{topLeft:{x:0,y:1},topRight:{x:.25,y:1},bottomRight:{x:.25,y:0},bottomLeft:{x:0,y:0}}},
        {type:'precompile_shader',shader_id:'crop-gradient',stage:'pixel',entry:'main',source:'/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){gl_FragColor=vec4(isf_FragNormCoord.x,0.25,0.75,1.0);}'},
        {type:'bind_isf_shader',layer_id:'crop-shader',shader_id:'crop-gradient'},
        {type:'render_isf_to_layer',layer_id:'crop-shader'}
      ]);
      const shader=await rpc.send('frame_snapshot',{source_id:'browser-shader-id',layer_id:'crop-shader',max_dim:64});
      const shaderPixels=Buffer.from(shader.rgba_b64,'base64');
      expect(shaderPixels[(32*64+8)*4]).toBeLessThan(60);
      expect(shaderPixels[(32*64+56)*4]).toBeGreaterThan(200);
      expect(shaderPixels[(32*64+56)*4+2]).toBeGreaterThan(180);
      expect(shader.width).toBe(64);
    } finally { await rpc.close(); }
  });

  it('reverses hardware H.264 across decoded windows, seeks and resumes forward',async()=>{
    const rpc=core();const {uri}=fixtures.get('h264')!;
    const playback=(time:number,rate:number,generation:number)=>({type:'set_media_source_playback',source_id:'reverse-h264',uri,source_type:'video',time_seconds:time,decode_width:64,decode_height:64,playback_rate:rate,loop_enabled:false,duration_seconds:1,trim_start:0,trim_end:1,seek_generation:generation,seq:generation,paused:false});
    try {
      await rpc.send('start',{config:{backend:platform.rendererBackend,width:64,height:64,source_frame_size:256,target_fps:60,native_quality_policy:'fixed',decode_handoff_byte_cap_mb:64}});
      await rpc.commands([{type:'upsert_layer',layer_id:'reverse',opacity:1,z_index:0,blend_mode:'normal',corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:0,y:0}}},playback(.96,-1,1),{type:'bind_media_source',layer_id:'reverse',source_id:'reverse-h264',uri,source_type:'video'}]);
      const times:number[]=[];
      await waitUntil(async()=>{
        const status=await rpc.send('status');
        const session=status.native_video_sessions.find((s:any)=>s.source_id==='reverse-h264');
        if(Number.isFinite(session?.source_time_seconds))times.push(session.source_time_seconds);
        return status;
      },s=>s.native_video_sessions.some((v:any)=>v.source_id==='reverse-h264'&&v.frames_presented>=24&&v.source_time_seconds===0),'H.264 reverse first frame');
      expect(times.length).toBeGreaterThan(10);
      for(let i=1;i<times.length;i++)expect(times[i]).toBeLessThanOrEqual(times[i-1]+1e-6);
      await waitUntil(()=>rpc.send('output_shared_texture_snapshot',{include_pixels:true}),s=>{
        if(!s.rgba_b64)return false;
        const pixels=Buffer.from(s.rgba_b64,'base64');
        const center=(Math.floor(s.height/2)*s.width+Math.floor(s.width/2))*4;
        const red=s.format.toLowerCase().startsWith('bgra')?2:0;
        return pixels[center+red]>pixels[center+2-red]+100;
      },'reverse H.264 reaches the red opening picture');
      await rpc.commands([{...playback(.96,-1,2),paused:true}]);
      const warm=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id==='reverse-h264'&&v.seek_generation===2&&v.frames_presented>0),'warm H.264 reverse retrigger');
      expect(warm.native_video_sessions.find((v:any)=>v.source_id==='reverse-h264').source_time_seconds).toBeCloseTo(.96,5);
      await rpc.commands([playback(.96,-1,2)]);
      await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id==='reverse-h264'&&v.seek_generation===2&&v.source_time_seconds===0),'cached reverse resumes through the first frame');
      await rpc.commands([{...playback(.6,-1,3),paused:true}]);
      const sought=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id==='reverse-h264'&&v.seek_generation===3&&v.frames_presented>0),'reverse paused seek');
      expect(sought.native_video_sessions.find((v:any)=>v.source_id==='reverse-h264').source_time_seconds).toBeCloseTo(.6,5);
      await rpc.commands([playback(.6,1,4)]);
      const forward=await waitUntil(()=>rpc.send('status'),s=>s.native_video_sessions.some((v:any)=>v.source_id==='reverse-h264'&&v.seek_generation===4&&v.source_time_seconds>.8),'forward after reverse');
      expect(forward.native_video_frame_decode_failures).toBe(0);
      expect(forward.native_video_software_frames).toBe(0);
    }finally{await rpc.close();}
  },30000);

  it.each(['hap', 'hap_alpha', 'hap_q', 'h264'])('bounces %s inside trim bounds and preserves the paused leg', async format => {
    const rpc = core();
    const { uri } = fixtures.get(format)!;
    const source = 'bounce-video';
    const command = (time: number, rate: number, generation: number, paused = false) => ({
      type: 'set_media_source_playback', source_id: source, uri, source_type: 'video',
      time_seconds: time, playback_rate: rate, seek_generation: generation, paused,
      bounce_enabled: true, loop_enabled: true, duration_seconds: 1,
      trim_start: .2, trim_end: .8, decode_width: 64, decode_height: 64,
    });
    const read = async () => {
      const status = await rpc.send('status');
      expect(status.native_video_frame_decode_failures).toBe(0);
      expect(status.native_video_software_frames).toBe(0);
      return status.native_video_sessions.find((v: any) => v.source_id === source);
    };
    try {
      await rpc.send('start', {config: {backend: platform.rendererBackend, width: 64, height: 64,
        source_frame_size: 256, target_fps: 60, native_quality_policy: 'fixed', decode_handoff_byte_cap_mb: 64}});
      await rpc.commands([
        {type: 'upsert_layer', layer_id: 'bounce', opacity: 1, z_index: 0, blend_mode: 'normal',
          corners: {topLeft:{x:0,y:1}, topRight:{x:1,y:1}, bottomRight:{x:1,y:0}, bottomLeft:{x:0,y:0}}},
        command(.2, 1, 1), {type: 'bind_media_source', layer_id: 'bounce', source_id: source, uri, source_type: 'video'},
      ]);
      const times: number[] = [];
      await waitUntil(async () => {
        const session = await read();
        if (Number.isFinite(session?.source_time_seconds)) times.push(session.source_time_seconds);
        return session;
      }, session => session?.frames_presented >= 65, 'two bounce turnarounds');
      const distinct = times.filter((v, i) => i === 0 || v !== times[i - 1]);
      expect(distinct.length).toBeGreaterThan(45);
      expect(Math.min(...distinct)).toBeCloseTo(.2, 5);
      expect(Math.max(...distinct)).toBeCloseTo(.76, 5);
      let lastSign = 0, turns = 0;
      for (let i = 1; i < distinct.length; i++) {
        const delta = distinct[i] - distinct[i - 1];
        expect(Math.abs(delta)).toBeLessThanOrEqual(.080001);
        const sign = Math.sign(delta);
        if (lastSign && sign !== lastSign) turns++;
        lastSign = sign;
      }
      expect(turns).toBeGreaterThanOrEqual(3);
      // Seek onto a reverse leg, pause with no explicit time/rate, then resume.
      await rpc.commands([command(.68, -1, 2)]);
      await waitUntil(read, v => v?.seek_generation === 2 && v.source_time_seconds < .6 && v.source_time_seconds > .4, 'reverse bounce seek');
      await rpc.commands([{type:'set_media_source_playback',source_id:source,paused:true}]);
      const paused = await read();
      await sleep(100);
      expect((await read()).source_time_seconds).toBe(paused.source_time_seconds);
      await rpc.commands([{type:'set_media_source_playback',source_id:source,paused:false}]);
      await waitUntil(read, v => v.source_time_seconds < paused.source_time_seconds - .02, 'resume continues reverse');
      // A fresh positive launch exactly at the exclusive trim end must turn,
      // not fail or display an out-of-trim picture.
      await rpc.commands([command(.8, 1, 3, true)]);
      const edge = await waitUntil(read, v => v?.seek_generation === 3 && v.frames_presented > 0, 'endpoint bounce launch');
      expect(edge.source_time_seconds).toBeCloseTo(.76, 5);
      await rpc.commands([command(.2, 1, 4, true)]);
      const opening = await waitUntil(read, v => v?.seek_generation === 4 && v.frames_presented > 0, 'bounce restart');
      expect(opening.source_time_seconds).toBeCloseTo(.2, 5);
      await rpc.commands([command(.6, -1, 5, true)]);
      await waitUntil(read, v => v?.seek_generation === 5 && v.frames_presented > 0, 'prepare bounce step');
      await rpc.commands([{...command(.6, -1, 6, true), frame_step:-1}]);
      const stepped = await waitUntil(read, v => v?.seek_generation === 6 && v.frames_presented > 0, 'bounce exact step');
      expect(stepped.source_time_seconds).toBeCloseTo(.56, 5);
      await rpc.commands([command(.56, -1, 6)]);
      await waitUntil(read, v => v.source_time_seconds < .54 && v.source_time_seconds > .4, 'stepped bounce resumes in requested direction');

    } finally { await rpc.close(); }
  }, 30000);

});
