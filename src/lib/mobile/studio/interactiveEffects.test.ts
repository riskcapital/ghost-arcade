import {describe,it,expect} from 'vitest';
import {defaultInteractive,validateScene} from './interactive';
import {makeEffect,effectParams,editableEffects,reorderEffects,evaluateEffect,advanceInteractiveAuto,applyInteractiveOverrides,mergeInteractiveEdit} from './interactiveEffects';
import {buildInteractiveGraph} from '../../renderer/nativeInteractiveGraph';
const audio={active:false,bass:0,mid:0,treble:0,energy:0,beatPhase:0,beatPulse:0,amplitude:0};
const graph=(effects:ReturnType<typeof makeEffect>[])=>buildInteractiveGraph({kind:'performer-world',sourceId:'stack',params:{interactiveScene:{...defaultInteractive(),effects}},width:640,height:360,time:1,frameDelta:1/60,frameIndex:1,audio}).config as any;
describe('Interactive Studio effect stack',()=>{
 it('migrates old materials, preserves settings, and round trips independent emitters',()=>{const s=defaultInteractive();s.surfaces[0].material='fire';const effects=editableEffects(s);expect(effects.map(e=>e.kind)).toEqual(['architecture','fire']);effects[1].emission='burst';effects[1].params.hue=290;const saved=validateScene({...s,effects});expect(saved.effects?.[1].params.hue).toBe(290);expect(saved.effects?.[1].target).toBe('stage');expect(saved.effects?.[1].emission).toBe('burst');});
 it('rejects duplicate ids and corrupt modulation; orphaned sources become reachable free emitters',()=>{const e=makeEffect('fire','gone');expect(validateScene({...defaultInteractive(),effects:[e]}).effects?.[0].target).toBe('point');expect(()=>validateScene({...defaultInteractive(),effects:[e,e]})).toThrow();e.mods.hue={source:'lfo-sine',amount:1,speed:Infinity,invert:false};expect(()=>validateScene({...defaultInteractive(),effects:[e]})).toThrow();});
 it('keeps simulations independent and changes composite ordering without changing ids',()=>{const a=makeEffect('fire'),b=makeEffect('liquid'),c=makeEffect('light');const g=graph([a,b,c]);expect(new Set(g.buffers.map((b:any)=>b.id)).size).toBe(g.buffers.length);expect(g.render_passes.filter((p:any)=>p.clear)).toHaveLength(1);expect(g.passes.some((p:any)=>p.entry==='cs_smooth_y')).toBe(true);const moved=reorderEffects([a,b,c],c.id,a.id);expect(moved.map(e=>e.id)).toEqual([c.id,a.id,b.id]);expect(graph(moved).render_passes[0].bindings.some((b:any)=>b.resource.includes(c.id))).toBe(true);});
 it('bypasses disabled effects and actually clears an empty stack',()=>{const e=makeEffect('fire');e.enabled=false;const g=graph([e]);expect(g.buffers.some((b:any)=>b.id.includes(e.id))).toBe(false);const u=g.buffers.find((b:any)=>b.id.endsWith(':uniform'));expect(new Float32Array(Uint8Array.from(atob(u.initial_b64),(c:string)=>c.charCodeAt(0)).buffer)[18]).toBe(0);});
 it('shares normalized modulation semantics while keeping saved slider values unchanged',()=>{const e=makeEffect('light');e.mods.lightX={source:'lfo-saw',speed:1,amount:1,invert:false,rangeMin:.2,rangeMax:.8};expect(evaluateEffect(e,.5).params.lightX).toBeCloseTo(.5);e.mods.lightX.invert=true;expect(evaluateEffect(e,.25).params.lightX).toBeCloseTo(.65);expect(e.params.lightX).toBe(.25);});
 it('keeps each material controls specific and includes complete light shaping',()=>{expect(effectParams('light').map(p=>p.key)).toEqual(expect.arrayContaining(['targetX','targetY','spread','softness','shadow','falloff','ambient']));expect(effectParams('liquid').some(p=>p.key==='refraction')).toBe(true);expect(effectParams('fire').some(p=>p.key==='heat')).toBe(true);});
});

