<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import InteractiveStudio from './InteractiveStudio.svelte';
 import DesktopFeedWorkshop from './DesktopFeedWorkshop.svelte';
 import CalibrationWorkshop from './CalibrationWorkshop.svelte';
 import {captureCapabilities} from '../../mobile/studio/captureToolkit';
 import {DesktopSender} from '../../mobile/studio/desktopSender';
 import type {InteractiveScene,Interaction} from '../../mobile/studio/interactive';
 import {pairedSessionFor,recordPairedScene} from '../../mobile/studio/pairedSession';
 export let socket:WebSocket;export let onclose:()=>void;
 let session=pairedSessionFor(socket);
 let nativeInteractive=session.native===true,capabilitiesReady=session.native!==null,socketOpen=socket.readyState===WebSocket.OPEN,disposed=false;
 let capabilityTimer:ReturnType<typeof setInterval>|undefined,capabilityFallback:ReturnType<typeof setTimeout>|undefined;
 function sceneChanged(scene:InteractiveScene,inputs:Interaction[],active:boolean,paused:boolean){
  session=recordPairedScene(socket,scene,inputs,active,paused,nativeInteractive);
 }
 let page='interactive',status=nativeInteractive?'Native interactive controls ready · desktop renders the scene.':'Checking desktop render capabilities…',lidar=false,dual=false;
 let calibrationTimer:ReturnType<typeof setTimeout>|undefined,requestId='';
 function sendCalibration(json:string){if(new TextEncoder().encode(json).length>8_000_000)throw Error('Package is too large for live transfer. Export it using Files / AirDrop.');if(socket.readyState!==WebSocket.OPEN)throw Error('Desktop disconnected.');requestId=crypto.randomUUID();socket.send(JSON.stringify({type:'studio_calibration_offer',requestId,json}));status='Waiting for desktop to accept the calibration…';clearTimeout(calibrationTimer);calibrationTimer=setTimeout(()=>status='No desktop confirmation. Update desktop or export the package instead.',8000);}
 const receive=(e:MessageEvent)=>{try{const m=JSON.parse(String(e.data));if(m.type==='studio_capabilities'){nativeInteractive=m.nativeInteractive===true;capabilitiesReady=true;session.native=nativeInteractive;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);status=nativeInteractive?'Native interactive controls ready · desktop renders the scene.':'Video sending ready · choose a source below.';}if(m.type==='studio_calibration_status'&&m.requestId===requestId){clearTimeout(calibrationTimer);status=m.accepted?'Received · open Interactive Studio → Phone calibration on desktop to review.':String(m.error||'Calibration rejected.');}if(m.type==='studio_scene_status'&&m.accepted===false)status=String(m.error||'The desktop could not use this scene.');}catch{}};
 const sender=new DesktopSender(socket,s=>status=s);
 function send(canvas:HTMLCanvasElement|null,kind:string){if(!canvas){sender.stop();status='Sending stopped.';}else void sender.start(canvas,kind).catch(()=>{});}
 function select(value:string){if(value===page)return;sender.stop();page=value;status=nativeInteractive&&session.active?'Scene stays enabled while you use other tools. Return to Interactive to edit or stop it.':'Choose a source, then send it to desktop.';}
 function disconnected(){socketOpen=false;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);clearTimeout(calibrationTimer);sender.stop();status='Desktop disconnected. Output state is unknown; reconnect and check desktop before continuing.';}
 onMount(()=>{
  socket.addEventListener('message',receive);socket.addEventListener('close',disconnected);
  const probe=()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'studio_capabilities_request'}));};probe();capabilityTimer=setInterval(probe,1000);
  capabilityFallback=setTimeout(()=>{if(!capabilitiesReady){capabilitiesReady=true;status='Desktop did not report native rendering support. Video sending is available.';}clearInterval(capabilityTimer);},3000);
  void captureCapabilities().then(c=>{if(!disposed){lidar=c.lidar;dual=c.dualCamera;}}).catch(()=>{});
 });
 onDestroy(()=>{disposed=true;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);sender.stop();clearTimeout(calibrationTimer);socket.removeEventListener('message',receive);socket.removeEventListener('close',disconnected);});
