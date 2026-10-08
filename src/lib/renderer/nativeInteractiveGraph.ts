import type {InteractiveEffect} from '../mobile/studio/interactiveEffects';
import {buildMatterPasses} from './nativeInteractiveMatterGraph';
import {validateScene, INTERACTIVE_PRESETS, type InteractiveScene} from '../mobile/studio/interactive';
import type {NativePluginGraphOptions,NativePluginGraphBuildResult} from './nativePluginGraphs';
export const INTERACTIVE_PARTICLES=16384;
const common=/* wgsl */`
struct U { view:vec4<f32>, style:vec4<f32>, touch:vec4<f32>, params:vec4<f32>, flags:vec4<f32> };
struct Particle { state:vec4<f32>, life:vec4<f32> };
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> shapes:array<vec4<f32>>;
@group(0) @binding(3) var<storage,read> touches:array<vec4<f32>>;
fn hash(v:f32)->f32{return fract(sin(v*127.1+311.7)*43758.5453);}
fn palette(t:f32)->vec3<f32>{return .52+.48*cos(6.28318*(vec3<f32>(t)+vec3<f32>(0.,.33,.67)));}
fn cross2(a:vec2<f32>,b:vec2<f32>)->f32{return a.x*b.y-a.y*b.x;}
fn center(s:u32)->vec2<f32>{return shapes[s*66u+1u].xy;}
fn point(s:u32,i:u32)->vec2<f32>{return shapes[s*66u+2u+i].xy;}
fn contains(s:u32,p:vec2<f32>)->bool{
 let n=u32(shapes[s*66u+1u].z);var hit=false;
 for(var i=0u;i<n;i++){let a=point(s,i);let b=point(s,(i+1u)%n);if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x){hit=!hit;}}}return hit;
}
`;
export const INTERACTIVE_COMPUTE=common+/* wgsl */`
@group(0) @binding(2) var<storage,read_write> particles:array<Particle>;
@compute @workgroup_size(64) fn cs_main(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=16384u){return;}if(u.params.w>.5){return;}
 var p=particles[i];let dt=clamp(u.view.w,.001,.04);let seed=hash(f32(i)+u.flags.x*53.);
 if(p.life.x<=0.||p.state.x<-.15||p.state.x>1.15||p.state.y<-.15||p.state.y>1.15||p.life.z!=u.flags.x){
  var origin=vec2<f32>(hash(f32(i)*3.1+floor(u.view.z)),.01);
  for(var s=0u;s<u32(u.style.y);s++){if(shapes[s*66u+1u].w==1.&&hash(f32(i)+f32(s))>.4){origin=center(s);break;}}
  let angle=seed*6.28318; p.state=vec4<f32>(origin,cos(angle)*.06,sin(angle)*.06+.02);p.life=vec4<f32>(3.+seed*9.,seed,u.flags.x,0.);
 }
 let old=p.state.xy;var v=p.state.zw;v.y+=u.style.w*dt*.16;
 for(var s=0u;s<u32(u.style.y);s++){
  if(shapes[s*66u+1u].w==2.){let d=center(s)-old;let f=dt*.02/(dot(d,d)+.012);v+=(d+vec2<f32>(-d.y,d.x))*f;}
 }
 for(var t=0u;t<u32(u.flags.y);t++){
  let input=touches[t];let d=input.xy-old;let f=dt*.055*input.z/(dot(d,d)+.008);let radial=select(select(1.,-1.,input.w==1.),.1,input.w==2.);let swirl=select(.25,1.8,input.w==2.);v+=(d*radial+vec2<f32>(-d.y,d.x)*swirl)*f;
 }
 let flow=.012+u.style.z*.045+u.touch.z*.025;
 if(u.style.x==1.||u.style.x==3.){v+=vec2<f32>(sin(old.y*18.+u.view.z*.4),cos(old.x*15.-u.view.z*.3))*dt*flow;}
 if(u.style.x==4.){let d=old-vec2<f32>(.5);v+=vec2<f32>(-d.y,d.x)*dt*.12;}
 v*=exp(-dt*.18);v*=min(1.,.65/max(length(v),.0001));var next=old+v*dt;
 var nearest=2.;var norm=vec2<f32>(0.);
 for(var s=0u;s<u32(u.style.y);s++){
  if(shapes[s*66u+1u].w!=0.){continue;}let bounds=shapes[s*66u];if(any(max(old,next)<bounds.xy)||any(min(old,next)>bounds.zw)){continue;}
  let n=u32(shapes[s*66u+1u].z);for(var j=0u;j<n;j++){let a=point(s,j);let b=point(s,(j+1u)%n);let edge=b-a;let delta=next-old;let denom=cross2(delta,edge);if(abs(denom)<.000001){continue;}let t=cross2(a-old,edge)/denom;let r=cross2(a-old,delta)/denom;if(t>.00001&&t<=1.&&r>=0.&&r<=1.&&t<nearest){nearest=t;norm=normalize(vec2<f32>(-edge.y,edge.x));}}
 }
 if(nearest<=1.){next=old+(next-old)*nearest*.99;v=reflect(v,norm)*.86;}
 p.state=vec4<f32>(next,v);p.life.x-=dt;p.life.w=u.touch.z;particles[i]=p;
}
`;
export const INTERACTIVE_RENDER=common+/* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<Particle>;
struct V { @builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) color:vec4<f32> };
@vertex fn vs_bg(@builtin(vertex_index) i:u32)->V{var p=array<vec2<f32>,3>(vec2<f32>(-1.,-1.),vec2<f32>(3.,-1.),vec2<f32>(-1.,3.));var o:V;o.pos=vec4<f32>(p[i],0.,1.);o.uv=p[i]*vec2<f32>(.5,-.5)+.5;o.color=vec4<f32>(0.);return o;}
@fragment fn fs_bg(v:V)->@location(0) vec4<f32>{
 var color=vec3<f32>(0.);let aspect=u.view.x/u.view.y;let time=u.view.z;let mode=u.style.x;
 for(var s=0u;s<u32(u.style.y);s++){
  let box=shapes[s*66u];if(any(v.uv<box.xy-.025)||any(v.uv>box.zw+.025)){continue;}
  let n=u32(shapes[s*66u+1u].z);var distance=10.;for(var j=0u;j<n;j++){let a=point(s,j)*vec2<f32>(aspect,1.);let b=point(s,(j+1u)%n)*vec2<f32>(aspect,1.);let p=v.uv*vec2<f32>(aspect,1.);let e=b-a;distance=min(distance,length(p-a-e*clamp(dot(p-a,e)/max(dot(e,e),.000001),0.,1.)));}
  let tint=palette(u.params.x+f32(s)*.11);let edge=exp(-distance*850.)+exp(-distance*130.)*.25; color+=tint*edge*.45;
  if(contains(s,v.uv)){
   let p=(v.uv-center(s))*vec2<f32>(aspect,1.);let radius=length(p);var wave=0.;
   if(mode==0.){wave=pow(.5+.5*cos(distance*160.-time*1.2),10.);}
   else if(mode==1.){wave=pow(.5+.5*sin(p.x*32.+sin(p.y*19.+time*.5)*2.+time*.4),12.);}
   else if(mode==2.){wave=pow(.5+.5*cos(radius*100.-time*2.+sin(atan2(p.y,p.x)*5.)*2.),18.);}
   else if(mode==3.){wave=pow(.5+.5*sin(p.y*80.+sin(p.x*15.+time*.35)*6.),18.);}
   else if(mode==4.){wave=pow(.5+.5*cos(radius*130.-time*.7+atan2(p.y,p.x)*3.),20.);}
   else{wave=pow(.5+.5*sin(p.x*100.+sin(p.y*50.+time)*2.),30.)*pow(.5+.5*cos(p.y*80.-time*.2),3.);}
   color+=tint*wave*(.10+u.style.z*.25+u.touch.z*.15);
   for(var t=0u;t<u32(u.flags.y);t++){let input=touches[t];if(shapes[s*66u+1u].w==3.&&contains(s,input.xy)){let r=length((v.uv-input.xy)*vec2<f32>(aspect,1.));color+=palette(u.params.x+r)*pow(.5+.5*cos(r*110.-time*8.),14.)*exp(-r*3.)*.6;}}
  }
 }
 // Premultiplied: opacity (flags.z) scales the colour as well as the coverage.
 let lit=min(color,vec3<f32>(1.));return vec4<f32>(lit*u.flags.z,clamp(max(color.r,max(color.g,color.b))*2.,0.,1.)*u.flags.z);
}
@vertex fn vs_particle(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V{
 let p=particles[ii];var corners=array<vec2<f32>,6>(vec2<f32>(-1.,-1.),vec2<f32>(1.,-1.),vec2<f32>(-1.,1.),vec2<f32>(-1.,1.),vec2<f32>(1.,-1.),vec2<f32>(1.,1.));let c=corners[vi];
 let velocity=p.state.zw*u.view.xy;let direction=normalize(velocity+vec2<f32>(.0001));let side=vec2<f32>(-direction.y,direction.x);
 let span=select(2.+p.life.y*2.,7.+u.params.y*length(velocity)*.22,u.style.x==3.||u.style.x==1.);let offset=(direction*c.x*span+side*c.y*3.)/u.view.xy;
 var o:V;o.pos=vec4<f32>((p.state.xy+offset)*vec2<f32>(2.,-2.)+vec2<f32>(-1.,1.),0.,1.);o.uv=c;o.color=vec4<f32>(palette(u.params.x+p.life.y*.24),min(p.life.x,1.)*(.12+u.style.z*.18)*u.flags.z);return o;
}
@fragment fn fs_particle(v:V)->@location(0) vec4<f32>{let glow=exp(-dot(v.uv,v.uv)*3.);return vec4<f32>(v.color.rgb*glow*v.color.a,glow*v.color.a);}
`;
/** A buffer whose bytes the app owns. `key` is its content without the slots
 * the render core advances itself (clock, audio), so an unchanged key means
 * there is nothing to send. */
