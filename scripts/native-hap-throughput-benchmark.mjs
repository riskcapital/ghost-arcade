#!/usr/bin/env node
// Native-resolution HAP playback throughput. Rebuild the core first.
// --streams=16 --seconds=10 --format=hap --output=/absolute/report.json
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,'').split('=');return [k,v.join('=')]}));
const bounce=args.bounce==='true';
const streams=Number(args.streams??16),seconds=Number(args.seconds??10),format=args.format??'hap',rate=Number(args.rate??1);
if(!Number.isInteger(streams)||streams<1||streams>16||!(seconds>0&&seconds<=120)||![1,-1].includes(rate)||!['hap','hap_alpha','hap_q'].includes(format))throw new Error('Invalid benchmark options');
const windows=process.platform==='win32';
if(!windows&&process.platform!=='darwin')throw new Error('A supported native GPU host is required');
const binary=join(process.cwd(),'native-renderer/target/release',windows?'ghost-render-core.exe':'ghost-render-core');
if(!existsSync(binary))throw new Error('Build the native core first');
const ffmpeg=createRequire(import.meta.url)('ffmpeg-static');
const directory=mkdtempSync(join(tmpdir(),'ghost-hap-throughput-'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,send;
try {
  const uri=join(directory,'source.mov');
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=60:duration=2','-an','-c:v','hap','-format',format,'-compressor','snappy','-chunks','4',uri],{timeout:120000});
  const paths=Array.from({length:streams},(_,i)=>{const p=join(directory,`clip-${i}.mov`);copyFileSync(uri,p);return p;});
  child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
  let nextId = 0;
  let stderr = '';
  let stopped;
  const pending = new Map();
  const fail = error => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`core exited ${code ?? signal}: ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) { fail(error); }
  });
  send = (method, params = {}, timeoutMs = 15000) => {
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
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => { if (error) fail(error); });
    });
  };
  const initial=await send('start',{config:{backend:windows?'d3d12':'metal',width:1920,height:1080,source_frame_size:512,target_fps:60,native_quality_policy:'fixed',decode_handoff_byte_cap_mb:1024}});
  if(!initial.backend_ready||initial.adapter_is_software)throw new Error('Hardware renderer is unavailable');
  const columns=Math.ceil(Math.sqrt(streams)),rows=Math.ceil(streams/columns);
  const commands=paths.flatMap((uri,i)=>{
    const x=(i%columns)/columns,y=Math.floor(i/columns)/rows,w=1/columns,h=1/rows;
    return [{type:'upsert_layer',layer_id:`layer-${i}`,opacity:1,z_index:i,corners:{topLeft:{x,y:1-y},topRight:{x:x+w,y:1-y},bottomRight:{x:x+w,y:1-y-h},bottomLeft:{x,y:1-y-h}}},
      {type:'set_media_source_playback',source_id:`clip-${i}`,uri,source_type:'video',time_seconds:rate<0?2:0,paused:false,playback_rate:rate,loop_enabled:true,bounce_enabled:bounce,duration_seconds:2,trim_start:0,trim_end:1,seek_generation:1,seq:1},
      {type:'bind_media_source',layer_id:`layer-${i}`,source_id:`clip-${i}`,uri,source_type:'video'}];
  });
  await send('submit_commands',{commands});
  const deadline=performance.now()+30000;
  let baseline;
  for(;;){
    baseline=await send('status');
    const playing=baseline.native_video_sessions.filter(s=>s.state==='playing');
    if(playing.length===streams&&playing.every(s=>s.backend==='hap-texture'&&s.frames_presented>60))break;
    if(performance.now()>deadline)throw new Error(`Streams did not prepare: ${JSON.stringify(baseline.native_video_sessions)}`);
    await sleep(100);
  }
  const begin=performance.now(),samples=[];
  while(performance.now()-begin<seconds*1000){await sleep(250);const s=await send('status');samples.push({elapsed_ms:performance.now()-begin,frames:s.frames_presented,hap_frames:s.native_video_hap_frames,underflows:s.native_video_stream_underflows});}
  const final=await send('status'),stats=await send('stats'),elapsed=(performance.now()-begin)/1000;
  const sessions=final.native_video_sessions.map(s=>{const b=baseline.native_video_sessions.find(v=>v.source_id===s.source_id);return {source_id:s.source_id,backend:s.backend,fps:(s.frames_presented-(b?.frames_presented??0))/elapsed,frames_dropped:s.frames_dropped-(b?.frames_dropped??0),reserved_bytes:s.reserved_bytes};});
  const report={captured_at:new Date().toISOString(),platform:process.platform,adapter:final.adapter_name,format,playback_rate:rate,bounce_enabled:bounce,streams,source_resolution:'1920x1080',source_fps:60,output_resolution:'1920x1080',atlas_slot_size:512,decode_budget_mb:1024,elapsed_seconds:elapsed,compositor_fps:(final.frames_presented-baseline.frames_presented)/elapsed,session_fps:sessions,render_cpu_ms:final.avg_render_cpu_ms,render_gpu_ms:final.avg_render_gpu_ms,media_pump_cpu_ms:stats.last_media_pump_cpu_ms,gpu_backpressure_skips:final.gpu_backpressure_skips-baseline.gpu_backpressure_skips,compressed_upload_bytes:final.source_frame_input_bytes_uploaded-baseline.source_frame_input_bytes_uploaded,hap_frames:final.native_video_hap_frames-baseline.native_video_hap_frames,software_frames:final.native_video_software_frames,hardware_fallbacks:final.native_video_hardware_fallbacks,decode_failures:final.native_video_frame_decode_failures,underflows:final.native_video_stream_underflows-baseline.native_video_stream_underflows,samples};
  const snapshot=await send('output_shared_texture_snapshot',{include_pixels:true});
  const pixels=Buffer.from(snapshot.rgba_b64??'','base64');
  report.visible_tiles=paths.filter((_,i)=>{
    for(const ox of [.2,.5,.8])for(const oy of [.2,.5,.8]){
      const x=Math.floor(((i%columns)+ox)/columns*snapshot.width),y=Math.floor((Math.floor(i/columns)+oy)/rows*snapshot.height),p=(y*snapshot.width+x)*4;
      if(pixels[p]+pixels[p+1]+pixels[p+2]>20)return true;
    }
    return false;
  }).length;
  report.accepted=report.visible_tiles===streams&&report.compositor_fps>=59&&sessions.length===streams&&sessions.every(s=>s.backend==='hap-texture'&&s.fps>=59)&&report.software_frames===0&&report.hardware_fallbacks===0&&report.decode_failures===0;
  if(args.output)writeFileSync(args.output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,samples:undefined},null,2));
  if(!report.accepted)process.exitCode=1;
} catch(error) {
  let status;
  if(send)try{status=await send('status')}catch{}
  if(args.output)writeFileSync(args.output,JSON.stringify({accepted:false,format,streams,error:String(error),sessions:status?.native_video_sessions},null,2)+'\n');
  throw error;
} finally {
  if(send)try{await send('shutdown',{},1000)}catch{}
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(timer);resolve()});child.kill();});
  rmSync(directory,{recursive:true,force:true});
}
