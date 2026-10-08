import type {AudioUniforms} from '../standaloneAudio';
export const ghostMovements=["Silk Ribbons", "Deep Space", "Fractal Bloom", "Liquid Marble", "Orbital Jelly", "Prism Tunnel", "Cathedral Flight", "Nebula Nursery", "Glass Organism", "Alien Ocean", "Infinite Machinery", "Aurora Vault", "Magnetic Garden", "Mandel Orbit"];
/** Audio steers velocity and illumination, never resets phase or directly scales the whole scene. */
export class GhostFXMotion {
 private bass=0;private mid=0;private high=0;private level=0;private flow=.6;private clock=0;
 private weights:number[]=[];
 currentMovement=0;private requested=-1;private elapsed=0;private bag:number[]=[];
 constructor(private random:()=>number=Math.random){}

 update(audio:AudioUniforms,dt:number,movement:number,flow=.6,morph=2.5,reactivity=1,journey=false,journeySeconds=24){
  dt=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  const follow=(value:number,target:number)=>value+(Math.max(0,Math.min(1,Number.isFinite(target)?target:0))-value)*(1-Math.exp(-dt/(target>value?.24:.85)));
  this.bass=follow(this.bass,audio.audioBass);this.mid=follow(this.mid,audio.audioMid);this.high=follow(this.high,audio.audioHigh);this.level=follow(this.level,audio.audioLevel);
  this.flow+=(Math.max(0,Math.min(2,flow))-this.flow)*(1-Math.exp(-dt*2));this.clock+=dt*(.1+this.flow*.2)*(1+(this.bass*.3+this.mid*.12)*Math.max(0,Math.min(2,reactivity)));
  const request=Math.max(0,Math.min(ghostMovements.length-1,Math.round(movement)||0));
  if(request!==this.requested||!journey){this.currentMovement=request;this.elapsed=0;this.bag=[];this.requested=request;}
  if(journey){this.elapsed+=dt;if(this.elapsed>=Math.max(15,Math.min(90,journeySeconds))){this.elapsed=0;
   if(!this.bag.length){this.bag=ghostMovements.map((_,i)=>i).filter(i=>i!==this.currentMovement);for(let i=this.bag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}}
   this.currentMovement=this.bag.pop()!;
  }}
  const selected=this.currentMovement;
  if(!this.weights.length)this.weights=ghostMovements.map((_,i)=>i===selected?1:0);
  const blend=1-Math.exp(-dt*4/Math.max(.5,morph));
  this.weights=this.weights.map((v,i)=>v+((i===selected?1:0)-v)*blend);
  const inputs:Record<string,number>={_ghostClock:this.clock};this.weights.forEach((v,i)=>inputs['_ghost'+i]=v);
  return {inputs,audio:{...audio,audioBass:this.bass,audioMid:this.mid,audioHigh:this.high,audioLevel:this.level,audioBeat:0}};
 }
}
