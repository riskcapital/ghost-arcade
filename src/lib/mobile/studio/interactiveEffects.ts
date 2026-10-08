import type {InteractiveScene, SurfaceMaterial} from './interactive';
import type {AutoConfig} from '../../types';
import {advanceAutoPhase,resolveAutoValue} from '../../audio/autoCurves';
import {KEYFRAME_EASINGS} from '../../keyframes/easing';
import type {ParamModulation} from '../../audio/modulationControls';
export type EffectKind = InteractiveScene['preset'];
export type InteractiveEffect = {id:string;kind:EffectKind;name:string;enabled:boolean;target:string;emission:'continuous'|'pulse'|'burst';burst:number;params:Record<string,number>;mods:Record<string,ParamModulation>;paramAuto?:Record<string,AutoConfig>};
export type EffectParam = {key:string;label:string;min:number;max:number;step:number;value:number;slot?:number;group?:string};
const p=(key:string,label:string,min:number,max:number,value:number,slot?:number,group='Look'):EffectParam=>({key,label,min,max,value,slot,group,step:max>20?1:.01});
export const EFFECT_NAMES:Record<EffectKind,string>={architecture:'Living Architecture',garden:'Gravity Garden',walls:'Contour Waves',ribbons:'Silk Flow',orbit:'Orbital Bloom',electric:'Neural Web',light:'Volumetric Light',balls:'Kinetic Balls',smoke:'Rising Smoke',cloud:'Point Swarm',liquid:'Liquid',fire:'Fire'};
export const EFFECT_KINDS=Object.keys(EFFECT_NAMES) as EffectKind[];
export const MAX_INTERACTIVE_EFFECTS=8;
export const MOD_SOURCES=['manual','sub','bass','lowMid','mid','highMid','treble','air','presence','high','amplitude','beatPhase','kick','snare','lfo-sine','lfo-tri','lfo-saw','lfo-square'] as const;
export function effectParams(kind:EffectKind):EffectParam[]{
 const look=[p('opacity','Opacity',0,1,1,25),p('hue','Color',0,360,kind==='fire'?22:kind==='liquid'?195:185,24)];
 if(kind==='light')return [...look,p('lightX','Position X',0,1,.25,0,'Position'),p('lightY','Position Y',0,1,.15,1,'Position'),p('lightHeight','Depth',.05,1,.7,2,'Position'),p('targetX','Aim X',0,1,.55,32,'Beam'),p('targetY','Aim Y',0,1,.75,33,'Beam'),p('spread','Beam spread',5,175,80,34,'Beam'),p('softness','Softness',0,1,.35,35,'Beam'),p('lightPower','Intensity',0,3,1.5,3),p('haze','Haze',0,1,.55,4),p('shadow','Shadow strength',0,1,1,36),p('falloff','Falloff',0,6,2,37),p('ambient','Ambient fill',0,1,.05,38),p('turbulence','Haze texture',0,2,.45,26)];
 if(['architecture','garden','walls','ribbons','orbit','electric'].includes(kind))return [...look,p('energy','Energy',0,1,.6),p('trails','Trail length',0,1,.7),p('gravity','Gravity',-1,1,.25)];
 const emitter=[p('x','Emitter X',0,1,.5,16,'Emitter'),p('y','Emitter Y',0,1,kind==='fire'||kind==='smoke'?.8:.12,17,'Emitter'),p('radius','Emitter width',.005,.25,kind==='liquid'?.027:.06,18,'Emitter'),p('speed','Launch speed',0,1,kind==='liquid'?.2:.12,19,'Emitter'),p('direction','Direction',-180,180,kind==='fire'||kind==='smoke'?-90:90,39,'Emitter'),p('flow','Flow rate',0,1,.7,7,'Emitter'),p('period','Pulse interval (s)',.2,12,2,22,'Emitter'),p('duration','Burst duration (s)',.05,4,.4,23,'Emitter')];
 const physics=[p('gravity','Gravity',-1,1,.4),p('friction','Friction',0,1,.15,6,'Physics')];
 if(kind==='balls')return [...look,...emitter,...physics,p('size','Ball size',0,1,.4,9,'Physics'),p('bounce','Restitution',0,1,.72,5,'Physics'),p('lifetime','Lifetime (s)',1,40,8,27,'Physics')];
 if(kind==='liquid')return [...look,...emitter,...physics,p('viscosity','Viscosity',0,1,.25,8,'Fluid'),p('tension','Surface tension',0,1,.65,28,'Fluid'),p('size','Stream thickness',0,1,.7,9,'Fluid'),p('roughness','Roughness',0,1,.12,29,'Surface'),p('refraction','Refraction',0,1,.65,30,'Surface'),p('lifetime','Lifetime (s)',1,40,6,27,'Fluid')];
 if(kind==='cloud')return [...look,...emitter,p('size','Point size',0,1,.35,9),p('turbulence','Swirl',0,2,.6,26),p('lifetime','Lifetime (s)',1,40,15,27)];
 return [...look,...emitter,p('heat',kind==='fire'?'Flame height / heat':'Buoyancy',.1,3,1.1,31),p('turbulence','Turbulence',0,2,.7,26),p('lifetime','Dissipation (s)',.2,8,kind==='fire'?1.2:3,27),p('haze',kind==='fire'?'Smoke amount':'Density',0,1,.5,4)];
}
/** Longest name an effect can carry. */
export const EFFECT_NAME_LIMIT=40;
/** An effect's own name, tidied and capped; its style name when it has none. */
export function effectName(raw:unknown,kind:EffectKind):string{
 const name=typeof raw==='string'?raw.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,EFFECT_NAME_LIMIT).trim():'';
 return name||EFFECT_NAMES[kind];
}
/** One label per effect that tells it apart from the others: its name, or
 * the name with a number when two effects share it ("Fire 1", "Fire 2"). */
