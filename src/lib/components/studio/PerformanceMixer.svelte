<script lang="ts">
 import {TRANSITIONS,CROSSFADE_BLENDS,CROSSFADE_CURVES,normalizeCrossfade,type CrossfadeSettings} from '../../mobile/studio/crossfade';
 import TouchFader from './TouchFader.svelte';
 import type {Show,Layer} from '../../mobile/studio/model';
 export let show:Show;
 export let embedded=false;
 let deck=0;
 export let selectedLayer:number;
 export let onchange:(index:number,patch:Partial<Layer>)=>void;
 export let onmaster:(value:number)=>void;
 export let oncrossfadesettings:(value:CrossfadeSettings)=>void;
 $: crossfadeSettings=normalizeCrossfade(show.crossfadeSettings);
 let lastSelected=-1;
 $: if(selectedLayer!==lastSelected){lastSelected=selectedLayer;deck=selectedLayer>=4?1:0;}
 export let oncrossfade:(value:number)=>void;
 export let onselect:(index:number)=>void;
 export let oncontrols:(index:number)=>void;
 export let onclose:()=>void;
 export let onstart:()=>void;
 let startY:number|null=null;
 const name=(i:number)=>show.dualDeck?`${i<4?'A':'B'}${i%4+1}`:`L${i+1}`;
 function swipe(e:PointerEvent){if(startY!==null&&e.clientY-startY>45){startY=null;onclose();}}