export type InteractiveGraphValue={id:string;initial_b64:string;key:string};
export type InteractiveGraphMeta={
 /** Everything that decides which buffers and passes exist. While it is
  * unchanged the installed graph stays and only `values` are updated. */
 topology:string;
 values:InteractiveGraphValue[];
 /** Every effect in the scene, enabled or not. An effect that is switched off
  * keeps its simulation; one that leaves this list has its buffers released. */
 effectIds:string[];
 /** Buffer id prefix of one effect. */
 bufferPrefix:(effectId:string)=>string;
};
export type InteractiveGraphBuildResult=NativePluginGraphBuildResult&{interactive:InteractiveGraphMeta};
/** `key` never leaves the app: it is stripped before the graph is sent. */
export type GraphBuffer={id:string;kind:string;byte_length:number;initial_b64?:string;key?:string;persistent?:boolean;clear?:boolean};
type GraphPass={name:string;shader_id:string;entry:string;dispatch:number[];bindings:object[]};
type GraphRender={name:string;instance_count:number;blend:string;clear:boolean;clear_color?:number[];[key:string]:unknown};
export type InteractivePart={buffers:GraphBuffer[];passes:GraphPass[];render_passes:GraphRender[]};
/** Floats per surface: bounds, centroid/count/behaviour, then 64 points. */
export const SHAPE_FLOATS=66*4;
const MATERIALS=['none','fire','smoke','liquid','points'],BEHAVIORS=['solid','emitter','attractor','trigger'];
export function interactiveB64(data:ArrayBufferView):string{
 const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);let s='';
 for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192) as unknown as number[]);
 return btoa(s);
}
/** A buffer the app fills. `coreSlots` are the floats the core rewrites on
 * every frame; they are left out of the key that decides whether to resend. */