export function effectLabels(effects:Pick<InteractiveEffect,'id'|'kind'|'name'>[]):Map<string,string>{
 const names=effects.map(e=>effectName(e.name,e.kind)),count=new Map<string,number>();
 for(const name of names)count.set(name,(count.get(name)??0)+1);
 const used=new Set(names.filter(name=>count.get(name)===1)),next=new Map<string,number>(),labels=new Map<string,string>();
 effects.forEach((e,i)=>{
  const name=names[i];if(count.get(name)===1){labels.set(e.id,name);return;}
  let n=next.get(name)??1,label=`${name} ${n}`;while(used.has(label))label=`${name} ${++n}`;
  next.set(name,n+1);used.add(label);labels.set(e.id,label);
 });
 return labels;
}
export function makeEffect(kind:EffectKind,target='point'):InteractiveEffect{return{id:crypto.randomUUID(),kind,name:EFFECT_NAMES[kind],enabled:true,target,emission:'continuous',burst:0,params:Object.fromEntries(effectParams(kind).map(d=>[d.key,d.value])),mods:{}};}
/** Migrate once at the editor boundary. Legacy render descriptors retain their old path. */
export function editableEffects(scene:InteractiveScene):InteractiveEffect[]{
 if(scene.effects)return structuredClone(scene.effects);
 const first=makeEffect(scene.preset);first.params.hue=scene.hue;for(const key of ['energy','gravity','trails'])if(key in first.params)first.params[key]=scene[key as 'energy'];
 if(scene.matter)for(const d of effectParams(first.kind))if(d.key in scene.matter)first.params[d.key]=scene.matter[d.key as keyof typeof scene.matter];
 const material=({fire:'fire',smoke:'smoke',liquid:'liquid',cloud:'points'} as Record<string,string>)[first.kind];const matching=material?scene.surfaces.find(s=>s.material===material):undefined;if(matching)first.target=matching.id;
 const result=[first];for(const s of scene.surfaces){if(!s.material||s.material==='none'||s===matching)continue;const kind=s.material==='points'?'cloud':s.material;result.push(makeEffect(kind,s.id));}return result.slice(0,MAX_INTERACTIVE_EFFECTS);
}
export function validateEffects(raw:unknown,surfaceIds:Set<string>):InteractiveEffect[]{
 if(!Array.isArray(raw)||raw.length>MAX_INTERACTIVE_EFFECTS)throw Error('Use up to eight interactive effects.');const ids=new Set<string>();
 return raw.map((e:any)=>{if(!e||typeof e.id!=='string'||!/^[\w-]{1,100}$/.test(e.id)||ids.has(e.id)||!EFFECT_KINDS.includes(e.kind)||!['continuous','pulse','burst'].includes(e.emission))throw Error('Invalid interactive effect.');ids.add(e.id);const params:Record<string,number>={},mods:Record<string,ParamModulation>={};
  for(const d of effectParams(e.kind)){const v=e.params?.[d.key]??d.value;if(!Number.isFinite(v))throw Error('Invalid effect parameter.');params[d.key]=Math.max(d.min,Math.min(d.max,v));const m=e.mods?.[d.key];if(m){if(!MOD_SOURCES.includes(m.source)||['amount','speed','rangeMin','rangeMax'].some(k=>m[k]!==undefined&&!Number.isFinite(m[k])))throw Error('Invalid effect modulation.');mods[d.key]={source:m.source,amount:Math.max(0,Math.min(1,m.amount??.5)),speed:Math.max(.01,Math.min(20,m.speed??.15)),invert:!!m.invert,bpmSync:!!m.bpmSync,...(m.rangeMin!==undefined&&m.rangeMax!==undefined?{rangeMin:Math.max(0,Math.min(1,m.rangeMin)),rangeMax:Math.max(0,Math.min(1,m.rangeMax))}:{})};}}
  return{id:e.id,kind:e.kind,name:effectName(e.name,e.kind),enabled:e.enabled!==false,target:surfaceIds.has(e.target)?e.target:'point',emission:e.emission,burst:Number.isSafeInteger(e.burst)?Math.max(0,Math.min(1e6,e.burst)):0,params,mods,paramAuto:validateInteractiveAuto(e.paramAuto,e.kind)};
 });
}
export function effectScene(scene:InteractiveScene,e:InteractiveEffect):InteractiveScene{
 const material=({fire:'fire',smoke:'smoke',liquid:'liquid',cloud:'points'} as Record<string,SurfaceMaterial>)[e.kind]??'none';
 return {...scene,effects:undefined,preset:e.kind,energy:e.params.energy??scene.energy,gravity:e.params.gravity??scene.gravity,trails:e.params.trails??scene.trails,hue:e.params.hue??scene.hue,matter:{...scene.matter!,...e.params},surfaces:scene.surfaces.map(s=>({...s,material:s.id===e.target?material:'none'}))};
}
export function reorderEffects(effects:InteractiveEffect[],from:string,to:string){const next=[...effects],a=next.findIndex(e=>e.id===from),b=next.findIndex(e=>e.id===to);if(a<0||b<0||a===b)return effects;next.splice(b,0,next.splice(a,1)[0]);return next;}
/** Same normalized range/Depth/LFO semantics as shader Mod; portable evaluation
 * uses smoothed bands supplied by the host. Native evaluates during core replay. */