</script>
<section class="mixer-tray" class:embedded aria-label="Performance mixer">
 <header onpointerdown={e=>{if(embedded||(e.target as HTMLElement).closest('button'))return;startY=e.clientY;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}} onpointerup={e=>{swipe(e);startY=null;}} onpointercancel={()=>startY=null}>{#if !embedded}<span class="grip"></span>{/if}<strong>MIXER</strong><span class="hint">{show.dualDeck?'A1 / B1 on top':'L1 on top'}</span><button class="source-link" onclick={()=>oncontrols(selectedLayer)} aria-label="Mixer source controls">Controls</button>{#if !embedded}<button onclick={onclose} aria-label="Close mixer">⌄</button>{/if}</header>
 {#if show.dualDeck}<div class="deck-select"><button class:active={deck===0} onclick={()=>deck=0}>Deck A · 4 layers</button><button class:active={deck===1} onclick={()=>deck=1}>Deck B · 4 layers</button></div>{/if}
 <div class="channels">
 {#each show.layers.slice(show.dualDeck?deck*4:0,show.dualDeck?deck*4+4:4) as layer,offset}{@const i=(show.dualDeck?deck*4:0)+offset}<section class="strip" class:selected={selectedLayer===i}>
 <button class="name" aria-label={`Select mixer ${name(i)}`} onclick={()=>onselect(i)}>{name(i)}<small>{Math.round(layer.opacity*100)}%</small></button>
 <TouchFader value={layer.opacity} label={`${name(i)} opacity`} {onstart} onchange={opacity=>onchange(i,{opacity})}/>
 <div class="switches"><button class:active={!layer.enabled} aria-label={`Mute ${name(i)}`} aria-pressed={!layer.enabled} onclick={()=>{onstart();onchange(i,{enabled:!layer.enabled});}}>M</button><button class:active={layer.solo} aria-label={`Solo ${name(i)}`} aria-pressed={!!layer.solo} onclick={()=>{onstart();onchange(i,{solo:!layer.solo});}}>S</button></div>
 <select aria-label={`${name(i)} blend`} value={layer.blend} onchange={e=>{onstart();onchange(i,{blend:e.currentTarget.value as Layer['blend']});}}>{#each ['normal','add','screen','multiply','difference'] as mode}<option value={mode}>{mode}</option>{/each}</select>

 </section>{/each}
 <section class="strip master"><span class="name">OUT<small>{Math.round(show.master*100)}%</small></span><TouchFader value={show.master} label="Master opacity" {onstart} onchange={onmaster}/><span class="master-label">Master</span></section>
 </div>
 {#if show.dualDeck}<div class="crossfade"><button onclick={()=>oncrossfade(0)} aria-label="Mixer cut to A">A</button><input aria-label="Mixer A/B crossfader" type="range" min="0" max="1" step=".001" value={show.crossfade} onpointerdown={onstart} oninput={e=>oncrossfade(Number(e.currentTarget.value))}/><button onclick={()=>oncrossfade(1)} aria-label="Mixer cut to B">B</button></div>{/if}
{#if show.dualDeck}<div class="crossfade-settings">
 <label>Crossfade FX<select aria-label="Crossfade FX" value={crossfadeSettings.transition} onchange={e=>{onstart();oncrossfadesettings({...crossfadeSettings,transition:e.currentTarget.value});}}>{#each TRANSITIONS as t}<option value={t.name}>{t.label}</option>{/each}</select></label>
 <label>Blend<select aria-label="Crossfade blend mode" value={crossfadeSettings.blend} onchange={e=>{onstart();oncrossfadesettings({...crossfadeSettings,blend:e.currentTarget.value});}}>{#each CROSSFADE_BLENDS as blend}<option value={blend}>{blend}</option>{/each}</select></label>
 <label>Curve<select aria-label="Crossfade curve" value={crossfadeSettings.curve} onchange={e=>{onstart();oncrossfadesettings({...crossfadeSettings,curve:e.currentTarget.value as CrossfadeSettings['curve']});}}>{#each CROSSFADE_CURVES as curve}<option value={curve}>{curve}</option>{/each}</select></label>
 </div>{/if}
</section>
<style>
 .crossfade-settings{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:6px;margin-top:8px}.crossfade-settings label{min-width:0;font-size:10px;color:var(--ga-ink-2)}

 .mixer-tray.embedded{position:relative;z-index:auto;inset:auto;width:100%;max-width:none;box-sizing:border-box;margin:6px 0 0;border-radius:7px;box-shadow:none;padding:0 8px 8px;animation:none}.embedded header{padding:10px 0}.embedded header .hint,.embedded .source-link{display:none}.deck-select{display:flex;gap:6px;margin:6px 0}.deck-select button{flex:1;font-size:11px}.embedded .channels{gap:4px}.embedded .strip{padding:3px}.embedded .name{flex-direction:column;justify-content:center;gap:2px}.embedded :global(.touch-fader){height:clamp(80px,10vh,105px)}

 .mixer-tray{position:fixed;z-index:60;bottom:0;left:0;right:0;max-width:940px;margin:auto;background:var(--ga-inspector-bg);border:1px solid var(--ga-line-3);border-radius:12px 12px 0 0;box-shadow:0 -15px 45px #000b;padding:0 max(14px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));animation:rise .16s ease-out}
 @keyframes rise{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}@media(prefers-reduced-motion:reduce){.mixer-tray{animation:none}}
 header{position:relative;display:flex;align-items:center;gap:12px;padding:18px 0 6px;touch-action:none}header strong{font-size:12px;letter-spacing:.06em}header .hint{font-size:11px;color:var(--ga-ink-2)}header button{margin-left:auto;min-width:44px}.grip{position:absolute;top:7px;left:calc(50% - 20px);width:40px;height:3px;border-radius:2px;background:var(--ga-line-3)}
 button,select{font:inherit;font-size:12px;color:var(--ga-ink-0);background:var(--ga-hardware-bg);border:1px solid var(--ga-line-2);border-radius:5px;min-height:40px;cursor:pointer;touch-action:manipulation}
 button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ga-focus);outline-offset:2px}.channels{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) minmax(50px,.8fr);gap:8px}.strip{min-width:0;padding:5px;border:1px solid var(--ga-line-2);border-radius:7px;background:var(--ga-faceplate-bg)}.strip.selected{border-color:var(--ga-coral-line)}.name{display:flex;width:100%;align-items:center;justify-content:space-between;min-height:38px;padding:0 4px;font-weight:650;font-size:13px}.name small{font-weight:500;color:var(--ga-ink-1);font-size:10px}.switches{display:flex;gap:3px}.switches button{flex:1;min-width:0}.active{background:var(--ga-selection-bg);border-color:var(--ga-selection-line)}select{width:100%;min-width:0;margin-top:5px;font-size:11px}select{background:var(--ga-slot)}.master-label{display:block;text-align:center;color:var(--ga-ink-2);font-size:11px;padding-top:12px}
 header .source-link{border:0;background:none;box-shadow:none;font-weight:700;min-width:72px;white-space:nowrap;padding:0 8px;}
 .crossfade{display:flex;gap:14px;align-items:center;margin-top:8px}.crossfade button{width:44px}.crossfade input{flex:1;min-width:0;height:44px;accent-color:var(--ga-slider-fill);touch-action:none}
 @media(max-width:600px){.mixer-tray{padding-left:max(8px,env(safe-area-inset-left));padding-right:max(8px,env(safe-area-inset-right))}.channels{gap:4px}.strip{padding:3px}.name{flex-direction:column;justify-content:center;gap:1px}.master .name{font-size:11px}.hint{display:none}}
.embedded header{padding:6px 0}.embedded .switches button,.embedded .strip select{min-height:30px}.embedded .deck-select button{min-height:34px}.embedded .name{min-height:30px}.embedded .crossfade-settings select{min-height:34px}.embedded .crossfade{margin-top:3px}.embedded .crossfade-settings{margin-top:3px}
 .mixer-tray.embedded{display:flex;flex-direction:column}.embedded .channels{flex:1;min-height:190px;align-items:stretch}.embedded .strip{display:flex;flex-direction:column}.embedded :global(.touch-fader){flex:1;min-height:80px;height:auto}.embedded header,.embedded .deck-select,.embedded .crossfade,.embedded .crossfade-settings{flex:none}
</style>
