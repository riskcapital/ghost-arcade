<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import InteractiveStudio from './InteractiveStudio.svelte';
 import DesktopFeedWorkshop from './DesktopFeedWorkshop.svelte';
 import CalibrationWorkshop from './CalibrationWorkshop.svelte';
 import {runAutoMap,socketAutoMapLink,serveRemoteCapture} from '../../mobile/studio/autoMap';
 import FluxPad from './FluxPad.svelte';
 import FluxPanel from './FluxPanel.svelte';
 import {defaultFlux,type FluxState} from '../../mobile/studio/flux';
 import {createFluxLink} from '../../mobile/studio/fluxLink';
 import {captureCapabilities} from '../../mobile/studio/captureToolkit';
 import {DesktopSender} from '../../mobile/studio/desktopSender';
 import type {InteractiveScene,Interaction} from '../../mobile/studio/interactive';
 import {pairedSessionFor,recordPairedScene} from '../../mobile/studio/pairedSession';
 import {readPairedDraft,writePairedDraft} from '../../mobile/studio/pairedDraft';
 import {capabilitiesRequest,outputAspect,readDesktopCapabilities,type DesktopCapabilities} from '../../mobile/studio/desktopCapabilities';
 import {depthCaptureOffer,depthScanProgress,depthStatusText,readDepthCaptureStatus,readDepthScanRequest,type DepthScanRequest,type DepthScanStage} from '../../mobile/studio/depthScan';
 import type {DepthCapture} from '../../mobile/studio/depthCapture';
 import {defaultReliefWorld} from '../../scene3d/worldModel';
 export let socket:WebSocket;export let onclose:()=>void;
 /** A room scan the desktop asked for before this opened (MobileApp passes it on). */
 export let depthRequest:DepthScanRequest|null=null;
 let session=pairedSessionFor(socket);
 /** What the desktop says it can do; kept on the session so a reopened editor has it at once. */
 let capabilities:DesktopCapabilities|null=session.capabilities??null;
 /** Whether the desktop runs a 3D world on this phone's layer (studio_scene_status.world). */
 let desktopWorldOn:boolean|null=null;
 // ── Room scan requests from the desktop ──────────────────────────────────
 // One waits at a time. It is asked about (never acted on over the user's work), and a request
 // that arrives during a scan waits for the scan to end.
 let depthHere=false,depthStop:{requestId:string;text:string}|null=null;
 let askingDepth:DepthScanRequest|null=depthRequest,scanRequest:DepthScanRequest|null=null,calibrationBusy=false;
 const progress=(requestId:string,stage:DepthScanStage,pct?:number,message?:string)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(depthScanProgress(requestId,stage,pct,message)));};
 function depthAsked(request:DepthScanRequest){
  if(scanRequest?.requestId===request.requestId||askingDepth?.requestId===request.requestId)return;
  // The newest request wins; an older one still waiting is answered.
  if(askingDepth)progress(askingDepth.requestId,'cancelled',undefined,'A newer request replaced it.');
  askingDepth=request;
 }
 function acceptDepth(){if(!askingDepth||calibrationBusy)return;const request=askingDepth;askingDepth=null;scanRequest=request;if(page!=='calibration')select('calibration');}
 function declineDepth(){if(!askingDepth)return;progress(askingDepth.requestId,'cancelled',undefined,'Not now on the phone.');askingDepth=null;}
 /** Send a room scan and wait for the desktop's answer. */
 function sendDepth(capture:DepthCapture,id:string,later:(text:string)=>void=()=>{}):Promise<string>{
  return new Promise((resolve,reject)=>{
   if(socket.readyState!==WebSocket.OPEN)return reject(new Error('Desktop disconnected. Save the file, then on the desktop: Interactive Studio → 3D world → Real objects → Scan with the phone → Open a depth capture.'));
   const json=JSON.stringify(depthCaptureOffer(id,capture));
   if(json.length>(capabilities?.depthCapture?.maxBytes??8_000_000))return reject(new Error('The scan is too large to send. Save the file instead.'));
   let settled=false;
   // "received" answers the phone; the desktop's user may then take a while to say Use it or not,
   // and that later answer still shows in the status line.
   let timer:ReturnType<typeof setTimeout>;
   const stop=()=>{clearTimeout(timer);socket.removeEventListener('message',answer);};
   const done=(text:string,ok:boolean)=>{if(settled)return;settled=true;ok?resolve(text):reject(new Error(text));};
   const answer=(e:MessageEvent)=>{try{const m=JSON.parse(String(e.data));const st=readDepthCaptureStatus(m,id);if(!st)return;const text=depthStatusText(st.state,st.message);
    if(st.state==='received'){done(text,true);clearTimeout(timer);timer=setTimeout(stop,600000);return;}
    if(settled){status=text;later(text);}stop();done(text,st.state!=='error');}catch{}};
   timer=setTimeout(()=>{stop();done('The desktop did not answer. Update the desktop app, or save the file and open it there.',false);},20000);
   socket.addEventListener('message',answer);socket.send(json);
  });
 }
 /** The paired editor's draft on this phone: a reconnect or a restart opens it again (a world draft only with a world desktop). */
 const pairedDraft={read:()=>{try{return readPairedDraft(localStorage,!!capabilities?.world);}catch{return null;}},write:(scene:InteractiveScene)=>writePairedDraft(localStorage,scene)};
 /** The editor asked for the desktop's lists again (its show actions): take them without touching the status line. */
 let refreshing=false;
 function refreshDesktop(){if(socket.readyState===WebSocket.OPEN&&capabilitiesReady){refreshing=true;socket.send(JSON.stringify(capabilitiesRequest()));}}
 let nativeInteractive=session.native===true,capabilitiesReady=session.native!==null,socketOpen=socket.readyState===WebSocket.OPEN,disposed=false;
 let capabilityTimer:ReturnType<typeof setInterval>|undefined,capabilityFallback:ReturnType<typeof setTimeout>|undefined;
 function sceneChanged(scene:InteractiveScene,inputs:Interaction[],active:boolean,paused:boolean){
  session=recordPairedScene(socket,withWorld(scene),inputs,active,paused,nativeInteractive);
 }
 // A desktop with the world reads a scene without one as an old phone's (it keeps its own world),
 // so this phone always says: switched off is `enabled: false`.
 let worldless:{from:InteractiveScene;to:InteractiveScene}|null=null;
 function withWorld(scene:InteractiveScene):InteractiveScene{
  if(!capabilities?.world||scene.world)return scene;
  if(worldless?.from!==scene)worldless={from:scene,to:{...scene,world:{...defaultReliefWorld(),enabled:false}}};
  return worldless.to;
 }
 const sendWorld=(message:Record<string,unknown>)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
 let page='interactive',status=nativeInteractive?'Native interactive controls ready · desktop renders the scene.':'Checking desktop render capabilities…',lidar=false,dual=false;
 let calibrationTimer:ReturnType<typeof setTimeout>|undefined,requestId='';
 function sendCalibration(json:string){if(new TextEncoder().encode(json).length>8_000_000)throw Error('Package is too large for live transfer. Export it using Files / AirDrop.');if(socket.readyState!==WebSocket.OPEN)throw Error('Desktop disconnected.');requestId=crypto.randomUUID();socket.send(JSON.stringify({type:'studio_calibration_offer',requestId,json}));status='Waiting for desktop to accept the calibration…';clearTimeout(calibrationTimer);calibrationTimer=setTimeout(()=>status='No desktop confirmation. Update desktop or export the package instead.',8000);}
 const receive=(e:MessageEvent)=>{try{const m=JSON.parse(String(e.data));if(m.type==='studio_capabilities'&&refreshing){refreshing=false;capabilities=readDesktopCapabilities(m);session.capabilities=capabilities;}else if(m.type==='studio_capabilities'){capabilities=readDesktopCapabilities(m);session.capabilities=capabilities;nativeInteractive=m.nativeInteractive===true;capabilitiesReady=true;session.native=nativeInteractive;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);status=nativeInteractive?'Native interactive controls ready · desktop renders the scene.':'Video sending ready · choose a source below.';}if(m.type==='studio_calibration_status'&&m.requestId===requestId){clearTimeout(calibrationTimer);status=m.accepted?'Received · open Interactive Studio → Phone calibration on desktop to review.':String(m.error||'Calibration rejected.');}if(m.type==='studio_scene_status'){if(m.accepted===false)status=String(m.error||'The desktop could not use this scene.');if(m.world&&typeof m.world.on==='boolean')desktopWorldOn=m.world.on;}const request=readDepthScanRequest(m);if(request)depthAsked(request);
   // The desktop cancelled the scan it asked for, or gave up waiting: stop it here too.
   if(m.type==='studio_depth_capture_status'&&(m.state==='declined'||m.state==='error')){
    if(askingDepth?.requestId===m.requestId)askingDepth=null;
    if(scanRequest?.requestId===m.requestId)depthStop={requestId:m.requestId,text:m.state==='declined'?'Cancelled on the desktop.':String(m.message||'The desktop stopped waiting for the scan.')};
   }}catch{}};
 const sender=new DesktopSender(socket,s=>status=s);
 // Flux on the desktop's outputs: the same pad and controls as on the phone's own picture.
 let flux:FluxState=defaultFlux();
 const fluxLink=createFluxLink(socket);
 function fluxChanged(next:FluxState){flux=next;fluxLink.send(next);}
 function fluxOff(){fluxLink.stop();flux={...flux,active:false,latch:false};}
 function send(canvas:HTMLCanvasElement|null,kind:string){if(!canvas){sender.stop();status='Sending stopped.';}else void sender.start(canvas,kind).catch(()=>{});}
 function select(value:string){if(value===page)return;depthHere=false;if(page==='flux')fluxOff();sender.stop();page=value;status=nativeInteractive&&session.active?'Scene stays enabled while you use other tools. Return to Interactive to edit or stop it.':'Choose a source, then send it to desktop.';}
 function disconnected(){socketOpen=false;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);clearTimeout(calibrationTimer);sender.stop();status='Desktop disconnected. Output state is unknown; reconnect and check desktop before continuing.';}
 onMount(()=>{
  socket.addEventListener('message',receive);socket.addEventListener('close',disconnected);
  const probe=()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(capabilitiesRequest()));};probe();capabilityTimer=setInterval(probe,1000);
  capabilityFallback=setTimeout(()=>{if(!capabilitiesReady){capabilitiesReady=true;status='Desktop did not report native rendering support. Video sending is available.';}clearInterval(capabilityTimer);},3000);
  void captureCapabilities().then(c=>{if(!disposed){lidar=c.lidar;dual=c.dualCamera;}}).catch(()=>{});
 });
 onDestroy(()=>{disposed=true;clearInterval(capabilityTimer);clearTimeout(capabilityFallback);sender.stop();fluxLink.stop();clearTimeout(calibrationTimer);socket.removeEventListener('message',receive);socket.removeEventListener('close',disconnected);});