export function valueBuffer(id:string,kind:'uniform'|'storage',data:Float32Array,coreSlots?:number[]):GraphBuffer{
 const initial_b64=interactiveB64(data);let key=initial_b64;
 if(coreSlots){const copy=data.slice();for(const slot of coreSlots)copy[slot]=0;key=interactiveB64(copy);}
 return {id,kind,byte_length:data.byteLength,initial_b64,key};
}
/** Clock, frame delta and audio level: written by the core on every frame. */
export const UNIFORM_CORE_SLOTS=[2,3,10];
/** Bass, mid, treble, energy, beat phase and tempo in the matter settings. */
export const MATTER_CORE_SLOTS=[40,41,42,43,44,45];
/** Surface geometry, sized to the surfaces in use (not a fixed 32): the
 * shaders only read `count` entries, and a two-surface scene is 2 KB to send
 * instead of 34 KB per effect. Materials are filled in per effect. */
function sceneShapes(surfaces:InteractiveScene['surfaces'],ownMaterials:boolean):Float32Array{
 const shapes=new Float32Array(Math.max(1,surfaces.length)*SHAPE_FLOATS);
 surfaces.forEach((s,i)=>{
  const base=i*SHAPE_FLOATS;let minX=1,minY=1,maxX=0,maxY=0,sumX=0,sumY=0;
  for(const p of s.points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);sumX+=p.x;sumY+=p.y;}
  shapes.set([minX,minY,maxX,maxY,sumX/s.points.length,sumY/s.points.length,s.points.length,BEHAVIORS.indexOf(s.behavior)],base);
  s.points.forEach((p,j)=>{shapes[base+8+j*4]=p.x;shapes[base+9+j*4]=p.y;});
  shapes[base+10]=ownMaterials?Math.max(0,MATERIALS.indexOf(s.material??'none')):0;shapes[base+11]=s.height??.25;
 });
 return shapes;
}
function touchInputs(raw:unknown):{data:Float32Array;count:number}{
 const data=new Float32Array(8*4),list=Array.isArray(raw)?raw.slice(0,8):[];
 list.forEach((p:any,i:number)=>{
  if(!Number.isFinite(p?.point?.x)||!Number.isFinite(p?.point?.y))return;
  data.set([Math.max(0,Math.min(1,p.point.x)),Math.max(0,Math.min(1,p.point.y)),Math.max(0,Math.min(1,Number(p.strength)||0)),p.mode==='repel'?1:p.mode==='vortex'?2:0],i*4);
 });
 return {data,count:list.length};
}
/** The values the core modulates from the installed parameters rather than
 * from a buffer. They change the installed graph, so they are structural. */
