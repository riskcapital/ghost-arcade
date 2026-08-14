// Compile the three failing shaders one at a time and print the core's error.
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
const child = spawn('native-renderer/target/release/ghost-render-core', [], { stdio:['pipe','pipe','ignore'] });
let buf=''; const pending=new Map(); let id=1;
child.stdout.on('data', c=>{ buf+=c; let i;
  while((i=buf.indexOf('\n'))>=0){ const l=buf.slice(0,i); buf=buf.slice(i+1); if(!l.trim())continue;
    try{const m=JSON.parse(l); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}}catch{} }});
const send=(m,p={})=>new Promise((res,rej)=>{const my=id++;pending.set(my,res);
  child.stdin.write(JSON.stringify({id:my,method:m,params:p})+'\n');setTimeout(()=>rej(new Error('timeout')),10000);});
// Pull the WGSL template out of each TS module the same way the checker does.
const files = { LIGHT_PAINTING: 'src/lib/renderer/lightPaintingNative.ts',
                LINES: 'src/lib/renderer/linesNative.ts', TEXT: 'src/lib/renderer/textNative.ts' };
for (const [tag, f] of Object.entries(files)) {
  const src = readFileSync(f,'utf8');
  const m = src.match(/export const [A-Z_]*NATIVE_WGSL[^=]*=\s*\/\* wgsl \*\/\s*`([\s\S]*?)`;/)
        || src.match(/export const [A-Z_]*NATIVE_WGSL[^=]*=\s*`([\s\S]*?)`;/);
  if (!m) { console.log(`${tag}: could not extract template`); continue; }
  await send('submit_commands', { commands: [{ type:'precompile_shader', shader_id:`probe-${tag}`, stage:'module', entry:'main', source: m[1] }] });
  const snap = await send('snapshot');
  const st = snap.result?.status ?? snap.result ?? {};
  console.log(`${tag}: failed=${st.shader_precompile_failed ?? '?'} lastErr=${(st.last_shader_error ?? snap.result?.last_shader_error ?? 'none').toString().slice(0,220)}`);
}
child.kill();