</script>
<div class="backdrop">
 <div class="paired-dialog" role="dialog" aria-modal="true" aria-label="Desktop Studio tools" tabindex="-1">
  {#if !socketOpen||(page==='interactive'&&!capabilitiesReady)}<header><strong>Desktop Studio</strong><button onclick={onclose}>Back to controls</button></header>{/if}
  <nav aria-label="Desktop Studio tools">{#each [['interactive','Interactive'],['flux','Flux'],['feeds','Camera / depth'],['calibration','Calibration']] as [id,label]}<button class:active={page===id} aria-pressed={page===id} disabled={!socketOpen} onclick={()=>select(id)}>{label}</button>{/each}</nav>
  <div class="paired-context">
   {#if askingDepth&&!calibrationBusy}
    <div class="depth-ask" role="alertdialog" aria-label="Room scan for Depth mode">
     <p><strong>The desktop asks for a room scan for Depth mode.</strong> {page==='calibration'?'A new scan replaces the auto-map results on this phone.':'Your Interactive scene stays as it is.'}</p>
     <div><button class="primary" onclick={acceptDepth}>Scan now</button><button onclick={declineDepth}>Not now</button></div>
    </div>
   {/if}
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
    {#if capabilitiesReady}{#key nativeInteractive}<InteractiveStudio handheld remoteOutput nativeOutput={nativeInteractive} referencePreview={nativeInteractive} desktop={nativeInteractive?capabilities:null} aspect={outputAspect(nativeInteractive?capabilities:null)} {desktopWorldOn} onworldaction={capabilities?.world?(what,point)=>sendWorld({type:'studio_world_action',what,point}):undefined} onview={capabilities?.world?view=>sendWorld({type:'studio_world_view',view}):undefined} onscanroom={capabilities?.depthCapture?()=>{scanRequest=null;select('calibration');depthHere=true;}:undefined} onrefreshdesktop={refreshDesktop} draftStore={nativeInteractive?pairedDraft:null} initialScene={session.scene} initialActive={session.active&&nativeInteractive} initialPaused={session.paused} onscene={sceneChanged} onoutput={c=>{if(!nativeInteractive)send(c,'interactive');}} {onclose}/>{/key}{/if}
   {:else if page==='flux'}<section class="flux-remote" aria-label="Flux on the desktop output">
     <div class="flux-surface"><p>{flux.active?'Playing on the desktop output':'Touch here to play Flux on the desktop output'}</p><FluxPad value={flux} onchange={fluxChanged}/></div>
     <FluxPanel value={flux} onchange={fluxChanged}/>
    </section>
   {:else if page==='feeds'}<DesktopFeedWorkshop {lidar} {dual} onsend={send} {onclose}/>
   {:else}<CalibrationWorkshop {lidar} {onclose} onsend={sendCalibration} automap={(camera,progress,options)=>runAutoMap(socketAutoMapLink(socket),camera,progress,options)} remote={camera=>serveRemoteCapture(socket,camera)}
     depthCapture={capabilities?.depthCapture??null} output={capabilities?.output??null} depthRequest={scanRequest} openDepth={depthHere} bind:busyScanning={calibrationBusy}
     ondepthsend={sendDepth} {depthStop} ondepthprogress={(id,stage,pct,message)=>{if(scanRequest?.requestId===id)progress(id,stage,pct,message);}} ondepthdone={()=>{scanRequest=null;}}/>{/if}
  </div>
 </div>
</div>
<style>
 .flux-remote{padding:14px 14px 20px}
 .depth-ask{margin:8px 12px;padding:10px 0 4px;border-bottom:1px solid var(--ga-line-2)}.depth-ask p{padding:0;margin:0 0 8px;font-size:13px;color:var(--ga-ink-1)}.depth-ask strong{color:var(--ga-ink-0)}.depth-ask div{display:flex;gap:8px}.depth-ask button{flex:1}.depth-ask .primary{background:var(--ga-act-bg);border-color:var(--ga-act-line);color:var(--ga-act-ink);font-weight:700}
 .flux-surface{position:relative;aspect-ratio:16/9;border:1px solid var(--ga-line-3);border-radius:10px;overflow:hidden;background:radial-gradient(circle at 50% 50%,var(--ga-blue-a16,#5278ff29),#000 70%);margin-bottom:14px}
 .flux-surface p{position:absolute;inset:auto 0 12px;margin:0;text-align:center;font-size:12px;color:var(--ga-ink-2);pointer-events:none}
 .backdrop{position:fixed;inset:0;height:100dvh;z-index:1000;background:#000c;padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));display:grid;place-items:center;box-sizing:border-box}
 .paired-dialog{display:flex;flex-direction:column;background:var(--ga-inspector-bg,#12161d);color:var(--ga-ink-0,#e5ecf5);border:1px solid var(--ga-blue-mute-600);border-radius:10px;width:min(1150px,100%);height:100%;min-height:0;overflow:hidden;box-sizing:border-box}
 header,nav{display:flex;flex:none;align-items:center;gap:8px;padding:8px 12px}header{justify-content:space-between}button{min-height:44px;padding:8px 12px;color:inherit;background:var(--ga-blue-mute-800);border:1px solid var(--ga-blue-mute-600);border-radius:5px;font:inherit;touch-action:manipulation}nav button{flex:1;min-width:0;font-size:12px}.active{background:var(--ga-blue-600);border-color:var(--ga-blue-200)}
 .paired-context{flex:none;max-height:32%;overflow:auto;overscroll-behavior:contain;border-bottom:1px solid var(--ga-blue-mute-600)}p{padding:0 12px;font:12px/1.5 system-ui;color:var(--ga-blue-200)}.connection-status{margin:0 0 4px}summary{box-sizing:border-box;min-height:44px;padding:11px 12px;font:12px/1.5 system-ui;cursor:pointer;color:#b9c9df}.note{font-size:12px;color:#a5b0bf}.preview-note{font-size:12px}
 .tool-content{flex:1;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain}.tool-content.interactive{overflow:hidden}
 button:focus-visible,summary:focus-visible{outline:2px solid var(--ga-blue-200);outline-offset:-2px}
 @media(max-height:500px){nav{padding:4px 8px}.connection-status{font-size:12px}.paired-context{max-height:28%}}
</style>
