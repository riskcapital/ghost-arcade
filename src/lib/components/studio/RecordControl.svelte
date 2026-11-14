<script lang="ts">
 import {onDestroy,tick} from 'svelte';
 import Icon from './StudioIcon.svelte';
 import {ProgramRecorder,isRecordingSupported,loadRecordingOptions,saveRecordingOptions,type CameraLayout,type RecordingOptions,type RecordingResult} from '../../mobile/studio/programRecorder';
 import {discardRecording,formatDuration,recordingSink,saveRecording,shareRecording} from '../../mobile/studio/recordingFiles';
 import {acquireCamera} from '../../mobile/studio/camera';
 /** The program canvas: what goes to the projector. */
 export let source:()=>HTMLCanvasElement|null;
 /** Hide the idle button (Map tab, full-screen preview). A running take always keeps its stop button. */
 export let hidden=false;
 export let onsuccess:(moment:'recording-saved'|'recording-shared')=>void=()=>{};

 type Phase='idle'|'options'|'starting'|'recording'|'finishing'|'result';
 let phase:Phase='idle';
 let options:RecordingOptions=loadRecordingOptions();
 let recorder:ProgramRecorder|null=null;
 let camera:{video:HTMLVideoElement;release:()=>void}|null=null;
 let elapsed=0, clock:ReturnType<typeof setInterval>|undefined;
 let result:RecordingResult|null=null;
 let error='', note='';
 let saved=false, shared=false, busy=false, confirmDelete=false;
 let optionsDialog:HTMLDialogElement, resultDialog:HTMLDialogElement, shareButton:HTMLButtonElement;
 const supported=isRecordingSupported();
 const markImage=typeof Image==='undefined'?null:Object.assign(new Image(),{src:'./icon-new.png'});
 const layouts:Array<[CameraLayout,string]>=[['off','Output only'],['side','Side by side'],['inset','Picture in picture']];

 async function openOptions(){error='';phase='options';await tick();optionsDialog?.showModal();}
 function closeOptions(){if(phase==='options')phase='idle';}

 async function openCamera(){
  const {stream,release}=await acquireCamera('environment');
  const video=document.createElement('video');
  video.muted=true;video.playsInline=true;video.srcObject=stream;
  await video.play().catch(()=>undefined);
  return {video,release:()=>{try{video.pause();video.srcObject=null;}catch{/* gone */}release();}};
 }

 async function start(){
  saveRecordingOptions(options);
  error='';note='';phase='starting';
  optionsDialog?.close();
  let cam:typeof camera=null;
  if(options.camera!=='off'){
   try{cam=await openCamera();}
   catch(e){note=`${e instanceof Error?e.message:'The camera did not open.'} This take records the output only.`;}
  }
  try{
   const take=new ProgramRecorder({
    source,camera:cam?.video??null,options:cam?options:{...options,camera:'off'},sink:recordingSink(),markImage,
    onstop:(reason,message)=>{
     if(reason==='limit')note='Recordings stop at 5 minutes.';
     else if(reason==='hidden')note='Recording stopped when Ghost Arcade left the screen.';
     else error=message??'The recording stopped.';
     void stop();
    },
   });
   recorder=take;
   await take.start();
   camera=cam;phase='recording';elapsed=0;
   clock=setInterval(()=>elapsed=take.elapsed(),250);
  }catch(e){
   cam?.release();recorder=null;phase='idle';
   error=e instanceof Error?e.message:'Recording could not start.';
   await openOptions();
  }
 }

 async function stop(){
  const take=recorder;
  if(!take||phase==='finishing')return;
  phase='finishing';clearInterval(clock);
  try{
   result=await take.stop();
   saved=false;shared=false;confirmDelete=false;phase='result';
   await tick();resultDialog?.showModal();
  }catch(e){
   error=e instanceof Error?e.message:'The recording could not be finished.';phase='idle';
   await openOptions();
  }finally{camera?.release();camera=null;recorder=null;}
 }

 async function save(){
  if(!result||busy)return;busy=true;error='';
  try{const where=await saveRecording(result);saved=true;if(where==='photos')onsuccess('recording-saved');}
  catch(e){error=e instanceof Error?e.message:'The video could not be saved.';}
  finally{busy=false;}
 }
 async function share(){
  if(!result||busy)return;busy=true;error='';
  try{if(await shareRecording(result,shareButton)){shared=true;onsuccess('recording-shared');}}
  catch(e){error=e instanceof Error?e.message:'The video could not be shared.';}
  finally{busy=false;}
 }
 /** Closing keeps nothing on the phone: a clip that was not saved or shared asks first. */
 function requestClose(){if(!saved&&!shared){confirmDelete=true;return;}finishResult();}
 function finishResult(){
  const done=result;result=null;phase='idle';confirmDelete=false;error='';
  if(resultDialog?.open)resultDialog.close();
  if(done)void discardRecording(done);
 }
 function megabytes(bytes:number){return bytes>=1e6?`${(bytes/1e6).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1e3))} KB`;}
 onDestroy(()=>{clearInterval(clock);if(recorder)void recorder.cancel();camera?.release();if(result)void discardRecording(result);});
