<script lang="ts">
 import {onMount} from 'svelte';
 import Icon from './StudioIcon.svelte';
 import CalibrationWorkshop from './CalibrationWorkshop.svelte';
 import DesktopFeedWorkshop from './DesktopFeedWorkshop.svelte';
 import InteractiveStudio from './InteractiveStudio.svelte';
 export let mappingSurfaces:import('../../mobile/studio/model').Surface[]=[];
 export let oninteractive:(()=>void)|undefined=undefined;
 export let oninteractiveoutput:(canvas:HTMLCanvasElement|null)=>void=()=>{};
 let workshop=false,feedWorkshop=false,interactive=false;
 import {captureCapabilities,captureFileURL,listScans,openScanner,openDualCamera,shareScan,deleteScan,readScanBytes,type CaptureCapabilities,type SavedScan,type CameraShot} from '../../mobile/studio/captureToolkit';
 import {rememberedDesktopSocket} from '../../mobile/studio/companionLink';
 import {sendScan,type ScanSendProgress,type ScanSocket} from '../../mobile/studio/scanTransfer';
 import {canOpenAppSettings,mentionsSettings,openAppSettings} from '../../mobile/studio/nativeShare';
 export let oncompanion:()=>void=()=>{};
 export let onclose:()=>void;
 export let onprepare:()=>Promise<void>;
 export let onshots:(shots:CameraShot[])=>Promise<void>;
 let dialog:HTMLDialogElement;
 let capability:CaptureCapabilities|undefined;
 let scans:SavedScan[]=[];
 let busy=false, message='', removeId='';
 onMount(()=>{dialog.showModal();void load();});
 async function load(){try{capability=await captureCapabilities();if(capability.platform==='ios')scans=(await listScans()).scans;}catch(e){message=e instanceof Error?e.message:'Could not read capture tools.';}}
 async function open(mode:'scan'|'live'|'dual'){
  if(busy)return;busy=true;message='';
  try{await onprepare();if(mode==='dual'){const result=await openDualCamera();await onshots(result.shots??[]);if(result.shots?.length)message=`${result.shots.length} camera images added to the clip library.`;}else{await openScanner(mode);scans=(await listScans()).scans;}}
  catch(e){message=e instanceof Error?e.message:'Capture could not open.';}finally{busy=false;}
 }
 async function share(id:string){busy=true;message='';try{await shareScan(id);}catch(e){message=e instanceof Error?e.message:'Could not share scan.';}finally{busy=false;}}
 // Send to desktop: a short connection of its own to the desktop this device is paired with, so the
 // set on screen keeps running. An interrupted send keeps its request id and carries on from where
 // it stopped when sent again.
 let desktop=rememberedDesktopSocket();
 let sendingId='',sendLine='',sendPercent=0,stopSend:()=>void=()=>{};
 let sendNotes:Record<string,string>={};
 const sendIds:Record<string,string>={};
 function openDesktop(url:string):Promise<WebSocket>{
  return new Promise((resolve,reject)=>{
   let socket:WebSocket;
   try{socket=new WebSocket(url);}catch{reject(new Error('unreachable'));return;}
   const timer=setTimeout(()=>{try{socket.close();}catch{}reject(new Error('unreachable'));},6000);
   socket.onopen=()=>{clearTimeout(timer);resolve(socket);};
   socket.onerror=()=>{clearTimeout(timer);reject(new Error('unreachable'));};
  });
 }
 function sendProgress(p:ScanSendProgress){
  sendPercent=p.total?Math.round(p.sent/p.total*100):0;
  sendLine=p.phase==='checking'?'Checking the desktop…':p.phase==='waiting'?'Accept the scan on the desktop to start.':`Sending to desktop… ${sendPercent}%`;
 }
 async function sendToDesktop(scan:SavedScan){
  desktop=rememberedDesktopSocket();
  if(busy||sendingId||!desktop)return;
  busy=true;sendingId=scan.id;sendPercent=0;sendLine='Connecting to the desktop…';sendNotes={...sendNotes,[scan.id]:''};
  let socket:WebSocket|undefined,note='';
  try{
   const bytes=await readScanBytes(scan);
   try{socket=await openDesktop(desktop.url);}catch{throw new Error(`Could not reach the desktop at ${desktop.host}. Open Ghost Arcade there and keep both devices on the same Wi-Fi.`);}
   const job=sendScan({socket:socket as unknown as ScanSocket,bytes,name:scan.file||`${scan.name}.ply`,points:scan.points,voxelMm:scan.voxelMm,sizeM:scan.sizeM,preset:scan.preset,requestId:sendIds[scan.id],onProgress:sendProgress});
   sendIds[scan.id]=job.requestId;stopSend=job.abort;
   const outcome=await job.done;
   if(outcome.state==='saved'){delete sendIds[scan.id];note=`Saved on the desktop as ${outcome.name??'a new scan'}. Find it in the Media Library, Scan tab.`;}
   else if(outcome.state==='unsupported'){
    delete sendIds[scan.id];note=outcome.message;sendNotes={...sendNotes,[scan.id]:note};
    await shareScan(scan.id).catch(()=>{});
   }else{if(outcome.state!=='failed')delete sendIds[scan.id];note=outcome.message;}
  }catch(e){note=e instanceof Error?e.message:'Could not send the scan.';}
  finally{try{socket?.close();}catch{}stopSend=()=>{};sendingId='';sendLine='';busy=false;sendNotes={...sendNotes,[scan.id]:note};}
 }
 async function remove(id:string){busy=true;try{await deleteScan(id);scans=scans.filter(s=>s.id!==id);removeId='';}catch(e){message=e instanceof Error?e.message:'Could not delete scan.';}finally{busy=false;}}
