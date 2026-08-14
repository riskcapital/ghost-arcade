// Stress the code paths added during the native work and watch core RSS:
//   set_slice_outputs  -> creates/destroys per-slice render targets + IOSurface exports
//   set_composite_effects -> rebuilds the composite effect chain
//   set_output_stage   -> rewrites the 4KB warp/output uniform block
// Slice IDs are CHURNED so targets are allocated and reclaimed every round;
// a target that is not reclaimed shows up as monotonic RSS growth.
import { spawn, execSync } from 'child_process';
const child = spawn('native-renderer/target/release/ghost-render-core', [], { stdio: ['pipe','pipe','ignore'] });
let buf = ''; const pending = new Map(); let id = 1;
child.stdout.on('data', c => { buf += c; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0,i); buf = buf.slice(i+1);
    if (!l.trim()) continue; try { const m = JSON.parse(l); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
const send = (method, params={}) => new Promise((res,rej)=>{ const my=id++; pending.set(my,res);
  child.stdin.write(JSON.stringify({id:my,method,params})+'\n'); setTimeout(()=>rej(new Error('timeout '+method)),8000); });
const rss = () => Number(execSync(`ps -o rss= -p ${child.pid}`).toString().trim())/1024;
const mesh = (n) => ({ rows:n, cols:n, points: Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>({x:c/(n-1),y:r/(n-1)}))) });

await send('start', { backend:'metal', width:1280, height:720, decode_backend:'ffmpeg_software' });
await new Promise(r=>setTimeout(r,1500));
const base = rss();
console.log(`baseline after start: ${base.toFixed(1)} MB`);

const ROUNDS = 60;
for (let i = 0; i < ROUNDS; i++) {
  // Churn slice ids so targets must be created and reclaimed each round.
  await send('set_slice_outputs', { slices: [
    { id:`s-${i}-a`, width:1920, height:1080, cropW:0.5, warpMode:'mesh', meshGrid: mesh(8) },
    { id:`s-${i}-b`, width:1280, height:720, cropX:0.5, cropW:0.5, warpMode:'corners',
      corners:{topLeft:{x:0,y:0},topRight:{x:1,y:0},bottomRight:{x:1,y:1},bottomLeft:{x:0,y:1}} },
  ]});
  await send('set_composite_effects', { effects: [
    { descriptor:`hue:${(i%10)/10}`, mix:0.5 }, { descriptor:'saturation:1.2', mix:1 }, { descriptor:'blur:3', mix:1 },
  ]});
  await send('set_output_stage', { domeEnabled: i%2===0, domeFOV:180, cropX:0.05, brightness:1.1,
    masterWarp:{ enabled:true, mode:'mesh', meshGrid: mesh(6) } });
  await send('set_output_state', { blackout: i%3===0, frozen:false });
  if (i % 15 === 14) { await new Promise(r=>setTimeout(r,800)); console.log(`  round ${i+1}: ${rss().toFixed(1)} MB`); }
}
// Release everything and let the retain() path reclaim.
await send('set_slice_outputs', { slices: [] });
await send('set_composite_effects', { effects: [] });
await new Promise(r=>setTimeout(r,2500));
const end = rss();
console.log(`after release: ${end.toFixed(1)} MB   delta vs baseline: ${(end-base>=0?'+':'')}${(end-base).toFixed(1)} MB`);
child.kill();
