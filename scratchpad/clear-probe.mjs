// Does the core actually go black after the last layer is removed?
import { spawn } from 'child_process';
const c = spawn('native-renderer/target/release/ghost-render-core', [], { stdio:['pipe','pipe','ignore'] });
let b=''; const p=new Map(); let i=1;
c.stdout.on('data',d=>{b+=d;let j;while((j=b.indexOf('\n'))>=0){const l=b.slice(0,j);b=b.slice(j+1);if(!l.trim())continue;
 try{const m=JSON.parse(l);if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}}catch{}}});
const send=(m,q={})=>new Promise((res,rej)=>{const k=i++;p.set(k,res);c.stdin.write(JSON.stringify({id:k,method:m,params:q})+'\n');
 setTimeout(()=>rej(new Error('timeout '+m)),8000);});
const luma = (snap) => {
  const s = snap.result ?? snap;
  return { maxLuma: s.last_frame_max_luma ?? s.max_luma, dark: s.last_frame_dark ?? s.dark_frame,
           w: s.width, h: s.height };
};
await send('start', { backend:'metal', width:640, height:360, decode_backend:'ffmpeg_software' });
await new Promise(r=>setTimeout(r,800));
// Solid red color layer, full-frame.
await send('submit_commands', { commands: [
  { type:'upsert_layer', layer_id:'L1', z_index:0, visible:true, opacity:1,
    color:[1,0,0,1], source_kind:0,
    corners:[[0,1],[1,1],[1,0],[0,0]] },
]});
await new Promise(r=>setTimeout(r,400));
const withLayer = await send('get_frame_snapshot', { include_pixels:false });
console.log('with layer   :', JSON.stringify(luma(withLayer)));
// Remove it — same shape the sync's flush sends.
await send('submit_commands', { commands: [ { type:'remove_layer', layer_id:'L1' } ]});
await new Promise(r=>setTimeout(r,600));
const cleared = await send('get_frame_snapshot', { include_pixels:false });
console.log('after remove :', JSON.stringify(luma(cleared)));
c.kill();
