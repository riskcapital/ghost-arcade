// macOS: isolate HAP upload cost using identical media/settings across builds.
// node scripts/hap-upload-bench.mjs <core-binary> <video.mov> [more videos...]
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
if (process.platform !== 'darwin') throw new Error('This CPU benchmark currently uses macOS ps timing.');
const [binary, ...files] = process.argv.slice(2);
if (!binary || !files.length) throw new Error('Provide a native core binary and HAP files.');
const child = spawn(resolve(binary), [], {stdio:['pipe','pipe','pipe']});
let sequence = 0, stderr = '';
const pending = new Map();
child.stderr.on('data', b => { stderr = (stderr + b).slice(-4000); });
createInterface({input:child.stdout}).on('line', line => {
  const message=JSON.parse(line), request=pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  message.ok ? request.resolve(message.result) : request.reject(new Error(message.error));
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence;
  const timer=setTimeout(()=>reject(new Error(`${method} timed out: ${stderr}`)),20000);
  pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
  child.stdin.write(JSON.stringify({id,method,params})+'\n');
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function cpuSeconds(){
  const parts=execFileSync('ps',['-p',String(child.pid),'-o','time='],{encoding:'utf8'}).trim().split(':').map(Number);
  return parts.reduce((total,n)=>total*60+n,0);
}
try {
  await send('start',{config:{backend:'metal',width:1920,height:1080,
    source_frame_size:1024,target_fps:60,native_quality_policy:'fixed'}});
  const commands=files.flatMap((file,i)=>[
    {type:'upsert_layer',layer_id:`video-${i}`,visible:true,opacity:1,z_index:i,blend_mode:'normal',
      corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:0,y:0}}},
    {type:'set_media_source_playback',source_id:`source-${i}`,uri:resolve(file),source_type:'video',
      time_seconds:0,paused:false,playback_rate:1,loop_enabled:true,duration_seconds:8,seek_generation:1},
    {type:'bind_media_source',layer_id:`video-${i}`,source_id:`source-${i}`,uri:resolve(file),source_type:'video'}
  ]);
  await send('submit_commands',{commands});
  await sleep(2500);
  const before=await send('status'), cpuStart=cpuSeconds(), start=performance.now();
  await sleep(8000);
  const elapsed=(performance.now()-start)/1000, cpu=cpuSeconds()-cpuStart, after=await send('status');
  console.log(JSON.stringify({binary,clips:files.length,elapsed,cpuSeconds:cpu,cpuPercent:cpu/elapsed*100,
    hapFrames:after.native_video_hap_frames-before.native_video_hap_frames,
    outputFrames:after.frames_presented-before.frames_presented,
    avgGpuMs:after.avg_render_gpu_ms,avgCpuMs:after.avg_render_cpu_ms,
    decodeFailures:after.native_video_frame_decode_failures,
    sessions:after.native_video_sessions.map(s=>({id:s.source_id,backend:s.backend,frames:s.frames_presented,state:s.state}))},null,2));
} finally {
  try{await send('shutdown')}finally{child.kill()}
}
