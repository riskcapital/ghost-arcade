<script lang="ts">
 import {onDestroy} from 'svelte';
 import Icon from './StudioIcon.svelte';
 import type {OutputStatus} from '../../mobile/studio/externalOutput';
 import {darkOutputReasons,displaySize,nextSetupStep,type SetupStep} from '../../mobile/studio/outputSetup';
 import {canPickRoute,pickRoute,routeStatus} from '../../mobile/studio/nativeOutput';
 export let status:OutputStatus;
 export let enabled:boolean;
 export let blackout:boolean;
 export let master:number;
 /** The test pattern is on the output while the check step shows. */
 export let ontestpattern:(on:boolean)=>void;
 export let onenable:()=>void;
 export let onblackout:()=>void;
 export let onmaster:()=>void;
 export let onretry:()=>void;
 export let onwireless:()=>void;
 export let onpresent:()=>void;
 export let onmap:()=>void;
 export let onsettings:()=>void;
 export let ondone:()=>void;

 let step:SetupStep=nextSetupStep('connect',status.connected);
 /** The display went away during the setup. */
 let lost=false;
 let picking=false, noPicture=false;
 /** What happened in the AirPlay picker, when it needs explaining. */
 let pickNote:''|'nopicker'|'sound'='';
 let pickName='';
 let soundTimer:ReturnType<typeof setTimeout>|undefined;
 let pickButton:HTMLButtonElement;
 const picker=canPickRoute();

 $: {
  const next=nextSetupStep(step,status.connected);
  if(next!==step){
   if(next==='connect'){lost=true;noPicture=false;}
   else{lost=false;pickNote='';clearTimeout(soundTimer);}
   step=next;
  }
 }
 $: ontestpattern(step==='test');
 onDestroy(()=>{clearTimeout(soundTimer);ontestpattern(false);});

 async function choose(){
  picking=true;pickNote='';clearTimeout(soundTimer);
  try{
   const r=await pickRoute(pickButton);
   if(!r.shown){pickNote='nopicker';return;}
   // The display arrives as a connection. If AirPlay took only the sound, say how to send the picture.
   soundTimer=setTimeout(async()=>{
    if(status.connected)return;
    const route=await routeStatus();
    if(route.airplay&&!status.connected){pickName=route.name;pickNote='sound';}
   },8000);
  }catch{pickNote='nopicker';}
  finally{picking=false;}
 }
 function confirm(){step=nextSetupStep(step,status.connected,true);noPicture=false;}
 $: reasons=darkOutputReasons({enabled,blackout,master,state:status.state});
 $: size=displaySize(status.display);
</script>

