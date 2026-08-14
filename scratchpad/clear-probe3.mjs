// What does the EXPORT texture (the thing the editor preview displays)
// contain after the last layer is removed?
import { spawn } from 'child_process';
const c = spawn('native-renderer/target/release/ghost-render-core', [], { stdio:['pipe','pipe','ignore'] });
let b=''; const p=new Map(); let i=1;
c.stdout.on('data',d=>{b+=d;let j;while((j=b.indexOf('\n'))>=0){const l=b.slice(0,j);b=b.slice(j+1);if(!l.trim())continue;
 try{const m=JSON.parse(l);if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}}catch{}}});
const send=(m,q={})=>new Promise((res,rej)=>{const k=i++;p.set(k,res);c.stdin.write(JSON.stringify({id:k,method:m,params:q})+'\n');
 setTimeout(()=>rej(new Error('timeout '+m)),8000);});
const exportLuma = async (label) => {
  try {
    const s = (await send('get_output_shared_texture_snapshot', { include_pixels:false })).result ?? {};
    console.log(label, JSON.stringify({ maxLuma: s.max_luma ?? s.last_frame_max_luma, dark: s.dark_frame ?? s.last_frame_dark }));
  } catch (e) { console.log(label, 'ERR', e.message); }
};
await send('start', { backend:'metal', width:640, height:360, decode_backend:'ffmpeg_software' });
await new Promise(r=>setTimeout(r,800));
await send('submit_batch', { frame_id:1, commands: [
  { type:'upsert_layer', layer_id:'L1', z_index:0, visible:true, opacity:1,
    color:[1,0,0,1], source_kind:0, corners:[[0,1],[1,1],[1,0],[0,0]] },
]});
await new Promise(r=>setTimeout(r,600));
await exportLuma('export with layer   :');
await send('submit_batch', { frame_id:2, commands: [ { type:'remove_layer', layer_id:'L1' } ]});
await new Promise(r=>setTimeout(r,800));
await exportLuma('export after remove :');
c.kill();