</script>

{#if supported}
 {#if phase==='recording'||phase==='finishing'||phase==='starting'}
  <button class="rec-button live" data-record-stop disabled={phase!=='recording'} onclick={e=>{e.stopPropagation();void stop();}} aria-label={phase==='recording'?`Stop recording, ${formatDuration(elapsed*1000)}`:'Saving the recording'}>
   <span class="square" aria-hidden="true"></span>{phase==='recording'?formatDuration(elapsed*1000):phase==='starting'?'Starting…':'Saving…'}
  </button>
 {:else if !hidden}
  <button class="rec-button" data-record onclick={e=>{e.stopPropagation();void openOptions();}} aria-label="Record what the projector shows"><span class="dot" aria-hidden="true"></span><span class="rec-label">Rec</span></button>
 {/if}
{/if}

{#if phase==='options'}
 <dialog class="sheet" bind:this={optionsDialog} aria-label="Record" onclose={closeOptions} onclick={e=>{if(e.target===optionsDialog)optionsDialog.close();}}>
  <header><strong>Record</strong><button class="close" aria-label="Close" onclick={()=>optionsDialog.close()}><Icon name="close" size={18}/></button></header>
  <div class="body">
   <p>Records exactly what the projector shows, ready for Photos or a message.</p>
   <span class="label" id="record-camera">Camera of the wall</span>
   <div class="segmented" role="group" aria-labelledby="record-camera">
    {#each layouts as [value,name]}<button class:active={options.camera===value} aria-pressed={options.camera===value} onclick={()=>options={...options,camera:value}}>{name}</button>{/each}
   </div>
   {#if options.camera!=='off'}<p class="hint">Point the back camera at the wall while you record.</p>{/if}
   <label class="switch"><span><strong>Ghost Arcade mark</strong><small>A small name in the corner. Turn off for a clean video.</small></span><input type="checkbox" role="switch" checked={options.mark} onchange={e=>options={...options,mark:e.currentTarget.checked}} data-record-mark/></label>
   {#if error}<p class="error" role="alert">{error}</p>{/if}
   <button class="primary" onclick={start} data-record-start><span class="dot" aria-hidden="true"></span>Start recording</button>
  </div>
 </dialog>
{/if}

{#if phase==='result' && result}
 <dialog class="sheet" bind:this={resultDialog} aria-label="Your recording" oncancel={e=>{e.preventDefault();requestClose();}}>
  <header><strong>Your recording</strong><button class="close" aria-label="Close" onclick={requestClose}><Icon name="close" size={18}/></button></header>
  <div class="body">
   <!-- svelte-ignore a11y_media_has_caption -->
   <video src={result.url} controls playsinline muted loop preload="metadata" data-record-preview></video>
   <p class="meta" data-record-meta>{formatDuration(result.durationMs)} · {result.width} × {result.height} · {megabytes(result.bytes)}</p>
   {#if note}<p class="hint" role="status">{note}</p>{/if}
   {#if error}<p class="error" role="alert">{error}</p>{/if}
   {#if confirmDelete}
    <div class="confirm" role="alertdialog" aria-label="Delete this recording"><span>Delete this recording? It is not saved anywhere yet.</span><div class="pair"><button class="danger" onclick={finishResult} data-record-delete>Delete</button><button onclick={()=>confirmDelete=false}>Keep</button></div></div>
   {:else}
    <div class="pair">
     <button class="primary" disabled={busy||saved} onclick={save} data-record-save><Icon name={saved?'check':'save'} size={18}/>{saved?'Saved to Photos':'Save to Photos'}</button>
     <button bind:this={shareButton} disabled={busy} onclick={share} data-record-share><Icon name="upload" size={18}/>Share</button>
    </div>
    <button class="subtle" onclick={requestClose}>{saved||shared?'Done':'Delete'}</button>
   {/if}
  </div>
 </dialog>
{/if}

<style>
 .rec-button{position:absolute;top:8px;right:8px;z-index:5;display:flex;align-items:center;justify-content:center;gap:7px;min-width:44px;min-height:44px;padding:0 12px;border:1px solid #ffffff2e;border-radius:22px;background:#000000a6;color:#fff;font:650 13px/1 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);touch-action:manipulation;}
 .rec-button.live{background:#c8243fe6;border-color:#ff8fa3;font-variant-numeric:tabular-nums;}
 .rec-button:disabled{opacity:.85;}
 .dot{width:12px;height:12px;border-radius:50%;background:#ff4d6a;box-shadow:0 0 8px #ff4d6a99;flex:none;}
 .square{width:11px;height:11px;border-radius:2px;background:#fff;flex:none;}
 .rec-label{font-size:12px;letter-spacing:.04em;}
 .sheet{position:fixed;inset:0;margin:auto;width:min(440px,calc(100% - 24px));max-height:88dvh;padding:0;overflow:auto;border:1px solid var(--ga-line-3);border-radius:12px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;font:13px/1.45 system-ui,-apple-system,sans-serif;}
 .sheet::backdrop{background:#000b;}
 header{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 18px;border-bottom:1px solid var(--ga-line-2);}
 header strong{font-size:16px;}
 .body{display:grid;gap:12px;padding:16px 18px 18px;}
 p{margin:0;color:var(--ga-ink-1);}
 button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:8px 12px;font:600 13px/1.2 system-ui,-apple-system,sans-serif;color:inherit;border:1px solid var(--ga-line-2);border-radius:6px;background:var(--ga-hardware-bg);touch-action:manipulation;}
 button:disabled{opacity:.6;}
 .close{width:44px;padding:0;border:0;background:none;}
 .primary{min-height:48px;font-size:14px;border-color:var(--ga-selection-line);background:var(--ga-selection-bg);}
 .danger{border-color:#8a3346;background:#3b1720;}
 .subtle{border-color:transparent;background:none;color:var(--ga-ink-1);}
 .label{font-size:12px;font-weight:650;color:var(--ga-ink-1);}
 .segmented{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;}
 .segmented button{padding:6px 4px;font-size:12px;text-align:center;}
 .segmented button.active{border-color:var(--ga-selection-line);background:var(--ga-selection-bg);}
 .switch{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;}
 .switch span{display:grid;gap:2px;}
 .switch small{font-size:12px;color:var(--ga-ink-2);}
 .switch input{flex:none;width:24px;height:24px;accent-color:var(--ga-slider-fill);}
 .hint{font-size:12px;color:var(--ga-ink-2);}
 .error{color:#f3a6a6;font-size:13px;}
 video{width:100%;aspect-ratio:16/9;border-radius:6px;background:#000;}
 .meta{font-size:12px;color:var(--ga-ink-2);font-variant-numeric:tabular-nums;}
 .pair{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:8px;}
 .confirm{display:grid;gap:10px;padding:12px;border:1px solid var(--ga-line-2);border-radius:6px;background:var(--ga-slot);}
</style>