<div class="wizard" data-output-wizard data-step={step}>
 <ol class="steps" aria-label="Setup steps">
  <li class:current={step==='connect'} class:passed={step!=='connect'}>Connect</li>
  <li class:current={step==='test'} class:passed={step==='done'}>Check</li>
  <li class:current={step==='done'}>Ready</li>
 </ol>

 {#if step==='connect'}
  <h2>Connect a projector</h2>
  <p>Plug in a cable or choose an AirPlay display. The picture goes up as soon as it connects.</p>
  {#if status.platform==='android'}
   <button class="primary ga-act" onclick={onwireless}><Icon name="airplay" size={18}/>Choose a wireless display</button>
  {:else if picker}
   <button class="primary ga-act" bind:this={pickButton} disabled={picking} onclick={choose} data-pick-airplay><Icon name="airplay" size={18}/>Choose an AirPlay display</button>
  {:else}
   <p class="how">Open Control Center, tap Screen Mirroring and choose your Apple TV or projector.</p>
  {/if}
  <div class="cable"><Icon name="cable" size={20}/><span><strong>Or use a cable</strong>Plug in an HDMI or USB-C adapter. Nothing to tap.</span></div>
  <p class="waiting" role="status"><span class="pulse" aria-hidden="true"></span>Looking for a display…</p>
  {#if lost}<p class="note">The display disconnected. Reconnect it and the picture comes back by itself.</p>{/if}
  {#if pickNote==='sound'}<p class="note">{pickName || 'The AirPlay display'} is playing sound only. Open Control Center, tap Screen Mirroring and choose it there to send the picture.</p>
  {:else if pickNote==='nopicker'}<p class="note">The AirPlay list did not open. Open Control Center, tap Screen Mirroring and choose your display.</p>{/if}
  {#if !status.native}<p class="note">Projector output needs the Ghost Arcade app on iPhone or iPad.</p>{/if}
  <button class="link" onclick={onsettings}>All output settings</button>

 {:else if step==='test'}
  <h2>Is the test pattern on the wall?</h2>
  <p class="display"><Icon name="output" size={16}/>{status.display?.name ?? 'External display'}{size ? ` · ${size}` : ''}</p>
  {#if status.state==='connecting'}<p class="waiting" role="status"><span class="pulse" aria-hidden="true"></span>Starting the picture…</p>
  {:else if status.state==='error' && status.message}<p class="note" role="status">{status.message}</p>{/if}
  <div class="actions">
   <button class="primary ga-act" onclick={confirm} data-pattern-yes><Icon name="check" size={18}/>Yes, I see it</button>
   <button onclick={()=>noPicture=!noPicture} aria-expanded={noPicture}>No picture</button>
  </div>
  {#if noPicture}
   <ul class="fixes">
    {#if reasons.includes('off')}<li><span>Projector output is switched off.</span><button onclick={onenable}>Turn it on</button></li>{/if}
    {#if reasons.includes('blackout')}<li><span>Blackout is on.</span><button onclick={onblackout}>Turn off Blackout</button></li>{/if}
    {#if reasons.includes('master')}<li><span>Master level is at zero.</span><button onclick={onmaster}>Set to full</button></li>{/if}
    <li><span>Check the projector is on and set to the right input (HDMI 1, HDMI 2…).</span></li>
    <li><span>Still dark? Start the picture again.</span><button onclick={onretry}>Start again</button></li>
   </ul>
  {/if}
  <button class="link" onclick={onsettings}>Picture sideways, mirrored or cut off? Picture settings</button>

 {:else}
  <h2>You're projecting</h2>
  <p>The projector now shows your mix. Next, fit a surface to the wall.</p>
  <div class="actions stack">
   <button class="primary ga-act" onclick={onmap}><Icon name="map" size={18}/>Map a surface</button>
   <button onclick={onpresent}>Present: dim this phone</button>
   <button onclick={ondone}>Done</button>
  </div>
 {/if}
</div>

<style>
 .wizard{display:grid;gap:12px;font:13px/1.45 system-ui,-apple-system,sans-serif;color:var(--ga-ink-0);}
 h2{margin:2px 0 0;font-size:18px;line-height:1.25;}
 p{margin:0;color:var(--ga-ink-1);}
 .steps{display:flex;gap:6px;margin:0;padding:0;list-style:none;}
 .steps li{flex:1;padding:6px 0 0;border-top:3px solid var(--ga-line-2);font-size:12px;color:var(--ga-ink-2);}
 .steps li.passed{border-color:var(--ga-coral-600);color:var(--ga-ink-1);}
 .steps li.current{border-color:var(--ga-coral-400);color:var(--ga-ink-0);font-weight:650;}
 button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 12px;font:600 13px/1.2 system-ui,-apple-system,sans-serif;color:inherit;border:1px solid var(--ga-line-2);border-radius:8px;background:var(--ga-hardware-bg);touch-action:manipulation;}
 button.primary{min-height:50px;font-size:15px;}
 button:disabled{opacity:.6;}
 .actions{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:8px;}
 .actions.stack{grid-template-columns:1fr;}
 .cable{--ga-icon-tone:var(--ga-tone-output);display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--ga-section-head-line,var(--ga-line-2));border-bottom:1px solid var(--ga-section-head-line,var(--ga-line-2));}
 .cable span{display:grid;gap:1px;color:var(--ga-ink-1);}
 .cable strong{color:var(--ga-ink-0);}
 .waiting{display:flex;align-items:center;gap:10px;font-size:12px;}
 .pulse{width:10px;height:10px;border-radius:50%;background:var(--ga-tone-output,#f2b45a);animation:pulse 1.4s ease-in-out infinite;}
 @keyframes pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
 @media (prefers-reduced-motion:reduce){.pulse{animation:none;opacity:.7}}
 .note,.how{padding:0 0 0 10px;border-left:3px solid #ffc570;color:var(--ga-ink-0);font-size:13px;}
 .how{border-left-color:var(--ga-tone-output,#f2b45a);}
 .display{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ga-ink-0);}
 .fixes{display:grid;gap:8px;margin:0;padding:0;list-style:none;}
 .fixes li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--ga-line-2);}
 .fixes li span{font-size:13px;color:var(--ga-ink-1);}
 .fixes li button{flex:none;}
 .link{justify-content:flex-start;border:0;background:none;padding:8px 0;color:var(--ga-ink-1);font-weight:500;text-align:left;text-decoration:underline;text-underline-offset:3px;}
</style>
