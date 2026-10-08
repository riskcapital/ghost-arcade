// Regenerate portable effect definitions from a read-only desktop source checkout.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const dest=process.cwd();
const src=process.env.DESKTOP_SOURCE_ROOT || process.cwd();
const require=createRequire(dest+'/package.json');const esbuild=require('esbuild');
const code=fs.readFileSync(src+'/src/lib/renderer/effects.ts','utf8');
const imports=[...code.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?/g)].filter(m=>m[2].startsWith('./shaders/')).map(m=>`import {${m[1]}} from ${JSON.stringify(src+'/src/lib/renderer/'+m[2])};`).join('\n');
const obj=code.match(/export const effectShaders[^=]*=\s*(\{[\s\S]*?\n\});/)[1];
const entry=imports+'\nexport const shaders='+obj+';';
try{await esbuild.build({stdin:{contents:entry,resolveDir:src,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:'/tmp/mobile-desktop-shaders.mjs',logLevel:'silent'});}catch(e){console.log(e.message);process.exit(1)}
const {shaders}=await import('file:///tmp/mobile-desktop-shaders.mjs');
await esbuild.build({entryPoints:[src+'/src/lib/effects/effectParamDefs.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/mobile-desktop-params.mjs',logLevel:'silent'});
const {EFFECT_PARAM_DEFS:params}=await import('file:///tmp/mobile-desktop-params.mjs');
for(const [k,list]of Object.entries(params)) params[k]=list.flatMap(p=>p.type==='color'&&p.colorParams?Object.entries(p.colorParams).map(([channel,key])=>({name:p.name+' '+channel.toUpperCase(),param:key,min:0,max:1,step:.01,default:channel==='r'?1:0})): [p]);
const ux=fs.readFileSync(src+'/src/lib/effects/effectUX.ts','utf8').replace(/^import .*;$/gm,'');
await esbuild.build({stdin:{contents:ux,loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:'/tmp/mobile-desktop-ux.mjs',logLevel:'silent'});
const {effectParamLabels}=await import('file:///tmp/mobile-desktop-ux.mjs');
for(const [type,defs]of Object.entries(effectParamLabels)) params[type]=Object.entries(defs).filter(([key,p])=>p.type!=='color').map(([key,p])=>({name:p.label,param:key,min:p.min,max:p.max,step:p.step,default:p.default,...(p.type?{type:p.type}:{}),...(p.options?{options:p.options}:{})}));
const catalog=fs.readFileSync(src+'/src/lib/effects/effectCatalog.ts','utf8');
const create=code.slice(code.indexOf('export function createEffectMaterial'),code.indexOf('export function updateEffectUniforms'));
const update=code.slice(code.indexOf('export function updateEffectUniforms'),code.indexOf('export function getDefaultEffectParams'));
const block=(s,type)=>s.match(new RegExp("case '"+type+"':([\\s\\S]*?)(?=\\n\\s*case '|\\n\\s*default:|$)"))?.[1]||'';
let results=[],skip=[];
for(const [type,shader] of Object.entries(shaders)){
 if(!params[type] || !shader || /uniform\s+(?:vec[34]|mat\w+)\b|samplerCube|sampler3D|\buFeedback\b|\buHistory\b/.test(shader)){skip.push(type);continue;}
 const uniforms=[...shader.matchAll(/uniform\s+(\w+)\s+(\w+)\s*(\[[^\]]+\])?\s*;/g)];
 if(uniforms.some(([_,t,n,arr])=>arr||(t==='sampler2D'&&n!=='uTexture')||(t==='vec2'&&n!=='uResolution'))){skip.push(type);continue;}
 let b=block(update,type),init=block(create,type),defaults={},mapping={},control=[];let valid=true;
 for(const [_,kind,name] of uniforms){
  if(['uTexture','uResolution','uTime','uAudio','uAudioBass','uAudioHigh','uAudioBeatPulse'].includes(name))continue;
  if(!['float','int','bool'].includes(kind)){valid=false;break;}
  const assignment=b.match(new RegExp('u\\.'+name+'\\.value\\s*=\\s*p\\.(\\w+)\\s*;'));
  const value=init.match(new RegExp('uniforms\\.'+name+'\\s*=\\s*\\{\\s*value:\\s*(-?[\\d.]+)\\s*\\}'));
  if(assignment){const param=params[type].find(p=>p.param===assignment[1]);if(!param){valid=false;break;}mapping[name]=assignment[1];defaults[assignment[1]]=param.default;control.push(param);}
  else if(value){mapping[name]=name;defaults[name]=Number(value[1]);}
  else{valid=false;break;}
 }
 if(!valid||!control.length){skip.push(type);continue;}
 // Do not port a partially bound UI: every exposed desktop scalar must be supported.
 if(params[type].some(p=>p.type!=='color'&&!control.some(c=>c.param===p.param))){skip.push(type);continue;}
 let fragment=shader;
 const rename={uTexture:'uInput',...mapping};
 for(const [from,to]of Object.entries(rename)) fragment=fragment.replace(new RegExp('\\b'+from+'\\b','g'),to);
 // ES 1.00 compatibility for desktop scalar integer helpers.
 fragment=fragment.replace('stepIdx % 2', 'int(mod(float(stepIdx), 2.))');
 const fixedRead=(name,index,count)=>{const expr='('+Array.from({length:count-1},(_,i)=>`${index}==${i}?${name}[${i}]:`).join('')+`${name}[${count-1}])`;fragment=fragment.replaceAll(`${name}[${index}]`,expr);};
 if(type==='dither')fixedRead('P','idx',4);
 if(type==='posterize'){for(const index of ['i0','i1']){fixedRead('palT',index,5);fixedRead('palR',index,4);}}
 if(type==='kuwahara')fixedRead('means','bestQ',4);
 if(type==='oilPaint'){skip.push(type);continue;} // Per-pixel histogram loops are unsuitable for the phone's live path.
 fragment='precision highp float;\nint abs(int x){return x<0?-x:x;}\nint min(int a,int b){return a<b?a:b;}\nint max(int a,int b){return a>b?a:b;}\n'+fragment;
 const meta=catalog.match(new RegExp("type: '"+type+"', label: '([^']+)', category: '([^']+)'"));
 results.push({type,label:meta?.[1]||type,category:meta?.[2]||'Effects',fragment,defaults,controls:control,integerParams:uniforms.filter(u=>['int','bool'].includes(u[1])).map(u=>mapping[u[2]]).filter(Boolean)});
}
fs.writeFileSync(dest+'/src/lib/mobile/studio/desktopEffects.ts','// Portable single-pass shaders and controls from desktop 57b366b8. No desktop stores or native dependencies.\nimport type { MobileEffectDef } from "../standaloneEffects";\nexport const DESKTOP_MOBILE_EFFECTS: MobileEffectDef[] = '+JSON.stringify(results,null,2)+';\n');
console.log('Ported',results.length,results.map(r=>r.type).join(', '));console.log('Skipped',skip.length);