export function evaluateEffect(effect:InteractiveEffect,time:number,audio:Record<string,number>={},bpm=120):InteractiveEffect{
 const params={...effect.params};for(const d of effectParams(effect.kind)){const m=effect.mods[d.key];if(!m||m.source==='manual')continue;let signal=audio[m.source]??0;const phase=time*m.speed*(m.bpmSync?bpm/60:1);switch(m.source){case 'lfo-sine':signal=.5+.5*Math.sin(phase*Math.PI*2);break;case 'lfo-tri':signal=1-Math.abs((phase%1)*2-1);break;case 'lfo-saw':signal=phase%1;break;case 'lfo-square':signal=phase%1<.5?1:0;break;case 'beatPhase':signal=time*bpm/60%1;break;}
 signal=Math.max(0,Math.min(1,signal));const ranged=m.rangeMin!==undefined&&m.rangeMax!==undefined;if(!ranged&&!m.source.startsWith('lfo-')&&m.source!=='beatPhase')signal=.5+signal*.5;if(m.invert)signal=1-signal;params[d.key]=ranged?d.min+(m.rangeMin!+(m.rangeMax!-m.rangeMin!)*signal)*(d.max-d.min):Math.max(d.min,Math.min(d.max,params[d.key]+(signal-.5)*m.amount*(d.max-d.min)));}return {...effect,params};
}