const CORE_MOD_KEYS=['energy','gravity','hue','trails','opacity'];
function coreModSignature(effect:InteractiveEffect):string{
 let signature='';
 for(const key of CORE_MOD_KEYS){const mod=effect.mods?.[key];if(mod&&mod.source!=='manual')signature+=`${key}=${JSON.stringify(mod)}@${effect.params[key]};`;}
 return signature;
}
/** One effect's (or a legacy single-style scene's) buffers and passes. */
function buildPart(options:NativePluginGraphOptions,scene:InteractiveScene,effect:InteractiveEffect|undefined,idPrefix:string,shapes:Float32Array,shapesB64:string,touches:{data:Float32Array;count:number},touchesB64:string,materials:Set<string>):InteractivePart{
 const id=(n:string)=>`${idPrefix}:interactive:${n}`;
 const params=effect?.params,preset=INTERACTIVE_PRESETS.indexOf(scene.preset);
 const u=new Float32Array(20);u.set([options.width,options.height,options.time,options.frameDelta,preset,scene.surfaces.length,params?.energy??scene.energy,params?.gravity??scene.gravity,0,0,options.audio.active?options.audio.energy:0,0,(params?.hue??scene.hue)/360,params?.trails??scene.trails,0,options.params.interactivePaused?1:0,Number(scene.seed)||0,Math.min(8,touches.count),params?.opacity??1,0]);
 const shared:GraphBuffer[]=[
  valueBuffer(id('uniform'),'uniform',u,UNIFORM_CORE_SLOTS),
  {id:id('surfaces'),kind:'storage',byte_length:shapes.byteLength,initial_b64:shapesB64},
  {id:id('touches'),kind:'storage',byte_length:touches.data.byteLength,initial_b64:touchesB64},
 ];
 if(preset>=6||materials.size)return buildMatterPasses(options,scene,id,shared,materials,effect);
 const uniform={binding:0,resource:id('uniform'),kind:'uniform'},geometry={binding:1,resource:id('surfaces'),kind:'read-only-storage'},touch={binding:3,resource:id('touches'),kind:'read-only-storage'};
 const bindings=[uniform,geometry,{binding:2,resource:id('particles'),kind:'read-only-storage'},touch];
 const render=(name:string,vertex:string,fragment:string,blend:string,vertices:number,instances:number):GraphRender=>({name,shader_id:'interactive/render',vertex_entry:vertex,fragment_entry:fragment,target:'source_frame',source_id:options.sourceId,seq:options.frameIndex,clear:false,blend,vertex_count:vertices,instance_count:instances,bindings});
 return {
  buffers:[...shared,{id:id('particles'),kind:'storage',byte_length:INTERACTIVE_PARTICLES*32,persistent:true,clear:!!options.reset}],
  passes:[{name:'interactive-simulate',shader_id:'interactive/compute',entry:'cs_main',dispatch:[INTERACTIVE_PARTICLES/64,1,1],bindings:[uniform,geometry,{binding:2,resource:id('particles'),kind:'storage'},touch]}],
  render_passes:[render('interactive-surfaces','vs_bg','fs_bg','alpha',3,1),render('interactive-particles','vs_particle','fs_particle','add',6,INTERACTIVE_PARTICLES)],
 };
}
/** An empty stack: one pass that clears the layer to transparent. No
 * simulation, and a one-particle placeholder for the shader's binding. */