describe('Interactive automation and presets',()=>{
 it('advances Auto, holds on pause, follows beats and crossfade, and validates saved curves',()=>{
  const e=makeEffect('light');e.paramAuto={lightPower:{phase:0,mode:'pingpong',speedHz:1,min:.3,max:2.3,playing:true,easing:'linear'}};
  let s=validateScene({...defaultInteractive(),effects:[e]});
  for(let i=0;i<5;i++)s=advanceInteractiveAuto(s,.1,0);
  expect(s.effects![0].params.lightPower).toBeCloseTo(2.3);
  s.effects![0].paramAuto!.lightPower.playing=false;const held=advanceInteractiveAuto(s,.1,0);expect(held.effects![0].params.lightPower).toBeCloseTo(2.3);
  Object.assign(s.effects![0].paramAuto!.lightPower,{playing:true,timing:'beat',cycleBeats:8});s=advanceInteractiveAuto(s,.01,2);expect(s.effects![0].params.lightPower).toBeCloseTo(1.3);
  s.effects![0].paramAuto!.lightPower.timing='crossfader';s=advanceInteractiveAuto(s,.01,0,.8);expect(s.effects![0].params.lightPower).toBeCloseTo(1.9);
  expect(validateScene(JSON.parse(JSON.stringify(s))).effects![0].paramAuto).toEqual(s.effects![0].paramAuto);
  s.effects![0].paramAuto!.lightPower.speedHz=NaN;expect(()=>validateScene(s)).toThrow();
 });
 it('lets keyframes win over Auto and audio without mutating saved assignments',()=>{
  const e=makeEffect('fire');e.mods.hue={source:'bass',amount:1,speed:1,invert:false};e.paramAuto={heat:{phase:0,mode:'loop',speedHz:1,min:.1,max:3,playing:true}};
  const s={...defaultInteractive(),effects:[e]},next=applyInteractiveOverrides(s,{[`interactive:${e.id}:hue`]:270,[`interactive:${e.id}:heat`]:1.8,[`interactive:${e.id}:enabled`]:false});
  expect(next.effects![0]).toMatchObject({enabled:false,params:{hue:270,heat:1.8},mods:{},paramAuto:{}});expect(e.mods.hue.source).toBe('bass');expect(e.paramAuto.heat.playing).toBe(true);expect(e.enabled).toBe(true);
 });
 it('edits another control without rewinding a running Auto sweep',()=>{
  const e=makeEffect('liquid');e.paramAuto={hue:{phase:.1,mode:'loop',speedHz:1,min:0,max:360,playing:true}};
  const before={...defaultInteractive(),effects:[e]},next=structuredClone(before),live=structuredClone(before);
  live.effects[0].paramAuto!.hue.phase=.8;live.effects[0].params.hue=288;next.effects[0].params.viscosity=.9;
  const merged=mergeInteractiveEdit(before,next,live);expect(merged.effects![0].paramAuto!.hue.phase).toBe(.8);expect(merged.effects![0].params).toMatchObject({viscosity:.9,hue:288});
 });
 it('round trips a portable scene including keyframes and rejects corrupt tracks',()=>{
  const e=makeEffect('light'),s={...defaultInteractive(),effects:[e],animation:{duration:20,loop:true,tracks:[{key:`interactive:${e.id}:lightX`,label:'Light X',type:'number' as const,keyframes:[{time:0,value:0,easing:'sine' as const},{time:20,value:1,easing:'linear' as const}],boolKeyframes:[]}]}};
  expect(validateScene(JSON.parse(JSON.stringify(s))).animation).toEqual(s.animation);s.animation.tracks[0].keyframes[0].value=NaN;expect(()=>validateScene(s)).toThrow();
 });
});
