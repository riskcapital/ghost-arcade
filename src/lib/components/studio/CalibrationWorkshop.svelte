<script lang="ts">
 import {onMount,onDestroy,tick} from 'svelte';
 import {detectSurfaces} from '../../mobile/studio/surfaceDetect';
 import {findPainting,paintingSize,rectifyPainting,clockwiseFromTopLeft} from '../../mobile/studio/painting';
 import {openAutoMapCamera,uprightTurn,mapSurface,type AutoMapCamera,type AutoMapProjector,type AutoMapResult} from '../../mobile/studio/autoMap';
 import {surfaceDepthQuality,homography,unitCorners,project,exportCalibration,grayPatternPlan,type Calibration,type UV,type Reference} from '../../mobile/studio/calibration';
 import {captureCalibrationReference,shareCalibrationPreparation} from '../../mobile/studio/captureToolkit';
 import {acquireNativeFeed} from '../../mobile/studio/nativeLive';
 export let onclose:()=>void;
 export let onsend:((json:string)=>void)|undefined=undefined;
 function sendDesktop(){try{const live=mapped.filter(m=>!skipped.has(m.surfaceId)&&surfaces.some(s=>s.id===m.surfaceId));const c=draft();let base:Record<string,unknown>;try{base=exportCalibration(c);}catch(e){if(!live.length)throw e;base={...c};}onsend?.(JSON.stringify({...base,mappedSurfaces:live.map(({name,screenId,screenName,points,rmsPx})=>({name,screenId,screenName,points,rmsPx}))}));message=live.length?`Sent ${live.length} mapped surface${live.length===1?'':'s'}. On the desktop, choose Create layers.`:"Sent for desktop review; output geometry is not changed until applied there.";}catch(e){message=(e as Error).message;}}
 export let lidar=false;
 /** Runs the stripe capture against a paired desktop. Only set when paired. */
 export let automap:((camera:AutoMapCamera,progress:(text:string,fraction?:number)=>void)=>Promise<AutoMapResult>)|undefined=undefined;
 let fraction=0,found:HTMLDivElement;
 /** Lets the paired desktop take photos through this phone while the preview is open. */
 export let remote:((camera:AutoMapCamera)=>()=>void)|undefined=undefined;
 let stopRemote:(()=>void)|undefined;
 /** The last stripe scan, kept so each outlined surface can be fitted on its own. */
 let scan:AutoMapProjector[]=[];
 type Mapped={surfaceId:string;name:string;screenId:string;screenName:string;points:UV[];rmsPx:number};
 let mapped:Mapped[]=[];
 /** Found surfaces the user has switched off: kept on the photo, not sent. */
 let skipped=new Set<string>();
 function inside(points:UV[],p:UV){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
 /**
  * Painting mode: one four-corner outline around a painting on the wall. It starts where the
  * painting was found and every corner can be dragged; sending it gives the desktop the photo
  * of the painting, cut out so it lands exactly on the real one.
  */
 let painting:UV[]|null=null,grabbed=-1,paintingBusy=false;
 function startPainting(){
  const projector=scan[0];
  painting=(projector&&findPainting(projector.white,projector.decoded.valid))||[{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}];
  message='Drag the corners onto the painting’s edges, then send it.';
 }
 function paintingDown(e:PointerEvent){
  if(!painting)return;const r=found.getBoundingClientRect();
  const p={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};
  let best=-1,reach=Infinity;
  painting.forEach((c,i)=>{const d=Math.hypot((c.x-p.x)*r.width,(c.y-p.y)*r.height);if(d<reach){reach=d;best=i;}});
  if(reach>56)return;
  grabbed=best;found.setPointerCapture(e.pointerId);e.preventDefault();
 }
 function paintingMove(e:PointerEvent){
  if(grabbed<0||!painting)return;const r=found.getBoundingClientRect();
  painting=painting.map((c,i)=>i===grabbed?{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}:c);
 }
 function paintingUp(){grabbed=-1;}
 async function sendPainting(){
  if(!painting||!reference||!onsend)return;paintingBusy=true;
  try{
   const outline=clockwiseFromTopLeft(painting);
   const fit=mapOutline(outline);
   const projector=fit.projector;
   const quad=fit.points.map(p=>({x:p.x*projector.width,y:p.y*projector.height}));
   const size=paintingSize(quad);
   // The colour photo, at the size the scan measured it.
   const image=new Image();image.src=reference.image;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=projector.decoded.width;canvas.height=projector.decoded.height;
   const context=canvas.getContext('2d',{willReadFrequently:true})!;context.drawImage(image,0,0,canvas.width,canvas.height);
   const cut=rectifyPainting(context.getImageData(0,0,canvas.width,canvas.height),fit.toProjector,quad,size);
   const out=document.createElement('canvas');out.width=size.width;out.height=size.height;
   const pixels=out.getContext('2d')!.createImageData(size.width,size.height);pixels.data.set(cut);out.getContext('2d')!.putImageData(pixels,0,0);
   const surface={id:crypto.randomUUID(),name:'Painting',points:outline};
   onsend(JSON.stringify({schema:'ghost-calibration',version:1,id:crypto.randomUUID(),name,created:new Date().toISOString(),status:'prepared',reference,surfaces:[surface],projectors:[],
    mappedSurfaces:[{name:'Painting',screenId:projector.id,screenName:projector.name,points:fit.points,rmsPx:fit.rmsPx,image:out.toDataURL('image/jpeg',.92)}]}));
   message=`Painting sent (fit ${fit.rmsPx.toFixed(1)} px). On the desktop, choose Create layers.`;
  }catch(e){message=e instanceof Error?e.message:'The painting could not be sent.';}
  finally{paintingBusy=false;}
 }
 /** Tap a found surface on the results photo to switch it on or off. */
 function tapFound(e:PointerEvent){const r=found.getBoundingClientRect();const p={x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};const hit=surfaces.filter(s=>mapped.some(m=>m.surfaceId===s.id)&&inside(s.points,p)).pop();if(hit)toggle(hit.id);}
 const centre=(points:UV[])=>({x:points.reduce((t,v)=>t+v.x,0)/points.length*1000,y:points.reduce((t,v)=>t+v.y,0)/points.length*1000});
 $: scanned=surfaces.filter(s=>mapped.some(m=>m.surfaceId===s.id));
 $: sending=scanned.filter(s=>!skipped.has(s.id)).length;
 function toggle(id:string){if(skipped.has(id))skipped.delete(id);else skipped.add(id);skipped=skipped;}
 /** Fit one outline against the scan: the projector that lights it best wins. */
 function mapOutline(outline:UV[]){let best:{projector:AutoMapProjector;points:UV[];rmsPx:number;agree:number;toProjector:number[]}|undefined,why='';
  for(const projector of scan){try{const m=mapSurface(projector,outline);if(!best||m.agree>best.agree)best={projector,...m};}catch(e){why=e instanceof Error?e.message:'';}}
  if(!best)throw new Error(why||'This surface could not be mapped.');return best;}
 let framing=false,preview:HTMLVideoElement,autoCamera:(AutoMapCamera&{stop():void})|undefined;
 async function openAuto(){framing=true;message='Starting the camera…';const held=await uprightTurn();await tick();try{autoCamera=await openAutoMapCamera(preview,held.turn);stopRemote=remote?.(autoCamera);message='';}catch(e){framing=false;message=e instanceof Error?e.message:'The camera could not start.';}}
 function closeAuto(){stopRemote?.();stopRemote=undefined;autoCamera?.stop();autoCamera=undefined;framing=false;}
 async function startAuto(){
  if(!autoCamera||!automap)return;busy=true;
  try{
   fraction=0;const result=await automap(autoCamera,(text,part)=>{message=text;if(part!==undefined)fraction=part;});
   reference=result.reference;surfaces=[];points=[];mode='surface';
   projectors=result.projectors.map(p=>({id:crypto.randomUUID(),name:p.name,width:p.width,height:p.height,corners:p.corners}));
   scan=result.projectors;mapped=[];skipped=new Set();painting=null;
   // Find the flat surfaces in the scan; nobody has to tap corners.
   for(const projector of scan)for(const found of detectSurfaces(projector,{photo:projector.white})){
    const surface={id:crypto.randomUUID(),name:`Surface ${surfaces.length+1}`,points:found.outline.map(p=>({x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))}))};
    surfaces=[...surfaces,surface];
    mapped=[...mapped,{surfaceId:surface.id,name:surface.name,screenId:projector.id,screenName:projector.name,points:found.points,rmsPx:found.rmsPx}];
   }
   skipped=skipped;
   message=surfaces.length?'':'No flat surface was found in the scan. Dim the room and try again, or trace a surface by hand.';
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
 function setReference(r:Reference){scan=[];mapped=[];skipped=new Set();reference=r;points=[];surfaces=[];projectors=[];mode='corners';message='Reference ready. Keep this photo fixed; each projector needs its own four matching corners.';}
 async function capture(){busy=true;let lease:Awaited<ReturnType<typeof acquireNativeFeed>>|undefined;try{lease=await acquireNativeFeed('depth');const deadline=performance.now()+10000;while(true){try{setReference(await captureCalibrationReference());break;}catch(e){if(performance.now()>deadline)throw e;await new Promise(resolve=>setTimeout(resolve,300));}}}catch(e){message=String(e instanceof Error?e.message:e);}finally{lease?.release();busy=false;}}
 function tap(e:PointerEvent){if(!reference||busy)return;const r=photo.getBoundingClientRect();const p={x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};if(scan.length&&mode==='surface'&&!points.length){const hit=surfaces.filter(s=>mapped.some(m=>m.surfaceId===s.id)&&inside(s.points,p)).pop();if(hit){toggle(hit.id);return;}}if(mode==='corners'&&points.length===4)points=[];points=[...points,p];}
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
<section aria-label="Projector calibration">
 <header><div><small>DESKTOP TOOLS</small><h2>{automap?'Auto map':'Calibration workshop'}</h2></div><button class="quiet" onclick={onclose} disabled={busy}>Back</button></header>
 {#if automap}
 {#if framing}
  <div class="am-stage"><video bind:this={preview} playsinline muted></video>{#if busy}<div class="am-veil"><strong>{Math.round(fraction*100)}%</strong><span>{message}</span></div>{/if}</div>
  {#if busy}
   <div class="am-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction*100)}><i style:width={`${fraction*100}%`}></i></div>
   <p class="am-hint">Keep the phone still and stay out of the beam.</p>
  {:else}
   <ul class="am-check"><li>Every surface you want is in the picture</li><li>The phone is propped so it cannot move</li><li>The room is dim</li></ul>
   <div class="am-actions"><button class="primary" onclick={startAuto} disabled={!autoCamera}>Start scan</button><button class="quiet" onclick={closeAuto}>Cancel</button></div>
  {/if}
 {:else if scan.length&&reference&&painting}
  <div class="am-stage found painting" bind:this={found} style:aspect-ratio={`${reference.width}/${reference.height}`} onpointerdown={paintingDown} onpointermove={paintingMove} onpointerup={paintingUp} onpointercancel={paintingUp} role="application" aria-label="Painting outline. Drag a corner to move it." tabindex="0">
   <img src={reference.image} alt="The scanned scene" draggable="false"/>
   <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><polygon points={painting.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/></svg>
   {#each painting as c,i}<i class="am-handle" class:held={grabbed===i} style:left={`${c.x*100}%`} style:top={`${c.y*100}%`}></i>{/each}
  </div>
  <div class="am-summary"><strong>Painting</strong><span>Drag each corner onto the painting’s edge</span></div>
  <div class="am-actions">{#if onsend}<button class="primary" onclick={sendPainting} disabled={paintingBusy}>{paintingBusy?'Preparing…':'Send painting to desktop'}</button>{/if}<button class="quiet" onclick={()=>{painting=null;message='';}} disabled={paintingBusy}>Back</button></div>
 {:else if scan.length&&reference}
  <div class="am-stage found" bind:this={found} style:aspect-ratio={`${reference.width}/${reference.height}`} onpointerdown={tapFound} role="application" aria-label="Found surfaces. Tap one to switch it on or off." tabindex="0">
   <img src={reference.image} alt="The scanned scene" draggable="false"/>
   <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
    {#each scanned as s,i}<polygon class:off={skipped.has(s.id)} points={s.points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   </svg>
   {#each scanned as s,i}{@const c=centre(s.points)}<b class="am-tag" class:off={skipped.has(s.id)} style:left={`${c.x/10}%`} style:top={`${c.y/10}%`}>{i+1}</b>{/each}
  </div>
  <div class="am-summary"><strong>{sending} of {scanned.length} surfaces</strong><span>Tap a surface to switch it off</span></div>
  <div class="am-chips">{#each scanned as s,i}<button class="am-chip" class:on={!skipped.has(s.id)} aria-pressed={!skipped.has(s.id)} onclick={()=>toggle(s.id)}><b>{i+1}</b>{skipped.has(s.id)?'Off':'On'}</button>{/each}</div>
  <div class="am-actions">{#if onsend}<button class="primary" onclick={sendDesktop} disabled={!sending}>Send {sending} to desktop</button>{/if}<button class="quiet" onclick={openAuto}>Scan again</button></div>
  <button class="am-painting" onclick={startPainting}><b>Painting on this wall?</b><span>Outline it and send its photo, already lined up and cropped.</span></button>
 {:else}
  <div class="am-hero">
   <p class="am-lead">The projector flashes a set of stripes, the phone watches, and every flat surface it lights becomes a layer on the desktop, already in place.</p>
   <ol><li><b>1</b><span>Open the Screen on the projector from the desktop.</span></li><li><b>2</b><span>Prop the phone near the projector, looking at what it lights.</span></li><li><b>3</b><span>Scan, then send the surfaces you want.</span></li></ol>
   <div class="am-actions"><button class="primary" onclick={openAuto} disabled={busy}>Open camera</button></div>
  </div>
 {/if}
 <p class="status" role="status" class:quiet={busy}>{busy?'':message}</p>
 <details class="manual"><summary>Manual photo tools</summary>
 <p>Capture the backdrop, trace its surfaces, then match each projector. Export the preparation or send it to a paired desktop for review. Output geometry changes only when you apply it there.</p>
 <div class="row"><label class="file">Take / import photo<input type="file" accept="image/*" capture="environment" onchange={importPhoto} disabled={busy}/></label><button onclick={capture} disabled={!lidar||busy}>Capture RGB + depth</button></div>
 {#if reference}<p class="note">Replacing the reference clears its geometry. Depth captures use the camera’s sensor orientation so photo, distances and coordinates stay aligned.</p>{/if}
 <label>Session name<input bind:value={name}/></label>
 {#if reference}
 <div class="photo" bind:this={photo} style:aspect-ratio={`${reference.width}/${reference.height}`} onpointerdown={tap} role="application" aria-label="Tap reference photo to place outline points" tabindex="0">
  <img src={reference.image} alt="Calibration reference" draggable="false"/>
  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
   {#each projectors as p}<polygon class="projector" points={p.corners.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   {#each surfaces as s}<polygon class:off={skipped.has(s.id)} points={s.points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   <polyline points={points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>
   {#each points as p,i}<circle cx={p.x*1000} cy={p.y*1000} r="9"/><text x={p.x*1000+15} y={p.y*1000+10}>{i+1}</text>{/each}
  </svg>
 </div>
 <div class="row"><button class:active={mode==='corners'} onclick={()=>{mode='corners';points=[];}}>Projector corners</button><button class:active={mode==='surface'} onclick={()=>{mode='surface';points=[];}}>Trace surface</button><button onclick={()=>points=points.slice(0,-1)} disabled={!points.length}>Undo point</button></div>
 {#if mode==='corners'}<p>Tap the projected reference rectangle: <b>top left → top right → bottom right → bottom left</b>. These must be known projector corners, not arbitrary backdrop corners. Without a projector, save a draft and mark them later.</p><label>Projector name<input bind:value={projectorName}/></label><div class="row"><label>Width<input type="number" min="2" max="16384" bind:value={width}/></label><label>Height<input type="number" min="2" max="16384" bind:value={height}/></label></div>
 {:else}<p>Tap around one flat surface. Finish the outline below. Four-point calibration is valid only on the same plane as the reference rectangle; other depths need additional calibration.</p>{/if}
 <button class="primary" onclick={add} disabled={mode==='corners'?points.length!==4:points.length<3}>Add {mode==='corners'?'projector':'surface'}</button>
 {#each projectors as p}<div class="item"><span>{p.name} · {p.width} × {p.height}</span><button onclick={()=>projectors=projectors.filter(x=>x.id!==p.id)}>Remove</button></div>{/each}
 {#each surfaces as s}<div class="item"><span>{s.name} · {s.points.length} points{depthLabel(s.points)}</span>{#if mapped.some(m=>m.surfaceId===s.id)}<button class:active={!skipped.has(s.id)} aria-pressed={!skipped.has(s.id)} onclick={()=>toggle(s.id)}>{skipped.has(s.id)?'Off':'On'}</button>{/if}<button onclick={()=>surfaces=surfaces.filter(x=>x.id!==s.id)}>Remove</button></div>{/each}
 {#if mapping&&surfaces.length}<p class="note">{outside()?'Some surface points fall outside projector 1. They are preserved in the export; verify coverage.':'Surface points fit inside projector 1’s reference.'}</p>{/if}
 <div class="row"><button onclick={save}>Save draft</button><button class="primary" onclick={download} disabled={!projectors.length||!surfaces.length}>Export preparation</button>{#if onsend}<button class="primary" onclick={sendDesktop} disabled={!projectors.length||!surfaces.length}>Send to desktop</button>{/if}</div>
 {/if}
 <h3>Saved preparations</h3>{#each saved as c}<div class="item"><button onclick={()=>load(c)}>{c.name} · {new Date(c.created).toLocaleDateString()}</button><button onclick={()=>{try{const next=saved.filter(x=>x.id!==c.id);localStorage.setItem(key,JSON.stringify(next));saved=next;}catch{message='Could not remove saved draft.';}}}>Delete</button></div>{/each}
 <details><summary>What still needs a projector?</summary><p>Pixel correspondence, focus, alignment, overlap, brightness matching and bump recovery require physical verification. LiDAR measures the scene, not where projector pixels land. Packages include photo-space outlines, per-projector homographies, raw depth when captured, and an inverted Gray-code pattern plan for the future desktop presenter. Automatic capture, decoding and blending are not active yet.</p></details>
 </details>
 {:else}
 <p>Capture the backdrop, trace its surfaces, then match each projector. Export the preparation or send it to a paired desktop for review. Output geometry changes only when you apply it there.</p>
 <div class="row"><label class="file">Take / import photo<input type="file" accept="image/*" capture="environment" onchange={importPhoto} disabled={busy}/></label><button onclick={capture} disabled={!lidar||busy}>Capture RGB + depth</button></div>
 {#if reference}<p class="note">Replacing the reference clears its geometry. Depth captures use the camera’s sensor orientation so photo, distances and coordinates stay aligned.</p>{/if}
 <label>Session name<input bind:value={name}/></label>
 {#if reference}
 <div class="photo" bind:this={photo} style:aspect-ratio={`${reference.width}/${reference.height}`} onpointerdown={tap} role="application" aria-label="Tap reference photo to place outline points" tabindex="0">
  <img src={reference.image} alt="Calibration reference" draggable="false"/>
  <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
   {#each projectors as p}<polygon class="projector" points={p.corners.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   {#each surfaces as s}<polygon class:off={skipped.has(s.id)} points={s.points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}
   <polyline points={points.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>
   {#each points as p,i}<circle cx={p.x*1000} cy={p.y*1000} r="9"/><text x={p.x*1000+15} y={p.y*1000+10}>{i+1}</text>{/each}
  </svg>
 </div>
 <div class="row"><button class:active={mode==='corners'} onclick={()=>{mode='corners';points=[];}}>Projector corners</button><button class:active={mode==='surface'} onclick={()=>{mode='surface';points=[];}}>Trace surface</button><button onclick={()=>points=points.slice(0,-1)} disabled={!points.length}>Undo point</button></div>
 {#if mode==='corners'}<p>Tap the projected reference rectangle: <b>top left → top right → bottom right → bottom left</b>. These must be known projector corners, not arbitrary backdrop corners. Without a projector, save a draft and mark them later.</p><label>Projector name<input bind:value={projectorName}/></label><div class="row"><label>Width<input type="number" min="2" max="16384" bind:value={width}/></label><label>Height<input type="number" min="2" max="16384" bind:value={height}/></label></div>
 {:else}<p>Tap around one flat surface. Finish the outline below. Four-point calibration is valid only on the same plane as the reference rectangle; other depths need additional calibration.</p>{/if}
 <button class="primary" onclick={add} disabled={mode==='corners'?points.length!==4:points.length<3}>Add {mode==='corners'?'projector':'surface'}</button>
 {#each projectors as p}<div class="item"><span>{p.name} · {p.width} × {p.height}</span><button onclick={()=>projectors=projectors.filter(x=>x.id!==p.id)}>Remove</button></div>{/each}
 {#each surfaces as s}<div class="item"><span>{s.name} · {s.points.length} points{depthLabel(s.points)}</span>{#if mapped.some(m=>m.surfaceId===s.id)}<button class:active={!skipped.has(s.id)} aria-pressed={!skipped.has(s.id)} onclick={()=>toggle(s.id)}>{skipped.has(s.id)?'Off':'On'}</button>{/if}<button onclick={()=>surfaces=surfaces.filter(x=>x.id!==s.id)}>Remove</button></div>{/each}
 {#if mapping&&surfaces.length}<p class="note">{outside()?'Some surface points fall outside projector 1. They are preserved in the export; verify coverage.':'Surface points fit inside projector 1’s reference.'}</p>{/if}
 <div class="row"><button onclick={save}>Save draft</button><button class="primary" onclick={download} disabled={!projectors.length||!surfaces.length}>Export preparation</button>{#if onsend}<button class="primary" onclick={sendDesktop} disabled={!projectors.length||!surfaces.length}>Send to desktop</button>{/if}</div>
 {/if}
 <p class="status" role="status">{busy?'Capturing…':message}</p>
 <h3>Saved preparations</h3>{#each saved as c}<div class="item"><button onclick={()=>load(c)}>{c.name} · {new Date(c.created).toLocaleDateString()}</button><button onclick={()=>{try{const next=saved.filter(x=>x.id!==c.id);localStorage.setItem(key,JSON.stringify(next));saved=next;}catch{message='Could not remove saved draft.';}}}>Delete</button></div>{/each}
 <details><summary>What still needs a projector?</summary><p>Pixel correspondence, focus, alignment, overlap, brightness matching and bump recovery require physical verification. LiDAR measures the scene, not where projector pixels land. Packages include photo-space outlines, per-projector homographies, raw depth when captured, and an inverted Gray-code pattern plan for the future desktop presenter. Automatic capture, decoding and blending are not active yet.</p></details>
 {/if}
</section>
<style>
 .am-stage.painting{touch-action:none}
 .am-handle{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid #fff;background:var(--ga-blue,#5278ff);box-shadow:0 1px 8px #000c;pointer-events:none}
 .am-handle.held{transform:scale(1.35);background:#fff;border-color:var(--ga-blue,#5278ff)}
 .am-painting{display:grid;gap:3px;width:100%;margin-top:14px;padding:12px 14px;text-align:left;border-radius:10px;background:transparent;border:1px dashed var(--ga-line-3)}
 .am-painting b{font-size:13px;font-weight:600}.am-painting span{font-size:12px;color:var(--ga-ink-2)}
 .am-stage{position:relative;width:100%;background:#000;border-radius:10px;overflow:hidden;border:1px solid var(--ga-line-3)}
 .am-stage video{display:block;width:100%;max-height:52vh;object-fit:contain;background:#000}
 .am-stage.found{touch-action:manipulation}
 .am-stage img,.am-stage svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
 .am-stage polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2.5}
 .am-stage polygon.off{fill:transparent;stroke:#ffffff66;stroke-dasharray:10 8;opacity:1}
 .am-tag{position:absolute;transform:translate(-50%,-50%);min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:var(--ga-blue,#5278ff);color:#fff;font:600 12px/22px system-ui;text-align:center;pointer-events:none;box-shadow:0 1px 6px #0009}
 .am-tag.off{background:#0009;color:#fff9}
 .am-veil{position:absolute;inset:0;display:grid;place-content:center;gap:4px;text-align:center;background:#000a;color:#fff}
 .am-veil strong{font:600 34px/1 system-ui;font-variant-numeric:tabular-nums}.am-veil span{font-size:12px;color:#fffc}
 .am-bar{height:4px;margin:12px 0 0;border-radius:2px;background:var(--ga-line-3);overflow:hidden}.am-bar i{display:block;height:100%;background:var(--ga-blue,#5278ff);transition:width .25s linear}
 .am-hint{margin:10px 0 0;text-align:center;font-size:12px}
 .am-check{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}.am-check li{position:relative;padding-left:22px;color:var(--ga-ink-1,var(--ga-ink-0));font-size:13px}.am-check li::before{content:"";position:absolute;left:4px;top:7px;width:6px;height:6px;border-radius:50%;background:var(--ga-blue,#5278ff)}
 .am-actions{display:flex;gap:10px;margin-top:16px}.am-actions .primary{flex:1;min-height:50px;font-weight:600;font-size:15px;border-radius:10px;background:var(--ga-blue,#5278ff);border-color:transparent;color:#fff}.am-actions .primary:disabled{opacity:.35}
 .quiet{background:transparent;border-color:var(--ga-line-3);border-radius:10px;padding:10px 16px}
 .am-summary{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px}.am-summary strong{font-size:15px}.am-summary span{font-size:12px;color:var(--ga-ink-2)}
 .am-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
 .am-chip{display:flex;align-items:center;gap:8px;min-height:40px;padding:6px 12px 6px 6px;border-radius:20px;font-size:12px;color:var(--ga-ink-2);background:transparent}
 .am-chip b{display:grid;place-content:center;width:26px;height:26px;border-radius:50%;background:var(--ga-line-3);color:var(--ga-ink-0);font-size:12px}
 .am-chip.on{color:var(--ga-ink-0);border-color:var(--ga-blue-300)}.am-chip.on b{background:var(--ga-blue,#5278ff);color:#fff}
 .am-hero{padding:6px 0 0}.am-lead{font-size:15px;line-height:1.5;color:var(--ga-ink-0);margin:8px 0 18px}
 .am-hero ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}.am-hero li{display:flex;gap:12px;align-items:flex-start}.am-hero li b{flex:none;display:grid;place-content:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--ga-blue-300);color:var(--ga-blue-200);font-size:12px}.am-hero li span{padding-top:3px;color:var(--ga-ink-1,var(--ga-ink-0))}
 .status.quiet{display:none}
 .manual{margin-top:26px;border-top:1px solid var(--ga-line-2);padding-top:6px}.manual summary{min-height:44px;display:flex;align-items:center;color:var(--ga-ink-2);font-size:12px;letter-spacing:.04em}
 section{padding:18px;font:13px/1.5 system-ui;color:var(--ga-ink-0)}header,.row,.item{display:flex;align-items:center;gap:8px;justify-content:space-between}.row{flex-wrap:wrap;margin:12px 0}.row>*{flex:1;min-width:110px}header small{font-size:9px;letter-spacing:.12em;color:var(--ga-blue-200)}h2{font-size:20px;margin:4px 0}h3{font-size:13px}p,.note{color:var(--ga-ink-2)}button,.file,input{box-sizing:border-box;min-height:44px;border:1px solid var(--ga-line-3);border-radius:5px;background:var(--ga-slot);color:inherit;padding:10px;font:inherit}button{touch-action:manipulation}button:disabled{opacity:.4}label{display:block;font-size:11px}input{display:block;width:100%;margin-top:4px}.file{cursor:pointer;font-size:13px}.file input{width:100%;font-size:11px}.primary,.active{background:var(--ga-selection-bg);border-color:var(--ga-blue-300)}.photo{position:relative;width:100%;background:#000;touch-action:none;margin-top:12px;overflow:hidden}.photo img,.photo svg{position:absolute;width:100%;height:100%;inset:0;pointer-events:none}.photo img{object-fit:fill}polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2;vector-effect:non-scaling-stroke}.projector{stroke:#ffa45b;fill:#ffa45b15}polyline{fill:none;stroke:white;stroke-width:2;vector-effect:non-scaling-stroke}circle{fill:#ffa45b;stroke:#fff;stroke-width:2}text{fill:white;font-size:30px;font-weight:bold}.item{border-bottom:1px solid var(--ga-line-2);padding:8px 0}.item span{overflow-wrap:anywhere;min-width:0}.status{color:var(--ga-blue-200)}summary{min-height:44px;cursor:pointer;font-weight:bold}
</style>