function buildBlankPart(options:NativePluginGraphOptions,idPrefix:string):InteractivePart{
 const id=(n:string)=>`${idPrefix}:interactive:${n}`;
 const u=new Float32Array(20);u.set([options.width,options.height,options.time,options.frameDelta]);
 const bindings=[{binding:0,resource:id('uniform'),kind:'uniform'},{binding:1,resource:id('surfaces'),kind:'read-only-storage'},{binding:2,resource:id('particles'),kind:'read-only-storage'},{binding:3,resource:id('touches'),kind:'read-only-storage'}];
 return {
  buffers:[
   valueBuffer(id('uniform'),'uniform',u,UNIFORM_CORE_SLOTS),
   valueBuffer(id('surfaces'),'storage',new Float32Array(SHAPE_FLOATS)),
   valueBuffer(id('touches'),'storage',new Float32Array(32)),
   valueBuffer(id('particles'),'storage',new Float32Array(8)),
  ],
  passes:[],
  render_passes:[{name:'interactive-empty',shader_id:'interactive/render',vertex_entry:'vs_bg',fragment_entry:'fs_bg',target:'source_frame',source_id:options.sourceId,seq:options.frameIndex,clear:false,blend:'alpha',vertex_count:3,instance_count:1,bindings}],
 };
}
/**
 * Build the render graph for an Interactive scene.
 *
 * The scene is validated once. Every effect draws premultiplied colour over a
 * transparent frame, so the layer has real alpha and each effect's opacity
 * dims it. The result also says what is structure and what is only values:
 * the frame sync reinstalls the graph when `interactive.topology` changes and
 * otherwise sends just the value buffers that changed (Auto, keyframes,
 * sliders, touches, dragged surfaces).
 */
