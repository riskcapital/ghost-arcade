import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const { createNativeFrameSink } = createRequire(import.meta.url)('../../../electron/native-frame-stream.cjs');
const { createLiveCaptureClock } = createRequire(import.meta.url)('../../../electron/live-capture-clock.cjs');
const binary = platform.binary;
type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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


const suite = platform.runnable ? describe : describe.skip;
suite('Native performance paths', () => {
  it('executes prepared transactions without frontend ticks and rejects stale or invalid work', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 128, height: 96, target_fps: 60 } });
      await rpc.commands([{type:'upsert_layer',layer_id:'scheduled-row',opacity:1},
        {type:'set_layer_visibility',layer_id:'scheduled-row',visible:false}]);
      const request = (revision:number, visible:boolean) => ({id:`test-${revision}`,lane:'A:0',revision,delay_ms:200,
        commands:[{type:'set_layer_visibility',layer_id:'scheduled-row',visible}]});
      await rpc.send('schedule_launch',request(1,true));
      await rpc.send('schedule_launch',request(2,false));
      await expect(rpc.send('cancel_launch',{lane:'A:0',revision:1})).rejects.toThrow('stale');
      expect((await rpc.send('cancel_launch',{lane:'A:0',revision:1,settle_superseded:true})).superseded).toBe(true);
      await sleep(300);
      let status=await rpc.send('launch_status');
      expect(status.receipts.map((r:any)=>r.state)).toEqual(['replaced','applied']);
      await rpc.send('schedule_launch',request(3,true));
      // No command traffic or frontend timer is needed to execute this launch.
      await sleep(300);
      expect((await rpc.send('layers_snapshot')).layers.find((l:any)=>l.layer_id==='scheduled-row').visible).toBe(true);
      expect((await rpc.send('cancel_launch',{lane:'A:0',revision:3})).receipts.at(-1).state).toBe('applied');
      await rpc.send('schedule_launch',{...request(4,false),commands:[
        {type:'set_layer_visibility',layer_id:'scheduled-row',visible:false},
        {type:'bind_media_source',layer_id:'scheduled-row',source_id:'missing'}]});
      await sleep(300);
      expect((await rpc.send('layers_snapshot')).layers.find((l:any)=>l.layer_id==='scheduled-row').visible).toBe(true);
      status=await rpc.send('launch_status');
      expect(status.receipts.at(-1).state).toBe('rejected');
      await rpc.send('schedule_launch',request(5,false));
      await rpc.send('set_render_clock',{mode:'manual'});
      await rpc.send('set_render_clock',{mode:'live'});
      await sleep(300);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('cancelled');
    } finally { await rpc.close(); }
  },15000);
  it('launches prepared video columns together and supersedes overlapping columns as a whole', async () => {
    const dir=mkdtempSync(join(tmpdir(),'ghost-column-')); const uri=join(dir,'clip.mp4'); const rpc=core();
    try {
      execFileSync(process.env.GA_FFMPEG_PATH||'ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=128x96:r=30:d=4','-c:v','libx264','-pix_fmt','yuv420p',uri]);
      await rpc.send('start',{config:{backend:platform.rendererBackend,width:128,height:96,target_fps:60}});
      expect((await rpc.send('capabilities')).features.native_launch_resource_fences).toBe(true);
      const setup:Command[]=[];
      for(let row=0;row<2;row++) {
        setup.push({type:'upsert_layer',layer_id:`row-${row}`,opacity:1,z_index:row});
        for(const prefix of ['old','new']) setup.push({type:'set_media_source_playback',source_id:`${prefix}-${row}`,uri,source_type:'video',duration_seconds:4,
          time_seconds:0,playback_rate:1,paused:prefix==='new',loop_enabled:true,seek_generation:1,prepare_for_launch:prefix==='new',decode_width:128,decode_height:96});
        setup.push({type:'bind_media_source',layer_id:`row-${row}`,source_id:`old-${row}`,uri,source_type:'video'});
      }
      await rpc.commands(setup);
      const sources=['old-0','old-1','new-0','new-1']; let ready=false;
      for(let i=0;i<150;i++) {
        ready=(await Promise.all(sources.map(source_id=>rpc.send('get_source_frame_readiness',{source_id,seek_generation:1})))).every(value=>value.ready);
        if(ready)break; await sleep(20);
      }
      expect(ready).toBe(true);
      await rpc.send('schedule_launch',{id:'column',lane:'column:A',revision:10,delay_ms:150,
        expected_sources:Object.fromEntries([0,1].map(row=>[`row-${row}`,{source_id:`old-${row}`,seek_generation:1}])),
        commands:[0,1].flatMap(row=>[
          {type:'set_media_source_playback',source_id:`new-${row}`,uri,time_seconds:0,paused:false,seek_generation:1},
          {type:'bind_media_source',layer_id:`row-${row}`,source_id:`new-${row}`,uri,source_type:'video'}])});
      await sleep(250);
      let status=await rpc.send('launch_status'); expect(status.receipts.at(-1).state).toBe('applied');
      expect(status.receipts.at(-1).detail.summary.applied).toBe(4);
      let rows=(await rpc.send('layers_snapshot')).layers;
      expect(rows.find((r:any)=>r.layer_id==='row-0').source_id).toBe('new-0');
      expect(rows.find((r:any)=>r.layer_id==='row-1').source_id).toBe('new-1');
      // A failed participant rejects the entire next transaction before either row changes.
      await rpc.send('schedule_launch',{id:'invalid-column',lane:'column:A',revision:11,delay_ms:50,
        expected_sources:{'row-0':{source_id:'new-0'},'row-1':{source_id:'missing'}},
        commands:[0,1].map(row=>({type:'set_layer_visibility',layer_id:`row-${row}`,visible:false}))});
      await sleep(150);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
      expect((await rpc.send('layers_snapshot')).layers.every((row:any)=>row.visible)).toBe(true);
      await rpc.send('schedule_launch',{id:'replaced-column',lane:'column:A',revision:12,delay_ms:100,
        commands:[0,1].map(row=>({type:'set_layer_visibility',layer_id:`row-${row}`,visible:false}))});
      await rpc.send('schedule_launch',{id:'row-override',lane:'row:A:0',revision:13,delay_ms:100,
        commands:[{type:'set_layer_visibility',layer_id:'row-0',visible:false}]});
      await sleep(200);
      status=await rpc.send('launch_status');
      expect(status.receipts.find((r:any)=>r.id==='replaced-column').state).toBe('replaced');
      rows=(await rpc.send('layers_snapshot')).layers;
      expect(rows.find((r:any)=>r.layer_id==='row-0').visible).toBe(false);
      expect(rows.find((r:any)=>r.layer_id==='row-1').visible).toBe(true);
      // A later seek can still be fully decoded; readiness alone is insufficient.
      await rpc.commands([{type:'set_media_source_playback',source_id:'new-1',uri,time_seconds:1,paused:true,seek_generation:2}]);
      let newerReady=false;
      for(let i=0;i<100;i++) {
        newerReady=(await rpc.send('get_source_frame_readiness',{source_id:'new-1',seek_generation:2})).ready;
        if(newerReady)break; await sleep(20);
      }
      expect(newerReady).toBe(true);
      await rpc.send('schedule_launch',{id:'stale-prepared-frame',lane:'column:A',revision:14,delay_ms:50,
        commands:[{type:'set_layer_visibility',layer_id:'row-0',visible:true},
          {type:'set_media_source_playback',source_id:'new-1',uri,time_seconds:0,paused:false,seek_generation:1}]});
      await sleep(150);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('rejected');
      rows=(await rpc.send('layers_snapshot')).layers;
      expect(rows.find((r:any)=>r.layer_id==='row-0').visible).toBe(false);
      expect((await rpc.send('get_source_frame_readiness',{source_id:'new-1',seek_generation:2})).ready).toBe(true);

    } finally {await rpc.close();rmSync(dir,{recursive:true,force:true});}
  },15000);
  it('streams real GPU output without files and follows Link without frontend phase updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghost-perf-'));
    const uri = join(dir, 'clip.mp4'); const rpc = core();
    try {
      execFileSync(process.env.GA_FFMPEG_PATH || 'ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=s=128x96:r=30:d=8','-c:v','libx264','-pix_fmt','yuv420p',uri]);
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 128, height: 96, target_fps: 60 } });
      await rpc.commands([
        { type:'upsert_layer', layer_id:'video', opacity:1,z_index:0,blend_mode:'normal' },
        { type:'set_media_source_playback',source_id:'video',uri,source_type:'video',duration_seconds:8,time_seconds:0,playback_rate:1,paused:false,loop_enabled:true,seek_generation:1 },
        { type:'bind_media_source',layer_id:'video',source_id:'video',uri,source_type:'video' },
      ]);
      let state: any;
      for(let i=0;i<100;i++) { state=await rpc.send('status'); if(state.native_video_sessions?.some((s:any)=>s.source_id==='video'&&s.frames_presented>5)) break; await sleep(50); }
      const session = state.native_video_sessions.find((s:any)=>s.source_id==='video');
      expect(session.frames_presented).toBeGreaterThan(5);
      // Auxiliary native video textures do not require a visible scene layer.
      const textureId = 'native-splat-video-test:1';
      await rpc.commands([{type:'set_media_source_playback',source_id:textureId,uri,source_type:'video',time_seconds:0,playback_rate:1,paused:false,loop_enabled:true,seek_generation:1}]);
      let texture: any;
      for(let i=0;i<100;i++) { texture=(await rpc.send('status')).native_video_sessions.find((s:any)=>s.source_id===textureId); if(texture?.frames_presented>2) break; await sleep(50); }
      expect(texture?.backend).toBe(platform.decoderBackend);
      expect(texture?.frames_presented).toBeGreaterThan(2);
      expect((await rpc.send('release_source_frame',{source_id:textureId})).released).toBe(true);
      const chunks: Buffer[] = [];
      const encoded = join(dir, 'recording.mp4');
      const encoder = spawn(process.env.GA_FFMPEG_PATH || 'ffmpeg', ['-v','error','-f','rawvideo','-pixel_format','bgra','-video_size','128x96','-framerate','30','-i','pipe:0','-c:v','libx264','-pix_fmt','yuv420p',encoded], {stdio:['pipe','ignore','pipe']});
      const finished = new Promise<number|null>((resolve,reject)=>{encoder.on('exit',resolve);encoder.on('error',reject);});
      const sink = await createNativeFrameSink({ write: async (chunk:Buffer)=>{
        chunks.push(Buffer.from(chunk));
        await new Promise<void>((resolve,reject)=>encoder.stdin.write(chunk,error=>error?reject(error):resolve()));
      } });
      let snapshot: any;
      let scheduledFrames = 0;
      try {
        for (let frame=0; frame<3; frame++) {
          chunks.length=0;
          snapshot = await sink.capture(128*96*4*2,
            (endpoint:any)=>rpc.send('stream_output_frame',{...endpoint,width:128,height:96,copies:2}));
          expect(Buffer.concat(chunks).length).toBe(128*96*4*2);
        }
        // No frontend RAF or capture requests: the main-process clock owns cadence.
        const clock = createLiveCaptureClock({ fps: 30, capture: async (first:number, last:number) => {
          await sink.capture(128*96*4*(last-first+1),
            (endpoint:any)=>rpc.send('stream_output_frame',{...endpoint,width:128,height:96,copies:last-first+1}));
        } });
        await sleep(500);
        const stopped = await clock.stop();
        expect(stopped.error).toBeNull();
        scheduledFrames = stopped.frames;
        expect(scheduledFrames).toBeGreaterThan(5);
      } finally { await sink.close(); encoder.stdin.end(); }
      expect(await finished).toBe(0);
      const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',encoded],{encoding:'utf8'}));
      expect(Number(probe.streams[0].nb_read_frames)).toBe(6 + scheduledFrames);
      expect(snapshot.transport).toBe('native-binary-stream');
      const bytes=Buffer.concat(chunks);
      expect(bytes.subarray(0,128*96*4)).toEqual(bytes.subarray(128*96*4,128*96*4*2));
      expect(snapshot.nonzero_pixels).toBeGreaterThan(0);
      await rpc.commands([{type:'set_media_source_phase',source_id:'video',uri,seek_generation:1,time_seconds:session.source_time_seconds,
        reverse:false,clock:'link',beat_position:0,beats_per_cycle:16}]);
      const start=performance.now();
      // Simulated main-process clock delivery; no further frontend phase messages.
      for(let i=0;i<25;i++) {
        await rpc.commands([{type:'set_link_clock',enabled:true,tempo:120,beat:(performance.now()-start)/500}]);
        await sleep(100);
      }
      const following=(await rpc.send('status')).native_video_sessions.find((s:any)=>s.source_id==='video');
      expect(following.backend).toBe(platform.decoderBackend);
      expect(following.frames_presented).toBeGreaterThan(session.frames_presented+30);
      expect(following.phase_error_seconds).not.toBeNull();
      await rpc.commands([{type:'set_link_clock',enabled:false}]); await sleep(650);
      expect((await rpc.send('status')).native_video_sessions.find((s:any)=>s.source_id==='video').phase_error_seconds).toBeNull();
      await rpc.commands([{type:'set_media_source_playback',source_id:'incoming',uri,source_type:'video',duration_seconds:8,prepare_for_launch:true,
        time_seconds:0,playback_rate:1,paused:true,loop_enabled:true,seek_generation:1}]);
      let ready=false;
      for(let i=0;i<100;i++) {ready=(await rpc.send('get_source_frame_readiness',{source_id:'incoming',seek_generation:1})).ready;if(ready)break;await sleep(20);}
      expect(ready).toBe(true);
      await rpc.send('schedule_launch',{id:'video-cut',lane:'A:0',revision:1,delay_ms:100,
        expected_sources:{video:{source_id:'video',seek_generation:1}},commands:[
          {type:'set_media_source_playback',source_id:'incoming',uri,paused:false,time_seconds:0,seek_generation:1},
          {type:'bind_media_source',layer_id:'video',source_id:'incoming',uri,source_type:'video'}]});
      await sleep(250);
      expect((await rpc.send('launch_status')).receipts.at(-1).state).toBe('applied');
      const staleBind={type:'bind_media_source',layer_id:'video',source_id:'video',uri,source_type:'video'};
      await rpc.commands([staleBind]);
      expect((await rpc.send('layers_snapshot')).layers.find((l:any)=>l.layer_id==='video').source_id).toBe('incoming');
      // A deliberate retrigger advances the generation and must supersede the guard.
      await rpc.commands([{type:'set_media_source_playback',source_id:'video',uri,source_type:'video',
        time_seconds:0,playback_rate:1,paused:false,loop_enabled:true,seek_generation:2},staleBind]);
      let restored=false;
      for(let i=0;i<100;i++) {restored=(await rpc.send('layers_snapshot')).layers.find((l:any)=>l.layer_id==='video').source_id==='video';if(restored)break;await sleep(20);}
      expect(restored).toBe(true);

    } finally { await rpc.close(); rmSync(dir,{recursive:true,force:true}); }
  },30000);
});