</script>
<div class="backdrop">
 <div class="paired-dialog" role="dialog" aria-modal="true" aria-label="Desktop Studio tools" tabindex="-1">
  {#if !socketOpen||(page==='interactive'&&!capabilitiesReady)}<header><strong>Desktop Studio</strong><button onclick={onclose}>Back to controls</button></header>{/if}
  <nav aria-label="Desktop Studio tools">{#each [['interactive','Interactive'],['feeds','Camera / depth'],['calibration','Calibration']] as [id,label]}<button class:active={page===id} aria-pressed={page===id} disabled={!socketOpen} onclick={()=>select(id)}>{label}</button>{/each}</nav>
  <div class="paired-context">
   <p class="connection-status" role="status">{status}</p>
   <details>
    <summary>{nativeInteractive&&page==='interactive'?'Local reference preview · Desktop output details':'Desktop output details'}</summary>
    {#if nativeInteractive&&page==='interactive'}<p class="preview-note">Desktop rendering and audio may differ. This local preview does not confirm desktop output.</p>{/if}
    <p class="note">{nativeInteractive?"Interactive scenes run on the desktop GPU and continue when you leave this editor. Use Stop in Interactive to stop the scene. Camera/depth video sends stop when you leave their tool.":"One video source at a time. On desktop, add it from Sources to a layer or VJ clip. Video sending stops when you leave this tool."}</p>
   </details>
  </div>
  <div class="tool-content" class:interactive={page==='interactive'}>
   {#if !socketOpen}<p role="alert">Reconnect from the desktop controls to resume editing.</p>
   {:else if page==='interactive'}
    {#if capabilitiesReady}{#key nativeInteractive}<InteractiveStudio handheld remoteOutput nativeOutput={nativeInteractive} referencePreview={nativeInteractive} initialScene={session.scene} initialActive={session.active&&nativeInteractive} initialPaused={session.paused} onscene={sceneChanged} onoutput={c=>{if(!nativeInteractive)send(c,'interactive');}} {onclose}/>{/key}{/if}
   {:else if page==='feeds'}<DesktopFeedWorkshop {lidar} {dual} onsend={send} {onclose}/>
   {:else}<CalibrationWorkshop {lidar} {onclose} onsend={sendCalibration}/>{/if}
  </div>
 </div>
</div>
<style>
 .backdrop{position:fixed;inset:0;height:100dvh;z-index:1000;background:#000c;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));display:grid;place-items:center;box-sizing:border-box}
 .paired-dialog{display:flex;flex-direction:column;background:var(--ga-inspector-bg,#12161d);color:var(--ga-ink-0,#e5ecf5);border:1px solid var(--ga-blue-mute-600);border-radius:10px;width:min(1150px,100%);height:100%;min-height:0;overflow:hidden;box-sizing:border-box}
 header,nav{display:flex;flex:none;align-items:center;gap:8px;padding:8px 12px}header{justify-content:space-between}button{min-height:44px;padding:8px 12px;color:inherit;background:var(--ga-blue-mute-800);border:1px solid var(--ga-blue-mute-600);border-radius:5px;font:inherit;touch-action:manipulation}nav button{flex:1;min-width:0;font-size:12px}.active{background:var(--ga-blue-600);border-color:var(--ga-blue-200)}
 .paired-context{flex:none;max-height:32%;overflow:auto;overscroll-behavior:contain;border-bottom:1px solid var(--ga-blue-mute-600)}p{padding:0 12px;font:12px/1.5 system-ui;color:var(--ga-blue-200)}.connection-status{margin:0 0 4px}summary{box-sizing:border-box;min-height:44px;padding:11px 12px;font:11px/1.5 system-ui;cursor:pointer;color:#b9c9df}.note{font-size:11px;color:#a5b0bf}.preview-note{font-size:11px}
 .tool-content{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain}.tool-content.interactive{overflow:hidden}
 button:focus-visible,summary:focus-visible{outline:2px solid var(--ga-blue-200);outline-offset:-2px}
 @media(max-height:500px){nav{padding:4px 8px}.connection-status{font-size:11px}.paired-context{max-height:28%}}
</style>
