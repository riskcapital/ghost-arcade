<script lang="ts">
 export let value=1;
 export let label='Level';
 export let onchange:(value:number)=>void;
 export let onstart:()=>void=()=>{};
 import {faderValue} from '../../mobile/studio/touchSliders';
 let active:number|null=null;
 // The level moves by the distance dragged from wherever the fader was touched. Touching the
 // thumb or the track never jumps the level to the finger.
 let grab={y:0,value:1,started:false};
 function down(e:PointerEvent){if(active!==null)return;e.preventDefault();active=e.pointerId;grab={y:e.clientY,value,started:false};(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}
 function move(e:PointerEvent){
  if(active!==e.pointerId)return;
  const dy=e.clientY-grab.y;
  // A 2 px dead zone keeps a resting finger from nudging the level; it is taken off the travel
  // so the level leaves its starting value smoothly.
  if(!grab.started){if(Math.abs(dy)<2)return;grab.started=true;grab.y+=Math.sign(dy)*2;onstart();}
  onchange(faderValue(grab.value,e.clientY-grab.y,(e.currentTarget as HTMLElement).getBoundingClientRect().height-24));
 }
 function up(e:PointerEvent){if(active===e.pointerId)active=null;}
 function key(e:KeyboardEvent){const delta=e.key==='ArrowUp'?.01:e.key==='ArrowDown'?-.01:e.key==='PageUp'?.1:e.key==='PageDown'?-.1:0;if(!delta&&!['Home','End'].includes(e.key))return;e.preventDefault();onstart();onchange(e.key==='Home'?0:e.key==='End'?1:Math.min(1,Math.max(0,value+delta)));}
</script>
<div class="touch-fader" class:dragging={active!==null} role="slider" tabindex="0" aria-label={label} aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(value*100)} aria-valuetext={`${Math.round(value*100)} percent`} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onlostpointercapture={()=>active=null} onkeydown={key}>
 <div class="rail"><div class="fill" style={`height:${value*100}%`}></div></div>
 <div class="handle" style={`bottom:calc(12px + (100% - 24px) * ${value})`}></div>
</div>
<style>
 .touch-fader{position:relative;height:clamp(110px,15dvh,170px);width:100%;min-width:48px;touch-action:none;user-select:none;cursor:ns-resize;outline-offset:0;border-radius:5px}
 .touch-fader:focus-visible{outline:2px solid var(--ga-focus)}.rail{position:absolute;top:12px;bottom:12px;left:calc(50% - 5px);width:10px;background:var(--ga-slot);box-shadow:inset 0 1px 4px #000;border-radius:3px;overflow:hidden}
 .rail:after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 calc(10% - 1px),var(--ga-line-3) calc(10% - 1px) 10%)}.fill{position:absolute;bottom:0;width:100%;background:var(--ga-slider-fill)}
 .handle{position:absolute;left:calc(50% - 20px);width:40px;height:24px;transform:translateY(50%);border:1px solid #000;border-radius:3px;background:linear-gradient(var(--ga-slider-fill),var(--ga-slider-fill)) center/24px 3px no-repeat,linear-gradient(#4c4943,#1b1916);box-shadow:inset 0 1px 0 #ffffff44,0 3px 5px #0009;pointer-events:none}.dragging .handle{box-shadow:0 0 0 2px var(--ga-selection-line),0 3px 8px #000}
</style>