/** Persist only supported, finite automation settings. Values use the param's units. */
export function validateInteractiveAuto(raw:unknown,kind:EffectKind):Record<string,AutoConfig>{
 const result:Record<string,AutoConfig>={};
 for(const d of effectParams(kind)){
  const a=(raw as Record<string,AutoConfig>|undefined)?.[d.key];if(!a)continue;
  if(['phase','speedHz','min','max','cycleBeats'].some(k=>(a as any)[k]!==undefined&&!Number.isFinite((a as any)[k]))||!['loop','pingpong'].includes(a.mode)||!['free','beat','crossfader','clip'].includes(a.timing??'free')||!KEYFRAME_EASINGS.some(e=>e.value===(a.easing??'linear')))throw Error('Invalid interactive Auto settings.');
  const clamp=(v:number)=>Math.max(d.min,Math.min(d.max,v));
  result[d.key]={phase:Math.max(0,Math.min(1,a.phase??0)),mode:a.mode,speedHz:Math.max(.001,Math.min(10,a.speedHz??.15)),min:clamp(a.min??d.min),max:clamp(a.max??d.max),playing:a.playing!==false,timing:a.timing??'free',cycleBeats:Math.max(.125,Math.min(256,a.cycleBeats??4)),easing:a.easing??'sine'};
 }
 return result;
}
/** Shared by the desktop Auto engine and mobile simulation; never re-seeds fields. */
export function advanceInteractiveAuto(scene:InteractiveScene,dt:number,beat:number,crossfader?:number):InteractiveScene{
 if(!Array.isArray(scene?.effects))return scene;
 let changed=false;
 const effects=scene.effects.map(e=>{
  if(!e||typeof e.params!=='object'||!e.params)return e;
  let params=e.params;
  for(const [key,a] of Object.entries(e.paramAuto??{})){
   if(!a||!a.playing)continue;
   a.phase=advanceAutoPhase(a,dt,beat,crossfader);
   const value=resolveAutoValue(a);
   if(value!==params[key]){if(params===e.params)params={...params};params[key]=value;changed=true;}
  }
  return params===e.params?e:{...e,params};
 });
 return changed?{...scene,effects}:scene;
}
/** Keyframes override modulation on a render copy, leaving saved Auto/Mod intact. */
export function applyInteractiveOverrides(scene:InteractiveScene,overrides:Record<string,number|boolean>):InteractiveScene{
 if(!Array.isArray(scene?.effects))return scene;
 let effects=scene.effects;
 for(const [key,value] of Object.entries(overrides)){
  const [prefix,id,param]=key.split(':');if(prefix!=='interactive'||!effects)continue;
  effects=effects.map(e=>{
   if(!e||e.id!==id)return e;if(param==='enabled')return {...e,enabled:!!value};
   const d=effectParams(e.kind).find(p=>p.key===param);if(!d||typeof value!=='number'||!Number.isFinite(value))return e;
   const mods={...e.mods},paramAuto={...e.paramAuto};delete mods[param];delete paramAuto[param];
   return {...e,mods,paramAuto,params:{...e.params,[param]:Math.max(d.min,Math.min(d.max,value))}};
  });
 }
 return effects===scene.effects?scene:{...scene,effects};
}
/** Merge authoring changes without rewinding Auto phases/values advanced by the engine. */
export function mergeInteractiveEdit(previous:InteractiveScene|undefined,next:InteractiveScene,live:InteractiveScene):InteractiveScene{
 if(!previous)return next;
 return {...next,effects:next.effects?.map(e=>{
  const before=previous.effects?.find(v=>v.id===e.id),current=live.effects?.find(v=>v.id===e.id);if(!before||!current)return e;
  const params={...e.params},paramAuto={...e.paramAuto};
  for(const [key,a] of Object.entries(paramAuto)){
   const old=before.paramAuto?.[key],running=current.paramAuto?.[key];
   if(old&&running&&JSON.stringify({...a,phase:0})===JSON.stringify({...old,phase:0})){
    paramAuto[key]={...a,phase:running.phase};if(e.params[key]===before.params[key])params[key]=current.params[key];
   }
  }
  return {...e,params,paramAuto};
 })};
}
/**
 * What the author made, without what the Auto engine advances: the phase of
 * every Auto and the value of each parameter a playing Auto is driving.
 * Two scenes with the same signature differ only by Auto playback, so a
 * change in it while the editor is open came from outside the editor
 * (undo, a preset, another project).
 */
export function interactiveEditSignature(scene: InteractiveScene): string {
 return JSON.stringify({...scene,effects:scene.effects?.map(e=>{
  const params={...e.params},paramAuto:Record<string,AutoConfig>={};
  for(const [key,a] of Object.entries(e.paramAuto??{})){paramAuto[key]={...a,phase:0};if(a.playing)delete params[key];}
  return {...e,params,paramAuto};
 })});
}
