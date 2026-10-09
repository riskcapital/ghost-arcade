<script lang="ts">
 /**
  * Flux controls. The XY surface itself is the program picture (FluxPad, laid over the monitor),
  * so everything here stays in view while the picture is played: Wet / dry, Energy, the modules.
  */
 import {FLUX_MODULES,FLUX_BLENDS,type FluxState} from '../../mobile/studio/flux';
 export let value:FluxState;
 export let onchange:(state:FluxState)=>void;
 const recipes=[{name:'Liquid prism',modules:['warp','prism']},{name:'Mirror maze',modules:['fold','echo']},{name:'Solar storm',modules:['solar','slice','warp']},{name:'All in',modules:FLUX_MODULES.map(m=>m.id)}];
 function patch(p:Partial<FluxState>){value={...value,...p};onchange(value);}
 function reset(){patch({active:false,latch:false});}
 function toggle(id:string){patch({modules:value.modules.includes(id)?value.modules.filter(m=>m!==id):[...value.modules,id]});}
</script>
<div class="flux" data-flux-panel>
 <div class="heading"><h1>Flux <i class:live={value.active&&value.modules.length>0}></i></h1><div class="heading-actions"><button class:active={value.latch} aria-label="Stay on after lifting your finger" aria-pressed={value.latch} onclick={()=>patch({latch:!value.latch,active:!value.latch})}>Stay on</button><button class="reset" onclick={reset}>Release FX</button></div></div>
 <label class="amount"><span>Wet / dry</span><input aria-label="Flux wet dry" type="range" min="0" max="1" step=".01" data-default=".8" value={value.mix} oninput={e=>patch({mix:Number(e.currentTarget.value)})}/><output>{Math.round(value.mix*100)}%</output></label>
 <div class="blends" role="group" aria-label="How Flux blends with the picture">{#each FLUX_BLENDS as name,i}<button class:active={(value.blend||0)===i} aria-pressed={(value.blend||0)===i} onclick={()=>patch({blend:i})}>{name}</button>{/each}</div>
 <label class="amount"><span>Energy</span><input aria-label="Flux Energy" type="range" min="0" max="1" step=".01" data-default="0" value={value.energy||0} oninput={e=>patch({energy:Number(e.currentTarget.value)})}/><output>{Math.round((value.energy||0)*100)}%</output></label>
 <div class="modules" role="group" aria-label="Flux modules">{#each FLUX_MODULES as m}<button class:active={value.modules.includes(m.id)} aria-label={`Flux ${m.name}: ${m.hint}`} aria-pressed={value.modules.includes(m.id)} title={m.hint} onclick={()=>toggle(m.id)}>{m.name}</button>{/each}</div>
 <div class="tools"><button class:active={value.beat} aria-pressed={value.beat} onclick={()=>patch({beat:!value.beat})}>Beat lock</button><select aria-label="Flux combination" value="" onchange={e=>{const r=recipes[Number(e.currentTarget.value)];if(r)patch({modules:[...r.modules]});e.currentTarget.value='';}}><option value="">Combinations</option>{#each recipes as r,i}<option value={i}>{r.name}</option>{/each}</select></div>
 <p>Play Flux on the picture above: across changes the character, up is more intense. {value.latch?'Stay on keeps your last position when you lift your finger.':'The effect plays only while you touch the picture.'}</p>
 <p>A second finger’s height, or Pencil pressure, adds Energy.</p>
</div>
<style>
 .heading-actions{display:flex;gap:8px;align-items:center}
 .blends{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 0 10px;padding-bottom:1px}.blends::-webkit-scrollbar{display:none}.blends button{flex:none;min-height:38px;padding:4px 12px;font-size:11px;letter-spacing:.02em}
 .heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}h1{margin:3px 0;font-size:23px;font-weight:600}i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ga-line-3);vertical-align:middle}i.live{background:var(--ga-green)}
 button,select{background:var(--ga-hardware-bg);border:1px solid var(--ga-line-2);border-radius:5px;color:var(--ga-ink-0);font:inherit;font-size:12px;min-height:44px;padding:4px 10px;touch-action:manipulation}.active{background:var(--ga-selection-bg);border-color:var(--ga-selection-line)}.reset{border-color:var(--ga-line-3)}.tools{display:flex;gap:6px;margin-bottom:8px}.tools select{flex:1;min-width:0}.modules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0}.modules button{padding:4px;min-height:44px}.amount{display:flex;align-items:center;gap:10px;font-size:12px;margin-top:4px}.amount span{width:58px;flex:none}.amount input{flex:1;min-width:0;height:44px;accent-color:var(--ga-slider-fill);touch-action:none}.amount output{width:34px;text-align:right}p{font-size:12px;color:var(--ga-ink-1);line-height:1.45;margin:5px 0}button:focus-visible,select:focus-visible{outline:2px solid var(--ga-focus);outline-offset:2px}@media(max-width:760px){.heading{margin-bottom:2px}h1{font-size:20px;margin:0}.amount{margin-top:0}p{font-size:12px}}
</style>