</script>
<dialog class:interactive bind:this={dialog} aria-label="Capture toolkit" onclose={onclose} oncancel={e=>{if(busy||workshop||feedWorkshop||interactive)e.preventDefault();}} onclick={e=>{if(e.target===dialog&&!busy&&!workshop&&!feedWorkshop&&!interactive)dialog.close();}}>
 {#if interactive}<InteractiveStudio {mappingSurfaces} onoutput={oninteractiveoutput} onclose={()=>interactive=false}/>{:else if workshop}<CalibrationWorkshop lidar={capability?.lidar??false} onclose={()=>workshop=false}/>{:else if feedWorkshop}<DesktopFeedWorkshop lidar={capability?.lidar??false} dual={capability?.dualCamera??false} onclose={()=>feedWorkshop=false}/>{:else}
 <header><div><small>GHOST ARCADE</small><h2>Capture toolkit</h2></div><button aria-label="Close capture toolkit" disabled={busy} onclick={()=>dialog.close()}><Icon name="close"/></button></header>
 <div class="body">
  <p class="intro">Turn the world around you into material for your next set.</p>
  <div class="tools">
   <button class="tool" disabled={busy} onclick={async()=>{busy=true;try{if(oninteractive)oninteractive();else{await onprepare();interactive=true;}}catch(e){message=String(e);}finally{busy=false;}}}><Icon name="depth" size={28}/><span><strong>Interactive Studio</strong><small>Draw the space. Build light paths, gravity gardens and touch-triggered walls.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy} onclick={async()=>{busy=true;try{await onprepare();feedWorkshop=true;}catch(e){message=String(e);}finally{busy=false;}}}><Icon name="depth" size={28}/><span><strong>Feed studio</strong><small>Prepare rear, selfie, dual camera and depth visuals for desktop.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy} onclick={async()=>{busy=true;try{await onprepare();workshop=true;}catch(e){message=String(e);}finally{busy=false;}}}><Icon name="scan" size={28}/><span><strong>Projector calibration</strong><small>Capture a reference, trace surfaces and prepare a desktop calibration package.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy} onclick={async()=>{busy=true;try{await onprepare();onclose();oncompanion();}catch(e){message=e instanceof Error?e.message:"Could not prepare camera.";}finally{busy=false;}}}><Icon name="scan" size={28}/><span><strong>Desktop Connect</strong><small>Scan your desktop QR to control VJ decks and mapping.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy||!capability?.lidar} onclick={()=>open('scan')}><Icon name="scan" size={28}/><span><strong>LiDAR scan</strong><small>Walk around an object or space. Builds a clean, colored point cloud sized for the desktop Point Cloud layer.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy||!capability?.lidar} onclick={()=>open('live')}><Icon name="depth" size={28}/><span><strong>Depth playground</strong><small>Live depth, neon bands and dissolve. Freeze, orbit and save a moment in 3D.</small></span><Icon name="right" size={16}/></button>
   <button class="tool" disabled={busy||!capability?.dualCamera} onclick={()=>open('dual')}><Icon name="dualcam" size={28}/><span><strong>Dual camera</strong><small>Front and rear together. Split view or picture in picture, with still-pair capture.</small></span><Icon name="right" size={16}/></button>
  </div>
  {#if !capability}<p class="hint">Checking device support…</p>{:else if capability.platform!=='ios'}<p class="hint">These capture tools currently run in the installed iPhone/iPad app. LiDAR requires a supported Pro model.</p>{:else}{#if !capability.lidar}<p class="why" data-lidar-reason>LiDAR scan and Depth playground need a LiDAR sensor (iPhone Pro or iPad Pro). This device does not have one, so those two tools are switched off.</p>{/if}{#if !capability.dualCamera}<p class="why" data-dual-reason>Dual camera needs a device that can run the front and rear cameras at the same time. This one cannot.</p>{/if}<p class="hint">Opening a capture tool stops camera clips to free the cameras. Other clips remain loaded.</p>{/if}
  <p class="hint">For live mixing, add Rear camera, Front camera or Depth camera from an empty deck pad. Depth looks are under Controls. Front + rear work together; LiDAR can share its rear feed, but cannot run alongside the front camera.</p>
  {#if busy&&!sendingId}<p class="status" role="status">Capture tool active…</p>{/if}
  {#if message}<p class="status" role="status" data-toolkit-status><span>{message}</span>{#if mentionsSettings(message)&&canOpenAppSettings()}<button class="open-settings" data-open-settings onclick={()=>void openAppSettings()}>Open Settings</button>{/if}</p>{/if}
  <div class="section-title"><h3>Saved scans</h3><span>{scans.length}</span></div>
  {#if scans.length===0}<div class="empty"><Icon name="scan" size={32}/><strong>Your scans live here</strong><p>Save a scan or frozen depth frame, then share its PLY file to Files or AirDrop.</p></div>{/if}
  {#each scans as scan (scan.id)}<article>
   <div class="scan"><img src={captureFileURL(scan.thumbnail)} alt=""/><div><strong>{scan.name}</strong><small>{scan.points.toLocaleString()} points · {(scan.bytes/1_000_000).toFixed(1)} MB</small>{#if scan.sizeM&&scan.voxelMm}<small>{scan.sizeM.map(v=>v.toFixed(2)).join(' × ')} m · {scan.voxelMm.toFixed(0)} mm spacing</small>{/if}<small>{new Date(scan.created).toLocaleDateString()}</small></div></div>
   {#if removeId===scan.id}<p>Delete this saved scan from this device?</p><div class="actions"><button disabled={busy} onclick={()=>removeId=''}>Keep scan</button><button class="danger" disabled={busy} onclick={()=>remove(scan.id)}>Delete scan</button></div>{:else}<div class="actions">{#if desktop}<button class="send" data-scan-send disabled={busy} onclick={()=>sendToDesktop(scan)}>Send to desktop</button>{/if}<button disabled={busy} onclick={()=>share(scan.id)}><Icon name="upload" size={16}/>Share PLY</button><button class="subtle" disabled={busy} onclick={()=>removeId=scan.id}>Delete</button></div>{/if}
   {#if sendingId===scan.id}<div class="sending" role="status" data-scan-sending><span>{sendLine}</span><progress max="100" value={sendPercent}></progress><button onclick={()=>stopSend()}>Stop sending</button></div>{:else if sendNotes[scan.id]}<p class="send-note" role="status" data-scan-note>{sendNotes[scan.id]}</p>{/if}
  </article>{/each}
  <p class="hint">{desktop?'Send to desktop puts a scan in the desktop Media Library, Scan tab. Or share the file: on the ':'Pair with a desktop in Desktop Connect to send scans straight to it. Or share the file: on the '}desktop, add a Point Cloud layer and import the .ply file. Scans arrive upright, centered and cleaned, in real-world meters, facing the way you scanned them. Preview looks are not baked into the scan.</p>
  <details class="privacy"><summary>Privacy &amp; support</summary>
   <p>Ghost Arcade processes standalone visuals, camera and depth frames, and microphone analysis on your device. No Ghost Arcade account is needed to perform.</p>
   <p>Camera and microphone access are optional. You can change permissions in iOS Settings. Saved sets, imported media and scans stay in app storage until you export or share them. Exported copies are managed by the destination you choose.</p>
   <p>Desktop Connect sends pairing and control data to the desktop you choose. Camera streaming and external output send content to the connected destination when you enable those features.</p>
   <p>The mobile app does not include advertising or third-party analytics tracking. Apple handles App Store purchases and any diagnostics you choose to share with Apple.</p>
   <p><a href="https://ghostarcade.live/privacy" target="_blank" rel="noopener noreferrer">Website privacy policy</a> · <a href="mailto:hello@ghostarcade.live">Contact support</a></p>
  </details>
 </div>
 {/if}
</dialog>
<style>
 dialog.interactive{width:min(1150px,calc(100% - 16px));max-height:94dvh}
 .privacy{border-top:1px solid var(--ga-line-2);margin-top:20px;padding-top:14px;color:var(--ga-ink-1);font-size:12px;line-height:1.6}.privacy summary{min-height:44px;cursor:pointer;font-weight:650;color:var(--ga-ink-0)}.privacy a{color:var(--ga-blue-200)}

 dialog{position:fixed;inset:0;margin:auto;width:min(500px,calc(100% - 20px));max-height:90dvh;padding:0;overflow:auto;border:1px solid var(--ga-line-3);border-radius:12px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;font:13px/1.5 system-ui;box-sizing:border-box}dialog::backdrop{background:#000b}header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--ga-line-2)}header small{font-size:9px;letter-spacing:.16em;color:var(--ga-ink-2)}h2{margin:2px 0 0;font-size:20px;font-weight:650}button{font:inherit;color:inherit;min-height:44px;border:1px solid var(--ga-line-2);border-radius:5px;background:var(--ga-hardware-bg);padding:10px;touch-action:manipulation}button:disabled{opacity:.45}header button{width:44px;display:grid;place-items:center}.body{padding:18px}.intro{color:var(--ga-ink-1);margin:0 0 16px}.tools{display:grid;gap:8px}.tool{display:flex;gap:14px;align-items:center;text-align:left;width:100%;padding:16px 12px;background:var(--ga-slot);border-color:var(--ga-line-3)}.tool:active:not(:disabled){background:var(--ga-selection-bg);border-color:var(--ga-selection-line)}.tool>:global(svg){flex:none;color:var(--ga-blue-200)}.tool span{flex:1;min-width:0}.tool strong{font-size:14px;font-weight:650}.tool small{display:block;font-size:11px;line-height:1.55;color:var(--ga-ink-2);margin-top:3px}.hint{font-size:11px;color:var(--ga-ink-2);line-height:1.6}.why{margin:14px 0 6px;font-size:14px;line-height:1.45;color:var(--ga-ink-0)}.status{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}.status span{flex:1 1 180px;min-width:0}.open-settings{min-height:44px;padding:0 14px;font-weight:650;background:var(--ga-selection-bg);border-color:var(--ga-selection-line);color:var(--ga-selection-ink)}.section-title{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--ga-line-2);margin-top:20px;padding-top:14px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:600}.section-title span{font:12px ui-monospace;color:var(--ga-ink-2)}.empty{display:flex;align-items:center;flex-direction:column;text-align:center;padding:22px;border:1px dashed var(--ga-line-3);border-radius:6px;color:var(--ga-ink-2)}.empty strong{margin-top:12px;color:var(--ga-ink-1)}.empty p{font-size:12px;margin-bottom:0}.status{padding:10px;border:1px solid var(--ga-selection-line);background:var(--ga-selection-bg);border-radius:5px;position:sticky;bottom:10px;z-index:2;box-shadow:0 6px 24px #000a}.scan{display:flex;gap:12px;align-items:center}.scan img{width:70px;height:70px;border-radius:4px;object-fit:cover;background:black}.scan>div{min-width:0}.scan strong{display:block;overflow-wrap:anywhere}.scan small{display:block;color:var(--ga-ink-2);font-size:11px}article{padding:12px;background:var(--ga-slot);border:1px solid var(--ga-line-2);border-radius:6px;margin-bottom:8px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.actions .send{flex-basis:100%;border-color:var(--ga-selection-line);background:var(--ga-selection-bg)}.sending{display:grid;gap:8px;margin-top:10px;font-size:12px;color:var(--ga-ink-1)}.sending progress{width:100%;height:6px;accent-color:var(--ga-selection-line)}.send-note{margin:10px 0 0;font-size:12px;color:var(--ga-ink-1);overflow-wrap:anywhere}.actions button{display:flex;gap:8px;align-items:center;justify-content:center;flex:1}.subtle{color:var(--ga-ink-2)}.danger{color:#ffb0b0}
</style>
