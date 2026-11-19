/** Original console-inspired PCM. Pulse duty cycles, 16-level triangle and
 * clocked 15-bit shift-register noise; no game recordings or melodies. */
import { velocityGain, type SoundDef } from './kit';
export interface ChipSample { id:string; name:string; wave:'pulse'|'triangle'|'noise'; duty?:number; notes:number[]; step:number; decay:number; slide?:number; pitched:boolean }
export const CHIP_SAMPLES: ChipSample[] = [
 {id:'chip-pulse-quarter',name:'Pixel pulse',wave:'pulse',duty:.25,notes:[0],step:.5,decay:.7,pitched:true},
 {id:'chip-pulse-eighth',name:'Pixel thin',wave:'pulse',duty:.125,notes:[0],step:.4,decay:.6,pitched:true},
 {id:'chip-square',name:'Pixel square',wave:'pulse',duty:.5,notes:[0],step:.4,decay:.55,pitched:true},
 {id:'chip-triangle',name:'Pixel triangle',wave:'triangle',notes:[0],step:.6,decay:.8,pitched:true},
 {id:'chip-kick',name:'Pixel kick',wave:'triangle',notes:[-24],step:.18,decay:.045,slide:24,pitched:false},
 {id:'chip-snare',name:'Pixel snare',wave:'noise',notes:[0],step:.16,decay:.05,pitched:false},
 {id:'chip-hat',name:'Pixel hat',wave:'noise',notes:[18],step:.045,decay:.014,pitched:false},
 {id:'chip-open-hat',name:'Pixel open hat',wave:'noise',notes:[16],step:.22,decay:.065,pitched:false},
 {id:'chip-crash',name:'Pixel crash',wave:'noise',notes:[9],step:.55,decay:.16,pitched:false},
 {id:'chip-tom',name:'Pixel tom',wave:'triangle',notes:[-12],step:.18,decay:.06,slide:12,pitched:false},
 {id:'chip-zap',name:'Pixel zap',wave:'pulse',duty:.125,notes:[0],step:.22,decay:.09,slide:24,pitched:false},
 {id:'chip-jump',name:'Pixel jump',wave:'pulse',duty:.25,notes:[0],step:.22,decay:.12,slide:-12,pitched:false},
 {id:'chip-pickup',name:'Pixel pickup',wave:'pulse',duty:.25,notes:[0,7,12],step:.065,decay:.09,pitched:true},
 {id:'chip-shield',name:'Pixel shield',wave:'pulse',duty:.5,notes:[0,12,7,19],step:.055,decay:.08,pitched:true},
 {id:'chip-power',name:'Pixel power',wave:'pulse',duty:.25,notes:[0,4,7,12,16,19],step:.07,decay:.1,pitched:true},
 {id:'chip-teleport',name:'Pixel teleport',wave:'pulse',duty:.125,notes:[0,12,2,14,4,16,7,19],step:.035,decay:.045,pitched:true},
 {id:'chip-damage',name:'Pixel damage',wave:'noise',notes:[3,-2,-7,-12],step:.055,decay:.08,pitched:false},
 {id:'chip-explosion',name:'Pixel burst',wave:'noise',notes:[12,5,0,-7,-12],step:.07,decay:.12,pitched:false},
 {id:'chip-major-arp',name:'Pixel major arp',wave:'pulse',duty:.25,notes:[0,4,7,12,7,4,0,4,7,12,7,4],step:.035,decay:.07,pitched:true},
 {id:'chip-minor-arp',name:'Pixel minor arp',wave:'pulse',duty:.25,notes:[0,3,7,12,7,3,0,3,7,12,7,3],step:.035,decay:.07,pitched:true},
];
/** Deterministic mono PCM, also used by WAV export. Each shot is bounded and
 * fades at both ends; sample-and-hold runs at a fixed virtual console clock. */
export function renderChipSample(s:ChipSample, note=60, sr=48000): Float32Array<ArrayBuffer> {
 const duration=s.notes.length*s.step;
 const out=new Float32Array(Math.ceil(duration*sr));
 let phase=0,noisePhase=0,lfsr=0x4ace,held=0;
 for(let i=0;i<out.length;i++) {
  const t=i/sr, index=Math.min(s.notes.length-1,Math.floor(t/s.step)),local=t-index*s.step;
  const pitch=(s.pitched?note:60)+s.notes[index]+(s.slide??0)*Math.exp(-local/.045);
  const f=Math.min(sr*.2,440*2**((pitch-69)/12));
  phase=(phase+f/sr)%1;
  let v:number;
  if(s.wave==='noise') {
   noisePhase+=Math.min(sr*.45,f*12)/sr;
   if(noisePhase>=1){noisePhase-=1;const bit=(lfsr^(lfsr>>1))&1;lfsr=(lfsr>>1)|(bit<<14);held=(lfsr&1)?1:-1;}
   v=held;
  } else if(s.wave==='triangle') v=Math.round((1-4*Math.abs(phase-.5))*7.5)/7.5;
  else { const duty=s.duty??.25;v=(phase<duty?1:-1)-(2*duty-1);v/=2*Math.max(duty,1-duty); }
  const envelope=Math.min(1,local/.002)*Math.exp(-local/s.decay)*Math.min(1,(duration-t)/.008);
  out[i]=v*envelope*.55;
 }
 return out;
}
const caches=new WeakMap<BaseAudioContext,Map<string,AudioBuffer>>();
export const CHIP_SOUNDS: SoundDef[]=CHIP_SAMPLES.map(s=>({
 id:s.id,name:s.name,category:'chiptune',kind:s.pitched?'strike':'shot',pitched:s.pitched,
 blurb:`Original 8-bit ${s.wave} sound: ${s.name.toLowerCase()}.`,
 play(sc,note,velocity,time) {
  let cache=caches.get(sc.ctx);if(!cache){cache=new Map();caches.set(sc.ctx,cache);}
  const pitch=s.pitched?Math.max(0,Math.min(127,Math.round(note))):60;
  const key=`${s.id}:${pitch}`;
  let buffer=cache.get(key);
  if(!buffer){const pcm=renderChipSample(s,pitch,sc.ctx.sampleRate);buffer=sc.ctx.createBuffer(1,pcm.length,sc.ctx.sampleRate);buffer.copyToChannel(pcm,0);if(cache.size>=128)cache.delete(cache.keys().next().value!);cache.set(key,buffer);}
  const source=sc.ctx.createBufferSource(),gain=sc.ctx.createGain();source.buffer=buffer;
  gain.gain.setValueAtTime(velocityGain(velocity)*.7,time);source.connect(gain);gain.connect(sc.out);
  source.onended=()=>{source.disconnect();gain.disconnect();};source.start(time);
  let stopped=false;
  return {duration:buffer.duration,stop(at:number,fade=.008){if(stopped)return;stopped=true;const start=Math.max(time,at);gain.gain.cancelScheduledValues(start);gain.gain.setValueAtTime(velocityGain(velocity)*.7,start);gain.gain.linearRampToValueAtTime(0,start+Math.max(.002,fade));source.stop(start+Math.max(.002,fade));}};
 }
}));
