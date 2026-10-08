import {effectScene,type InteractiveEffect} from '../mobile/studio/interactiveEffects';
import {buildMatterPasses} from './nativeInteractiveMatterGraph';
import {validateScene, defaultMatter, INTERACTIVE_PRESETS, type InteractiveScene} from '../mobile/studio/interactive';
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
 return vec4<f32>(color,clamp(max(color.r,max(color.g,color.b))*2.,0.,1.)*u.flags.z);
}
@vertex fn vs_particle(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V{
 let p=particles[ii];var corners=array<vec2<f32>,6>(vec2<f32>(-1.,-1.),vec2<f32>(1.,-1.),vec2<f32>(-1.,1.),vec2<f32>(-1.,1.),vec2<f32>(1.,-1.),vec2<f32>(1.,1.));let c=corners[vi];
 let velocity=p.state.zw*u.view.xy;let direction=normalize(velocity+vec2<f32>(.0001));let side=vec2<f32>(-direction.y,direction.x);
 let span=select(2.+p.life.y*2.,7.+u.params.y*length(velocity)*.22,u.style.x==3.||u.style.x==1.);let offset=(direction*c.x*span+side*c.y*3.)/u.view.xy;
 var o:V;o.pos=vec4<f32>((p.state.xy+offset)*vec2<f32>(2.,-2.)+vec2<f32>(-1.,1.),0.,1.);o.uv=c;o.color=vec4<f32>(palette(u.params.x+p.life.y*.24),min(p.life.x,1.)*(.12+u.style.z*.18)*u.flags.z);return o;
}
@fragment fn fs_particle(v:V)->@location(0) vec4<f32>{let glow=exp(-dot(v.uv,v.uv)*3.);return vec4<f32>(v.color.rgb*glow*v.color.a,glow*v.color.a);}
`;
function b64(a:ArrayBuffer){const bytes=new Uint8Array(a);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
export function buildInteractiveGraph(options:NativePluginGraphOptions):NativePluginGraphBuildResult{
 const stackScene=validateScene(options.params.interactiveScene);if(stackScene.effects){const enabled=stackScene.effects.filter(e=>e.enabled);const configs=enabled.map(e=>buildInteractiveGraph({...options,sourceId:options.sourceId,params:{...options.params,interactiveScene:effectScene(stackScene,e),interactiveEffect:e},state:null}).config);
 const buffers=configs.flatMap(c=>c.buffers as any[]),passes=configs.flatMap(c=>c.passes as any[]),render_passes=configs.flatMap(c=>c.render_passes as any[]);if(!render_passes.length){const blank=buildInteractiveGraph({...options,params:{...options.params,interactiveScene:{...stackScene,effects:undefined,preset:'architecture',surfaces:[],energy:0},interactiveEffect:{id:'empty',params:{opacity:0}}}});return blank;}render_passes.forEach((p,i)=>{p.clear=i===0;});return {state:options.state??{scene:'interactive-stack',prevFrameTime:options.time,historyHead:0},config:{buffers,passes,render_passes,readbacks:[]}};
 }
 const scene=validateScene(options.params.interactiveScene);const effect=options.params.interactiveEffect as InteractiveEffect|undefined;const id=(n:string)=>`performer-world:${options.sourceId.replace(/[^a-zA-Z0-9:_-]+/g,'_').slice(0,120)}${effect?':'+effect.id:''}:interactive:${n}`;
 const u=new Float32Array(20);u.set([options.width,options.height,options.time,options.frameDelta,INTERACTIVE_PRESETS.indexOf(scene.preset),scene.surfaces.length,scene.energy,scene.gravity,0,0,options.audio.active?options.audio.energy:0,0,scene.hue/360,scene.trails,0,options.params.interactivePaused?1:0,Number(scene.seed)||0,0,0,0]);
 const shapes=new Float32Array(32*66*4);scene.surfaces.forEach((s,i)=>{const base=i*66*4;shapes.set([Math.min(...s.points.map(p=>p.x)),Math.min(...s.points.map(p=>p.y)),Math.max(...s.points.map(p=>p.x)),Math.max(...s.points.map(p=>p.y)),s.points.reduce((v,p)=>v+p.x,0)/s.points.length,s.points.reduce((v,p)=>v+p.y,0)/s.points.length,s.points.length,['solid','emitter','attractor','trigger'].indexOf(s.behavior)],base);s.points.forEach((p,j)=>shapes.set([p.x,p.y,j===0?['none','fire','smoke','liquid','points'].indexOf(s.material??'none'):0,j===0?(s.height??.25):0],base+8+j*4));});
 const inputs=new Float32Array(8*4);const raw=Array.isArray(options.params.interactiveInputs)?options.params.interactiveInputs:[];raw.slice(0,8).forEach((p:any,i:number)=>{if(!Number.isFinite(p.point?.x)||!Number.isFinite(p.point?.y))return;inputs.set([Math.max(0,Math.min(1,p.point.x)),Math.max(0,Math.min(1,p.point.y)),Math.max(0,Math.min(1,Number(p.strength)||0)),p.mode==='repel'?1:p.mode==='vortex'?2:0],i*4);});u[17]=Math.min(8,raw.length);u[18]=effect?.params.opacity??1;
 if(INTERACTIVE_PRESETS.indexOf(scene.preset)>=6||scene.surfaces.some(s=>s.material&&s.material!=='none'))return buildMatterPasses(options,scene,id,u,shapes,inputs,b64,effect);
 const uniform={binding:0,resource:id('uniform'),kind:'uniform'},geometry={binding:1,resource:id('surfaces'),kind:'read-only-storage'},touches={binding:3,resource:id('touches'),kind:'read-only-storage'};
 const bindings=[uniform,geometry,{binding:2,resource:id('particles'),kind:'read-only-storage'},touches];
 return{state:options.state??{scene:'interactive',prevFrameTime:options.time,historyHead:0},config:{buffers:[{id:id('uniform'),kind:'uniform',byte_length:80,initial_b64:b64(u.buffer)},{id:id('surfaces'),kind:'storage',byte_length:shapes.byteLength,initial_b64:b64(shapes.buffer)},{id:id('touches'),kind:'storage',byte_length:inputs.byteLength,initial_b64:b64(inputs.buffer)},{id:id('particles'),kind:'storage',byte_length:INTERACTIVE_PARTICLES*32,persistent:true,clear:!!options.reset}],passes:[{name:'interactive-simulate',shader_id:'interactive/compute',entry:'cs_main',dispatch:[INTERACTIVE_PARTICLES/64,1,1],bindings:[uniform,geometry,{binding:2,resource:id('particles'),kind:'storage'},touches]}],render_passes:[{name:'interactive-surfaces',shader_id:'interactive/render',vertex_entry:'vs_bg',fragment_entry:'fs_bg',target:'source_frame',source_id:options.sourceId,seq:options.frameIndex,clear:true,blend:'alpha',vertex_count:3,instance_count:1,bindings},{name:'interactive-particles',shader_id:'interactive/render',vertex_entry:'vs_particle',fragment_entry:'fs_particle',target:'source_frame',source_id:options.sourceId,seq:options.frameIndex,clear:false,blend:'add',vertex_count:6,instance_count:INTERACTIVE_PARTICLES,bindings}],readbacks:[]}};
}
