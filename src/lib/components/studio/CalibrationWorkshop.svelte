<script lang="ts">
 import {onMount,onDestroy,tick} from 'svelte';
 import {openAutoMapCamera,uprightTurn,mapSurface,type AutoMapCamera,type AutoMapProjector,type AutoMapResult} from '../../mobile/studio/autoMap';
 import {surfaceDepthQuality,homography,unitCorners,project,exportCalibration,grayPatternPlan,type Calibration,type UV,type Reference} from '../../mobile/studio/calibration';
 import {captureCalibrationReference,shareCalibrationPreparation} from '../../mobile/studio/captureToolkit';
 import {acquireNativeFeed} from '../../mobile/studio/nativeLive';
 export let onclose:()=>void;
 export let onsend:((json:string)=>void)|undefined=undefined;
 function sendDesktop(){try{const live=mapped.filter(m=>surfaces.some(s=>s.id===m.surfaceId));onsend?.(JSON.stringify({...exportCalibration(draft()),mappedSurfaces:live.map(({name,screenId,screenName,points,rmsPx})=>({name,screenId,screenName,points,rmsPx}))}));message=live.length?`Sent ${live.length} mapped surface${live.length===1?'':'s'}. On the desktop, choose Create layers.`:"Sent for desktop review; output geometry is not changed until applied there.";}catch(e){message=(e as Error).message;}}
 export let lidar=false;
 /** Runs the stripe capture against a paired desktop. Only set when paired. */
 export let automap:((camera:AutoMapCamera,progress:(text:string)=>void)=>Promise<AutoMapResult>)|undefined=undefined;
 /** Lets the paired desktop take photos through this phone while the preview is open. */
 export let remote:((camera:AutoMapCamera)=>()=>void)|undefined=undefined;
 let stopRemote:(()=>void)|undefined;
 /** The last stripe scan, kept so each outlined surface can be fitted on its own. */
 let scan:AutoMapProjector[]=[];
 type Mapped={surfaceId:string;name:string;screenId:string;screenName:string;points:UV[];rmsPx:number};
 let mapped:Mapped[]=[];
 /** Fit one outline against the scan: the projector that lights it best wins. */
 function mapOutline(outline:UV[]){let best:{projector:AutoMapProjector;points:UV[];rmsPx:number;agree:number}|undefined,why='';
  for(const projector of scan){try{const m=mapSurface(projector,outline);if(!best||m.agree>best.agree)best={projector,...m};}catch(e){why=e instanceof Error?e.message:'';}}
  if(!best)throw new Error(why||'This surface could not be mapped.');return best;}
 let framing=false,preview:HTMLVideoElement,autoCamera:(AutoMapCamera&{stop():void})|undefined;
 async function openAuto(){framing=true;message='Starting the camera…';const held=await uprightTurn();await tick();try{autoCamera=await openAutoMapCamera(preview,held.turn);stopRemote=remote?.(autoCamera);message='Frame every projector’s whole picture, then prop the phone so it cannot move.';}catch(e){framing=false;message=e instanceof Error?e.message:'The camera could not start.';}}
 function closeAuto(){stopRemote?.();stopRemote=undefined;autoCamera?.stop();autoCamera=undefined;framing=false;}
 async function startAuto(){
  if(!autoCamera||!automap)return;busy=true;
  try{
   const result=await automap(autoCamera,text=>message=text);
   reference=result.reference;surfaces=[];points=[];mode='surface';
   projectors=result.projectors.map(p=>({id:crypto.randomUUID(),name:p.name,width:p.width,height:p.height,corners:p.corners}));
   scan=result.projectors;mapped=[];
   message='Scan complete. Tap the corners of one flat surface (top left, top right, bottom right, bottom left), then Add surface. Repeat for each face.';
  }catch(e){message=e instanceof Error?e.message:'Auto map failed.';}
  finally{busy=false;closeAuto();}
 }
 onDestroy(closeAuto);
 let name='Stage calibration',reference:Reference|undefined,mode:'corners'|'surface'='corners',points:UV[]=[],surfaces:Calibration['surfaces']=[],projectors:Calibration['projectors']=[];
 let projectorName='Projector 1',width=1080,height=1920,message='',busy=false,saved:Calibration[]=[],photo:HTMLDivElement;
 const key='ghost-calibration-drafts-v1';
 onMount(()=>{try{saved=JSON.parse(localStorage.getItem(key)||'[]');}catch{message='Saved drafts could not be read.';}});
 async function importPhoto(e:Event){const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;busy=true;try{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();setReference({image:canvas.toDataURL('image/jpeg',.88),width:canvas.width,height:canvas.height});
 }catch{message='This photo could not be opened. Try a JPEG or PNG.';}finally{busy=false;}}
 function setReference(r:Reference){scan=[];mapped=[];reference=r;points=[];surfaces=[];projectors=[];mode='corners';message='Reference ready. Keep this photo fixed; each projector needs its own four matching corners.';}
 async function capture(){busy=true;let lease:Awaited<ReturnType<typeof acquireNativeFeed>>|undefined;try{lease=await acquireNativeFeed('depth');const deadline=performance.now()+10000;while(true){try{setReference(await captureCalibrationReference());break;}catch(e){if(performance.now()>deadline)throw e;await new Promise(resolve=>setTimeout(resolve,300));}}}catch(e){message=String(e instanceof Error?e.message:e);}finally{lease?.release();busy=false;}}
 function tap(e:PointerEvent){if(!reference||busy)return;const r=photo.getBoundingClientRect();const p={x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};if(mode==='corners'&&points.length===4)points=[];points=[...points,p];}
 function add(){try{if(mode==='corners'){homography(points,unitCorners);if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width>16384||height>16384)throw new Error('Enter a valid projector resolution.');projectors=[...projectors,{id:crypto.randomUUID(),name:projectorName,width,height,corners:points}];projectorName=`Projector ${projectors.length+1}`;mode='surface';}else{if(points.length<3)throw new Error('Tap at least three outline points.');const surface={id:crypto.randomUUID(),name:`Surface ${surfaces.length+1}`,points};
   if(scan.length){const fit=mapOutline(points);mapped=[...mapped,{surfaceId:surface.id,name:surface.name,screenId:fit.projector.id,screenName:fit.projector.name,points:fit.points,rmsPx:fit.rmsPx}];surfaces=[...surfaces,surface];points=[];message=`${surface.name} mapped on ${fit.projector.name} (fit ${fit.rmsPx.toFixed(1)} px, ${Math.round(fit.agree*100)}% of points agree). Add another face or send to desktop.`;return;}
   surfaces=[...surfaces,surface];}points=[];message='Added. Trace more surfaces or mark another projector.';}catch(e){message=(e as Error).message;}}
 function draft():Calibration{if(!reference)throw new Error('Add a reference photo first.');return{schema:'ghost-calibration',version:1,id:crypto.randomUUID(),name,created:new Date().toISOString(),status:'prepared',reference,surfaces,projectors};}
 function save(){try{const c=draft(),next=[c,...saved].slice(0,6);localStorage.setItem(key,JSON.stringify(next));saved=next;message='Draft saved on this device.';}catch{message='Could not save. Device storage may be full; export the package instead.';}}
 function load(c:Calibration){name=c.name;reference=c.reference;surfaces=c.surfaces;projectors=c.projectors;points=[];message='Draft loaded. Verify the physical setup has not moved.';}
 async function download(){try{const c=draft(),data={...exportCalibration(c),patternPlans:c.projectors.map(p=>({projectorId:p.id,steps:grayPatternPlan(p.width,p.height)}))},file=new File([JSON.stringify(data)],`${name.replace(/[^a-z0-9-]/gi,'-')}.ghostcal.json`,{type:'application/json'});
  if(await shareCalibrationPreparation(JSON.stringify(data))){/* Native Files / AirDrop share completed. */}else if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:name});}else{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}message='Preparation package exported. Desktop import and projector verification are still required.';
 }catch(e){message=(e as Error).message;}}
 function depthLabel(points:UV[]){if(!reference?.depth)return '';const q=surfaceDepthQuality(reference.depth,points);return q?` · depth ${Math.round(q.coverage*100)}% · plane deviation ${q.planeRmsMm===null?'unavailable':q.planeRmsMm.toFixed(0)+' mm'}`:' · invalid depth';}
 function outside(){try{return !!mapping&&surfaces.some(s=>s.points.some(v=>{const p=project(mapping!,v);return p.x<0||p.x>1||p.y<0||p.y>1;}));}catch{return true;}}
 $: mapping=(()=>{try{return projectors.length?homography(projectors[0].corners,unitCorners):null;}catch{return null;}})();
