<script lang="ts">
 import ModTray,{modSourceLabel} from '../ModTray.svelte';
 import {DEFAULT_MOD,defaultModRange,type ParamModulation,type ModSource} from '../../audio/modulationControls';
 import type {AutoConfig} from '../../types';
 import type {EffectParam} from '../../mobile/studio/interactiveEffects';
 export let def:EffectParam;
 export let onstart:()=>void=()=>{};
 const paramId=crypto.randomUUID();
 export let value:number;
 export let auto:AutoConfig|undefined=undefined;
 export let onauto:(auto:AutoConfig|undefined)=>void=()=>{};
 export let onkeyframe:(()=>void)|undefined=undefined;
 export let supportsCrossfader=true;
 export let mod:ParamModulation|undefined=undefined;
 export let onchange:(value:number)=>void;
 export let onmod:(value:ParamModulation|undefined)=>void;
 let anchor:HTMLButtonElement,open=false;
 function source(s:ModSource){if(s==='auto'){onmod(undefined);onauto(auto??{phase:0,mode:'pingpong',speedHz:.15,min:def.min,max:def.max,playing:true,easing:'sine'});return;}onauto(undefined);onmod(s==='manual'?undefined:{...DEFAULT_MOD,speed:.15,...mod,...(!mod?defaultModRange(value,def.min,def.max):{}),source:s});}
 function manual(value:number){onchange(value);if(mod?.rangeMin!==undefined&&mod.rangeMax!==undefined){const unit=(value-def.min)/(def.max-def.min);onmod({...mod,rangeMin:Math.max(0,Math.min(1,unit)),rangeMax:Math.max(unit,mod.rangeMax)});}}
</script>
<div class="param">
 <div class="head"><label for={`param-${paramId}-${def.key}`}>{def.label}</label><output>{value.toFixed(def.step===1?0:2)}</output><button bind:this={anchor} class:assigned={!!auto||(!!mod&&mod.source!=='manual')} onclick={()=>open=!open} aria-label={`Modulate ${def.label}`}>{modSourceLabel(auto?'auto':mod?.source??'manual',!!auto)}</button>{#if onkeyframe}<button onclick={onkeyframe} title="Add keyframe at playhead" aria-label={`Keyframe ${def.label}`}>◇</button>{/if}</div>
 <input id={`param-${paramId}-${def.key}`} aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} {value} onpointerdown={onstart} onkeydown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)&&!e.repeat)onstart();}} oninput={e=>manual(+e.currentTarget.value)} />
{#if auto}<div class="auto-range"><label>From <input aria-label={`${def.label} Auto from`} type="number" onfocus={onstart} min={def.min} max={def.max} step={def.step} value={auto.min} onchange={e=>{const v=+e.currentTarget.value;if(Number.isFinite(v))onauto({...auto!,min:Math.max(def.min,Math.min(def.max,v))});}}/></label><label>To <input aria-label={`${def.label} Auto to`} type="number" onfocus={onstart} min={def.min} max={def.max} step={def.step} value={auto.max} onchange={e=>{const v=+e.currentTarget.value;if(Number.isFinite(v))onauto({...auto!,max:Math.max(def.min,Math.min(def.max,v))});}}/></label></div>{/if}
</div>
{#if open&&anchor}<ModTray onInteractionStart={onstart} label={def.label} {anchor} source={auto?'auto':mod?.source??'manual'} {mod} {auto} {supportsCrossfader} autoHint="Set From / To below the parameter to bound its sweep." supportsClipPosition={false} paramMin={def.min} paramMax={def.max} paramValue={value} onClose={()=>open=false} onSetSource={source} onPatchMod={p=>onmod({...DEFAULT_MOD,source:mod?.source??'lfo-sine',...mod,...p})} onPatchAuto={p=>{if(auto)onauto({...auto,...p});}}/>{/if}
<style>
 .auto-range{display:flex;gap:8px;font-size:10px;color:#a4bac9}.auto-range label{min-width:0;flex:1}.auto-range input{box-sizing:border-box;width:100%;height:28px;color:inherit;background:var(--ga-slot,#151c26);border:1px solid #3d4a5c;border-radius:3px;padding:4px}.param{margin:10px 0;min-width:0}.head{display:flex;gap:8px;align-items:center;min-width:0}.head label{flex:1;font-size:11px;line-height:1.3;overflow-wrap:anywhere}.head output{font:10px ui-monospace,monospace;color:var(--ga-ink-2,#a8b6c4)}button{font-size:10px;min-height:28px;padding:3px 8px;border:1px solid var(--ga-line-2,#394454);background:var(--ga-slot,#131820);color:inherit;border-radius:4px}.assigned{color:#91caff;border-color:#639aff}input{width:100%;height:32px;touch-action:none;accent-color:var(--ga-accent,#6988ed);cursor:ew-resize;margin:0}button:focus-visible,input:focus-visible{outline:2px solid #8abaff;outline-offset:2px}@media(pointer:coarse){input{height:44px}button{min-height:44px;min-width:44px}.auto-range input{height:44px}}
:global(.handheld) .head button{min-height:44px;min-width:44px}:global(.handheld) input{height:44px}:global(.handheld) .head label{font-size:13px}:global(.handheld) .head output{font-size:11px}:global(.handheld) .auto-range input{height:44px}</style>