export function buildInteractiveGraph(options:NativePluginGraphOptions):InteractiveGraphBuildResult{
 const scene=validateScene(options.params.interactiveScene);
 const source=`performer-world:${options.sourceId.replace(/[^a-zA-Z0-9:_-]+/g,'_').slice(0,120)}`;
 const bufferPrefix=(effectId:string)=>`${source}:${effectId}:interactive:`;
 const touches=touchInputs(options.params.interactiveInputs),touchesB64=interactiveB64(touches.data);
 const parts:InteractivePart[]=[],effectIds:string[]=[];let mods='';
 if(scene.effects){
  // Geometry is the same for every effect; only the material on an effect's
  // target surface differs, so it is laid out once and encoded once per
  // distinct (target, material) pair instead of once per effect.
  const base=sceneShapes(scene.surfaces,false),encoded=new Map<string,{shapes:Float32Array;b64:string}>();
  for(const effect of scene.effects){
   if(!effect.enabled)continue;
   const material=({fire:'fire',smoke:'smoke',liquid:'liquid',cloud:'points'} as Record<string,string>)[effect.kind]??'none';
   const target=material==='none'?-1:scene.surfaces.findIndex(s=>s.id===effect.target),key=target<0?'-':`${target}:${material}`;
   let own=encoded.get(key);
   if(!own){const shapes=target<0?base:base.slice();if(target>=0)shapes[target*SHAPE_FLOATS+10]=MATERIALS.indexOf(material);own={shapes,b64:interactiveB64(shapes)};encoded.set(key,own);}
   const view:InteractiveScene={...scene,effects:undefined,preset:effect.kind,hue:effect.params.hue??scene.hue,matter:{...scene.matter!,...effect.params}};
   parts.push(buildPart(options,view,effect,`${source}:${effect.id}`,own.shapes,own.b64,touches,touchesB64,new Set(target>=0?[material]:[])));
   mods+=`${effect.id}[${coreModSignature(effect)}]`;
  }
  effectIds.push(...scene.effects.map(e=>e.id));
  if(!parts.length)parts.push(buildBlankPart(options,`${source}:empty`));
 }else{
  const shapes=sceneShapes(scene.surfaces,true);
  parts.push(buildPart(options,scene,undefined,source,shapes,interactiveB64(shapes),touches,touchesB64,new Set(scene.surfaces.map(s=>s.material??'none').filter(m=>m!=='none'))));
 }
 const buffers=parts.flatMap(p=>p.buffers),passes=parts.flatMap(p=>p.passes),render_passes=parts.flatMap(p=>p.render_passes);
 // Content over transparent: the first pass clears to zero alpha (the core's
 // default clear is opaque black, which made the whole layer opaque).
 render_passes.forEach((pass,i)=>{pass.clear=i===0;if(i===0)pass.clear_color=[0,0,0,0];});
 const values:InteractiveGraphValue[]=buffers.filter(b=>b.initial_b64!==undefined).map(b=>({id:b.id,initial_b64:b.initial_b64!,key:b.key??b.initial_b64!}));
 const topology=[
  options.params.interactivePaused?'paused':'running',mods,
  buffers.map(b=>`${b.id}:${b.kind}:${b.byte_length}:${b.persistent?1:0}`).join('|'),
  passes.map(p=>`${p.name}@${p.shader_id}/${p.entry}:${p.dispatch.join('x')}`).join('|'),
  render_passes.map(r=>`${r.name}:${r.instance_count}:${r.blend}`).join('|'),
 ].join('#');
 return {state:options.state??{scene:'interactive',prevFrameTime:options.time,historyHead:0},config:{buffers:buffers.map(({key:_key,...buffer})=>buffer),passes,render_passes,readbacks:[]},interactive:{topology,values,effectIds,bufferPrefix}};
}
