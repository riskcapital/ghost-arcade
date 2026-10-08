import {effectParams,MOD_SOURCES,type InteractiveEffect} from '../mobile/studio/interactiveEffects';
import {defaultMatter,type InteractiveScene} from '../mobile/studio/interactive';
import type {NativePluginGraphOptions,NativePluginGraphBuildResult} from './nativePluginGraphs';
import {MATTER_W,MATTER_H} from './nativeInteractiveMatter';
/** Stable A/B pass schedule: native graphs replay without JS per-frame swaps. */
export function buildMatterPasses(options:NativePluginGraphOptions,scene:InteractiveScene,baseId:(s:string)=>string,u:Float32Array,shapes:Float32Array,inputs:Float32Array,b64:(a:ArrayBuffer)=>string,effect?:InteractiveEffect):NativePluginGraphBuildResult{
 // Keep uniform suffixes stable: native replay recognizes these to preserve material settings.
 const id=(name:string)=>baseId(name==='uniform'||name==='matter'?name:'matter-v2:'+name);
 const matter=scene.matter??defaultMatter();const cells=MATTER_W*MATTER_H;
 const settings=new Float32Array(48+40*8);settings.set([matter.lightX,matter.lightY,matter.lightHeight,matter.lightPower,matter.haze,matter.bounce,matter.friction,matter.flow,matter.viscosity,matter.size,scene.surfaces.some(s=>s.material==='fire'||s.material==='smoke')?1:0,scene.surfaces.some(s=>s.material==='liquid')?1:0,MATTER_W,MATTER_H,scene.surfaces.some(s=>s.material==='points')?1:0,effect?.target==='point'?1:0]);
 settings.set([.5,.12,.04,.15,0,1,2,.4,scene.hue,1,.7,2,.65,.12,.65,1.1,.5,.75,175,.35,1,2,.05,90],16);
 if(effect){for(const d of effectParams(effect.kind)){if(d.slot===undefined)continue;settings[d.slot]=effect.params[d.key]??d.value;const mod=effect.mods[d.key];if(mod&&mod.source!=='manual'){const i=48+d.slot*8;settings.set([MOD_SOURCES.indexOf(mod.source as any),mod.amount,mod.speed,mod.invert?1:0,mod.rangeMin!==undefined&&mod.rangeMax!==undefined?d.min+mod.rangeMin*(d.max-d.min):d.min,mod.rangeMin!==undefined&&mod.rangeMax!==undefined?d.min+mod.rangeMax*(d.max-d.min):d.max,mod.bpmSync?1:0,mod.rangeMin!==undefined&&mod.rangeMax!==undefined?1:0],i);}}settings[20]=['continuous','pulse','burst'].indexOf(effect.emission);settings[46]=effect.burst;settings[47]=1;}
 settings.set([options.audio.bass,options.audio.mid,options.audio.treble,options.audio.energy,options.audio.beatPhase,120],40);
 const buffer=(name:string,bytes:number,persistent=true)=>({id:id(name),kind:'storage',byte_length:bytes,persistent,clear:!!options.reset});
 const read=(binding:number,name:string)=>({binding,resource:id(name),kind:'read-only-storage'});
 const write=(binding:number,name:string)=>({binding,resource:id(name),kind:'storage'});
 const U={binding:0,resource:id('uniform'),kind:'uniform'},M={binding:4,resource:id('matter'),kind:'uniform'},G=read(5,'geometry');
 const E=read(10,'emission');const common=[U,read(1,'surfaces'),read(3,'touches'),M,E];
 const dispatch=[32,18,1];const passes:Record<string,unknown>[]=[];
 function pass(name:string,shader:string,entry:string,bindings:object[],groups=dispatch){passes.push({name:'interactive-'+name,shader_id:'interactive/'+shader,entry,bindings,dispatch:groups});}
 pass('emission','emission','cs_emission',[U,M,write(10,'emission')],[1,1,1]);
 pass('geometry','geometry','cs_geometry',[...common,write(5,'geometry')]);
 const fluid=scene.preset==='fire'||scene.preset==='smoke'||scene.surfaces.some(s=>s.material==='fire'||s.material==='smoke');
 if(fluid){
 pass('advect','fluid','cs_advect',[...common,G,read(2,'particles'),read(6,'fluid-a'),write(7,'fluid-b')]);
 pass('divergence','fluid','cs_divergence',[...common,G,read(6,'fluid-b'),write(9,'pressure-a')]);
 for(let i=0;i<16;i++)pass('pressure-'+i,'fluid','cs_jacobi',[...common,G,read(8,i%2?'pressure-b':'pressure-a'),write(9,i%2?'pressure-a':'pressure-b')]);
 pass('project','fluid','cs_project',[...common,G,read(6,'fluid-b'),write(7,'fluid-a'),read(8,'pressure-a')]);
 }
 if(scene.preset!=='light'&&scene.preset!=='smoke'){
 pass('matter-step','matter-particles','cs_step',[...common,G,read(2,'particles'),write(6,'particle-next'),read(7,'mass')],[256,1,1]);
 pass('matter-commit','matter-particles','cs_copy',[read(2,'particle-next'),write(6,'particles')],[256,1,1]);
 }
 if(scene.preset==='liquid'||scene.surfaces.some(s=>s.material==='liquid')){
 pass('mass-clear','mass','cs_clear',[write(7,'mass')],[cells/64,1,1]);
 pass('mass-splat','mass','cs_splat',[U,M,E,read(2,'particles'),write(7,'mass')],[64,1,1]);
 pass('mass-smooth-x','mass','cs_smooth_x',[U,M,read(6,'mass'),write(7,'mass-temp')]);
 pass('mass-smooth-y','mass','cs_smooth_y',[U,M,read(6,'mass-temp'),write(7,'mass')]);
 }
 if(scene.preset==='light')pass('volume-light','light','cs_light',[...common,G,read(6,'fluid-a'),write(7,'lighting')]);
 const bindings=[...common,G,read(2,'particles'),read(6,'fluid-a'),read(7,'mass'),read(8,'lighting')];
 const render=(name:string,vertex:string,fragment:string,clear:boolean,instances:number)=>({name:'interactive-'+name,shader_id:'interactive/matter-render',vertex_entry:vertex,fragment_entry:fragment,target:'source_frame',source_id:options.sourceId,seq:options.frameIndex,clear,blend:'alpha',vertex_count:clear?3:6,instance_count:instances,bindings});
 return{state:{scene:'interactive-matter',prevFrameTime:options.time,historyHead:0},config:{buffers:[
  {id:id('uniform'),kind:'uniform',byte_length:80,initial_b64:b64(u.buffer as ArrayBuffer)},
  {id:id('matter'),kind:'uniform',byte_length:settings.byteLength,initial_b64:b64(settings.buffer)},
  {id:id('surfaces'),kind:'storage',byte_length:shapes.byteLength,initial_b64:b64(shapes.buffer as ArrayBuffer)},
  {id:id('touches'),kind:'storage',byte_length:inputs.byteLength,initial_b64:b64(inputs.buffer as ArrayBuffer)},
  buffer('emission',32),buffer('mass-temp',cells*4),buffer('particles',16384*32),buffer('particle-next',16384*32),buffer('geometry',cells*32,false),buffer('fluid-a',cells*16),buffer('fluid-b',cells*16),buffer('pressure-a',cells*8),buffer('pressure-b',cells*8),buffer('mass',cells*4),buffer('lighting',cells*16,false)
 ],passes,render_passes:[render('matter-surfaces','vs_bg','fs_bg',true,1),render('matter-particles','vs_particle','fs_particle',false,scene.preset==='balls'?96:16384)],readbacks:[]}};
}
