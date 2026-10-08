<script lang="ts">
 import {onDestroy} from 'svelte';
 import {paintHit} from '../../mobile/studio/mappingInteraction';
 import type {Surface} from '../../mobile/studio/model';
 import type {PaintConfig,PaintStroke,PaintSample} from '../../mobile/studio/paint';
 export let surfaces:Surface[];
 export let config:PaintConfig;
 export let beat:()=>number;
 export let onstroke:(stroke:PaintStroke)=>void;
 export let onfinish:()=>void;
 export let onlimit:()=>void;
 let node:HTMLDivElement;
 let pointer:number|null=null,stroke:PaintStroke|null=null,last:PaintSample|null=null;
 let cursor:{x:number;y:number}|null=null;
 let lastEvent:PointerEvent|null=null,timer:ReturnType<typeof setInterval>|undefined;
 let total=0;
 function sample(e:PointerEvent){
  if(!stroke)return;
  const r=node.getBoundingClientRect(),p={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
  cursor=p;const hit=paintHit(p,surfaces);if(!hit){last=null;return;}
  const next={...hit,beat:beat(),pressure:e.pointerType==='pen'?Math.max(.1,e.pressure):.6};
  const n=last?.surface===next.surface?Math.min(32,Math.max(1,Math.ceil(Math.hypot(next.u-last.u,next.v-last.v)/Math.max(.004,stroke.size*.22)))):1;
  if(total+n>10000){finish();onlimit();return;}
  for(let i=1;i<=n;i++){const t=i/n;stroke.samples.push(last?.surface===next.surface?{...next,u:last.u+(next.u-last.u)*t,v:last.v+(next.v-last.v)*t,beat:last.beat+(next.beat-last.beat)*t}:next);}
  total+=n;last=next;
 }
 function down(e:PointerEvent){
  if(pointer!==null||e.button!==0||!config.enabled)return;e.preventDefault();
  const rect=node.getBoundingClientRect();
  if(!paintHit({x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height},surfaces))return;
  total=config.strokes.reduce((n,s)=>n+s.samples.length,0);if(total>=10000){onlimit();return;}
  pointer=e.pointerId;node.setPointerCapture(pointer);lastEvent=e;
  stroke={id:crypto.randomUUID(),brush:config.brush,color:config.color,size:config.size,life:config.life,samples:[]};
  onstroke(stroke);sample(e);timer=setInterval(()=>{if(lastEvent)sample(lastEvent);},50);
 }
 function move(e:PointerEvent){if(pointer!==e.pointerId)return;e.preventDefault();lastEvent=e;sample(e);}
 function finish(){
  clearInterval(timer);const id=pointer;pointer=null;if(id!==null&&node?.hasPointerCapture(id))node.releasePointerCapture(id);
  const had=!!stroke;stroke=null;last=null;cursor=null;lastEvent=null;if(had)onfinish();
 }
 onDestroy(finish);
</script>
<div class="paint-pad" bind:this={node} role="application" aria-label="Paint on mapped screens" onpointerdown={down} onpointermove={move} onpointerup={finish} onpointercancel={finish} onlostpointercapture={()=>{if(pointer!==null)finish();}}>
 {#if cursor}<span class="brush-cursor" style:left={`${cursor.x*100}%`} style:top={`${cursor.y*100}%`} style:border-color={config.color}></span>{/if}
 <span class="paint-badge">{config.brush==='slime'?'HOLD TO POUR':'DRAW ON A SCREEN'}</span>
</div>
<style>
 .paint-pad{position:absolute;inset:0;z-index:8;touch-action:none;cursor:crosshair;user-select:none;-webkit-user-select:none}
 .brush-cursor{position:absolute;width:24px;height:24px;transform:translate(-50%,-50%);border:2px solid;border-radius:50%;box-shadow:0 0 0 1px #000;pointer-events:none}
 .paint-badge{position:absolute;bottom:7px;left:7px;padding:4px 6px;background:#080b11bb;border-radius:4px;color:#c4cedc;font-size:9px;letter-spacing:.08em;pointer-events:none}
</style>
