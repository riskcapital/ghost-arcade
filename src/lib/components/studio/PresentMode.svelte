<script lang="ts">
 import {onDestroy,onMount} from 'svelte';
 import type {OutputStatus} from '../../mobile/studio/externalOutput';
 import {displaySize} from '../../mobile/studio/outputSetup';
 import {presentMode} from '../../mobile/studio/nativeOutput';
 export let status:OutputStatus;
 export let blackout:boolean;
 export let onblackout:()=>void;
 export let onexit:()=>void;
 /** How long the exit button is held. A brush against the screen must not end a show. */
 const HOLD_MS=900;
 let holding=false, holdTimer:ReturnType<typeof setTimeout>|undefined;
 let root:HTMLDivElement;
 onMount(()=>{presentMode(true);root.focus({preventScroll:true});});
 onDestroy(()=>{clearTimeout(holdTimer);presentMode(false);});
 function press(e:PointerEvent){e.preventDefault();holding=true;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{holding=false;onexit();},HOLD_MS);}
 function release(){holding=false;clearTimeout(holdTimer);}
 // Keyboard and VoiceOver activate with a click that has no pointer press behind it.
 function click(e:MouseEvent){if(e.detail===0)onexit();}
 $: size=displaySize(status.display);
</script>
<div class="present" role="dialog" aria-modal="true" aria-label="Present mode" tabindex="-1" bind:this={root} data-present-mode>
 <p class="state" role="status">{#if status.connected && status.state==='live'}Projector live{size?` · ${size}`:''}{:else if status.connected}Projector connected · starting the picture{:else}Projector disconnected. The picture comes back when it reconnects.{/if}</p>
 <div class="controls">
  <button class:on={blackout} aria-pressed={blackout} onclick={onblackout}>{blackout?'Blackout on':'Blackout'}</button>
  <button class="exit" class:holding style:--hold={`${HOLD_MS}ms`} onpointerdown={press} onpointerup={release} onpointercancel={release} onpointerleave={release} onclick={click} oncontextmenu={e=>e.preventDefault()}>Hold to exit</button>
 </div>
</div>
<style>
 .present{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;justify-content:space-between;padding:max(24px,env(safe-area-inset-top)) 20px max(24px,env(safe-area-inset-bottom));background:#000;color:#4a4a4a;font:600 13px/1.4 system-ui,-apple-system,sans-serif;touch-action:none;-webkit-user-select:none;user-select:none;outline:none;}
 .state{margin:0;text-align:center;font-size:13px;color:#4a4a4a;}
 .controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:420px;width:100%;margin:0 auto;}
 button{position:relative;overflow:hidden;min-height:56px;border:1px solid #1d1d1d;border-radius:10px;background:#050505;color:#5a5a5a;font:inherit;font-size:14px;touch-action:none;-webkit-touch-callout:none;}
 button.on{border-color:#4a1f2a;color:#a35a6a;background:#120609;}
 .exit::after{content:'';position:absolute;left:0;bottom:0;height:3px;width:0;background:#3a3a3a;}
 .exit.holding::after{width:100%;transition:width var(--hold) linear;}
</style>