</script>
<section aria-label="Projector calibration workshop">
 <header><div><small>DESKTOP TOOLS · PREPARATION</small><h2>Calibration workshop</h2></div><button onclick={onclose} disabled={busy}>Back</button></header>
 <p>Capture the backdrop, trace its surfaces, then match each projector. Export the preparation or send it to a paired desktop for review. Output geometry changes only when you apply it there.</p>
 <div class="row"><label class="file">Take / import photo<input type="file" accept="image/*" capture="environment" onchange={importPhoto} disabled={busy}/></label><button onclick={capture} disabled={!lidar||busy}>Capture RGB + depth</button></div>
 {#if automap}<div class="row"><button class="primary" onclick={openAuto} disabled={busy||framing}>Auto map projectors</button></div>{/if}
 {#if framing}<div class="auto"><video bind:this={preview} playsinline muted></video>
  <p>The desktop will show stripe patterns on each open Screen, one projector at a time, for about a minute. Dim the room, keep people out of the beam, and do not touch the phone until it finishes.</p>
  <div class="row"><button class="primary" onclick={startAuto} disabled={busy||!autoCamera}>Start</button><button onclick={closeAuto} disabled={busy}>Cancel</button></div></div>{/if}
 {#if reference}<p class="note">Replacing the reference clears its geometry. Depth captures use the camera’s sensor orientation so photo, distances and coordinates stay aligned.</p>{/if}
 <label>Session name<input bind:value={name}/></label>
 {#if reference}
 <div class="photo" bind:this={photo} style:aspect-ratio={`${reference.width}/${reference.height}`} onpointerdown={tap} role="application" aria-label="Tap reference photo to place outline points" tabindex="0">
  <img src={reference.image} alt="Calibration reference" draggable="false"/>
  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
   {#each projectors as p}<polygon class="projector" points={p.corners.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   {#each surfaces as s}<polygon points={s.points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   <polyline points={points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>
   {#each points as p,i}<circle cx={p.x*1000} cy={p.y*1000} r="9"/><text x={p.x*1000+15} y={p.y*1000+10}>{i+1}</text>{/each}
  </svg>
 </div>
 <div class="row"><button class:active={mode==='corners'} onclick={()=>{mode='corners';points=[];}}>Projector corners</button><button class:active={mode==='surface'} onclick={()=>{mode='surface';points=[];}}>Trace surface</button><button onclick={()=>points=points.slice(0,-1)} disabled={!points.length}>Undo point</button></div>
 {#if mode==='corners'}<p>Tap the projected reference rectangle: <b>top left → top right → bottom right → bottom left</b>. These must be known projector corners, not arbitrary backdrop corners. Without a projector, save a draft and mark them later.</p><label>Projector name<input bind:value={projectorName}/></label><div class="row"><label>Width<input type="number" min="2" max="16384" bind:value={width}/></label><label>Height<input type="number" min="2" max="16384" bind:value={height}/></label></div>
 {:else}<p>Tap around one flat surface. Finish the outline below. Four-point calibration is valid only on the same plane as the reference rectangle; other depths need additional calibration.</p>{/if}
 <button class="primary" onclick={add} disabled={mode==='corners'?points.length!==4:points.length<3}>Add {mode==='corners'?'projector':'surface'}</button>
 {#each projectors as p}<div class="item"><span>{p.name} · {p.width} × {p.height}</span><button onclick={()=>projectors=projectors.filter(x=>x.id!==p.id)}>Remove</button></div>{/each}
 {#each surfaces as s}<div class="item"><span>{s.name} · {s.points.length} points{depthLabel(s.points)}</span><button onclick={()=>surfaces=surfaces.filter(x=>x.id!==s.id)}>Remove</button></div>{/each}
 {#if mapping&&surfaces.length}<p class="note">{outside()?'Some surface points fall outside projector 1. They are preserved in the export; verify coverage.':'Surface points fit inside projector 1’s reference.'}</p>{/if}
 <div class="row"><button onclick={save}>Save draft</button><button class="primary" onclick={download} disabled={!projectors.length||!surfaces.length}>Export preparation</button>{#if onsend}<button class="primary" onclick={sendDesktop} disabled={!projectors.length||!surfaces.length}>Send to desktop</button>{/if}</div>
 {/if}
 <p class="status" role="status">{busy&&!framing?'Capturing…':message}</p>
 <h3>Saved preparations</h3>{#each saved as c}<div class="item"><button onclick={()=>load(c)}>{c.name} · {new Date(c.created).toLocaleDateString()}</button><button onclick={()=>{try{const next=saved.filter(x=>x.id!==c.id);localStorage.setItem(key,JSON.stringify(next));saved=next;}catch{message='Could not remove saved draft.';}}}>Delete</button></div>{/each}
 <details><summary>What still needs a projector?</summary><p>Pixel correspondence, focus, alignment, overlap, brightness matching and bump recovery require physical verification. LiDAR measures the scene, not where projector pixels land. Packages include photo-space outlines, per-projector homographies, raw depth when captured, and an inverted Gray-code pattern plan for the future desktop presenter. Automatic capture, decoding and blending are not active yet.</p></details>
</section>
<style>
 .auto video{display:block;width:100%;max-height:46vh;object-fit:contain;background:#000;border-radius:5px}
 section{padding:18px;font:13px/1.5 system-ui;color:var(--ga-ink-0)}header,.row,.item{display:flex;align-items:center;gap:8px;justify-content:space-between}.row{flex-wrap:wrap;margin:12px 0}.row>*{flex:1;min-width:110px}header small{font-size:9px;letter-spacing:.12em;color:var(--ga-blue-200)}h2{font-size:20px;margin:4px 0}h3{font-size:13px}p,.note{color:var(--ga-ink-2)}button,.file,input{box-sizing:border-box;min-height:44px;border:1px solid var(--ga-line-3);border-radius:5px;background:var(--ga-slot);color:inherit;padding:10px;font:inherit}button{touch-action:manipulation}button:disabled{opacity:.4}label{display:block;font-size:11px}input{display:block;width:100%;margin-top:4px}.file{cursor:pointer;font-size:13px}.file input{width:100%;font-size:11px}.primary,.active{background:var(--ga-selection-bg);border-color:var(--ga-blue-300)}.photo{position:relative;width:100%;background:#000;touch-action:none;margin-top:12px;overflow:hidden}.photo img,.photo svg{position:absolute;width:100%;height:100%;inset:0;pointer-events:none}.photo img{object-fit:fill}polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2;vector-effect:non-scaling-stroke}.projector{stroke:#ffa45b;fill:#ffa45b15}polyline{fill:none;stroke:white;stroke-width:2;vector-effect:non-scaling-stroke}circle{fill:#ffa45b;stroke:#fff;stroke-width:2}text{fill:white;font-size:30px;font-weight:bold}.item{border-bottom:1px solid var(--ga-line-2);padding:8px 0}.item span{overflow-wrap:anywhere;min-width:0}.status{color:var(--ga-blue-200)}summary{min-height:44px;cursor:pointer;font-weight:bold}
</style>
