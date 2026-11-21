<script lang="ts">
 import {onMount,onDestroy,tick} from 'svelte';
 import Icon from './StudioIcon.svelte';
 import InfoTip from './ui/InfoTip.svelte';
 import {findPainting,paintingSize,rectifyPainting,clockwiseFromTopLeft} from '../../mobile/studio/painting';
 import {openAutoMapCamera,uprightTurn,mapSurface,type AutoMapCamera,type AutoMapProjector,type AutoMapResult} from '../../mobile/studio/autoMap';
 import {surfaceDepthQuality,homography,unitCorners,project,exportCalibration,grayPatternPlan,type Calibration,type UV,type Reference} from '../../mobile/studio/calibration';
 import {captureCalibrationReference,shareCalibrationPreparation} from '../../mobile/studio/captureToolkit';
 import {acquireNativeFeed} from '../../mobile/studio/nativeLive';
 import {openLidarAutoMapCamera} from '../../mobile/studio/lidarScan';
 import {autoMapSurfaces} from '../../mobile/studio/autoMapSurfaces';
 import {buildCurvedSurface,sampleScan,type CurvedScan,type CurvedSurface,type MeshMode} from '../../mobile/studio/meshMap';
 import {buildDepthCapture,desktopFit,gravityInScan,DEPTH_CAPTURE_FILE,type DepthCapture,type CaptureReport} from '../../mobile/studio/depthCapture';
 import {stageOf,type DepthScanRequest,type DepthScanStage} from '../../mobile/studio/depthScan';
 import type {DepthCaptureLimits} from '../../mobile/studio/desktopCapabilities';
 import {shareFile} from '../../mobile/studio/nativeShare';
 export let onclose:()=>void;
 export let onsend:((json:string)=>void)|undefined=undefined;
 function sendDesktop(){try{const live=mapped.filter(m=>!skipped.has(m.surfaceId)&&surfaces.some(s=>s.id===m.surfaceId));const c=draft();let base:Record<string,unknown>;try{base=exportCalibration(c);}catch(e){if(!live.length)throw e;base={...c};}onsend?.(JSON.stringify({...base,mappedSurfaces:live.map(({name,screenId,screenName,points,rmsPx,edgePx,curved})=>({name,screenId,screenName,points,rmsPx,...(edgePx!==undefined?{edgePx:Math.round(edgePx*100)/100}:{}),...(curved?meshPayload(curved.surface):{})}))}));message=live.length?`Sent ${live.length} mapped surface${live.length===1?'':'s'}. On the desktop, choose Create layers.`:"Sent for desktop review; output geometry is not changed until applied there.";}catch(e){message=(e as Error).message;}}
 export let lidar=false;
 /** Runs the stripe capture against a paired desktop. Only set when paired. */
 export let automap:((camera:AutoMapCamera,progress:(text:string,fraction?:number)=>void,options?:{screenId?:string})=>Promise<AutoMapResult>)|undefined=undefined;
 // ── Room scan for Depth mode ────────────────────────────────────────────
 // The same auto-map, run with LiDAR, turned into the capture the desktop's
 // Depth mode reads (depthCapture.ts). Offered when the paired desktop takes one.
 /** The desktop's limits, when it takes a room scan (studio_capabilities.depthCapture). */
 export let depthCapture:DepthCaptureLimits|null=null;
 /** A scan the desktop asked for (studio_depth_scan_request): the workshop opens on it, ready to start. */
 export let depthRequest:DepthScanRequest|null=null;
 /** Send the capture; resolves with what the desktop said. */
 export let ondepthsend:((capture:DepthCapture,requestId:string,later:(text:string)=>void)=>Promise<string>)|undefined=undefined;
 /** The desktop output's size, for the preview's shape and the fit (studio_capabilities.output). */
 export let output:{width:number;height:number}|null=null;
 $: outputSize=depthRequest?.output??output;
 export let ondepthprogress:(requestId:string,stage:DepthScanStage,pct?:number,message?:string)=>void=()=>{};
 /** The desktop cancelled or gave up on the scan it asked for (studio_depth_capture_status). */
 export let depthStop:{requestId:string;text:string}|null=null;
 $: if(depthStop&&depthStop.requestId===depthId&&asked&&!depthResult)stopDepth(depthStop.text);
 let depthStopped=false;
 function stopDepth(text:string){depthStopped=true;asked=false;depthFailed=text;closeAuto();ondepthdone();}
 // While the desktop waits, it hears from the phone at least every few seconds (it gives up after 90 s of silence).
 let lastProgress:[DepthScanStage,number|undefined]|null=null;
 const keepAlive=setInterval(()=>{if(asked&&lastProgress&&(busy||framing))ondepthprogress(depthId,lastProgress[0],lastProgress[1]);},5000);
 onDestroy(()=>clearInterval(keepAlive));
 function report(stage:DepthScanStage,pct?:number,text?:string){lastProgress=[stage,pct];ondepthprogress(depthId,stage,pct,text);}
 /** The desktop's request is answered (sent, cancelled or failed). */
 export let ondepthdone:()=>void=()=>{};
 /** True while a scan runs: a request that arrives then waits (PairedStudio). */
 export let busyScanning=false;
 /** Open straight on the room scan (the World tab's Scan room for Depth mode). */
 export let openDepth=false;
 onMount(()=>{if(openDepth&&!depthRequest)void startDepth(null);});
 /** Fixture build for the simulator, which has no LiDAR: a synthetic room stands in for the scan. */
 const FIXTURE=import.meta.env.VITE_DEPTH_FIXTURE==='1';
 let depth=false,depthId='',asked=false,depthResult:{capture:DepthCapture;report:CaptureReport;fitPx:number|null}|null=null,depthStatus='',depthSending=false,depthFailed='';
 $: busyScanning=busy||depthSending;
 $: depthReady=!!depthCapture&&(lidar||FIXTURE)&&!!automap;
 let handledRequest='';
 $: if(depthRequest&&depthRequest.requestId!==handledRequest){handledRequest=depthRequest.requestId;void startDepth(depthRequest);}
 async function startDepth(request:DepthScanRequest|null){
  painting=null;depth=true;depthStopped=false;lastProgress=null;depthId=request?.requestId??crypto.randomUUID();asked=!!request;depthResult=null;depthStatus='';depthFailed='';
  if(!lidar&&!FIXTURE){depthFailed='Depth mode needs an iPhone or iPad with LiDAR.';if(asked){report('error',undefined,depthFailed);ondepthdone();}return;}
  await openAuto();
  if(asked)report(framing?'ready':'error',undefined,framing?undefined:message);
  if(asked&&!framing)ondepthdone();
 }
 function leaveDepth(){
  if(asked&&!depthResult&&!depthSending)report('cancelled');
  if(asked)ondepthdone();
  closeAuto();depth=false;asked=false;depthResult=null;depthStatus='';depthFailed='';message='';
 }
 /** The capture from a finished auto-map: the projector that saw most of the scene, its surfaces, gravity. */
 function captureFrom(result:AutoMapResult,screenId?:string){
  if(!result.depth)throw new Error(result.depthError?`Depth was not measured: ${result.depthError}`:'Depth was not measured. Keep the phone within about 4 m and scan again.');
  if(!result.depth.pose)throw new Error('This scan has no gravity reading. Update the app and scan again.');
  const lit=(p:AutoMapProjector)=>{let n=0;for(const v of p.decoded.valid)n+=v;return n;};
  const projector=scan.find(p=>p.id===screenId)??[...scan].sort((a,b)=>lit(b)-lit(a))[0];
  if(!projector)throw new Error('No projector was seen.');
  const grid=sampleScan(projector.decoded,result.depth,projector.plan.cell);
  const own=mapped.filter(m=>m.screenId===projector.id);
  const built=buildDepthCapture({grid,screen:{id:projector.id,width:projector.width,height:projector.height,region:projector.region},
   surfaces:own.map(m=>({id:m.surfaceId,name:m.name,photo:surfaces.find(s=>s.id===m.surfaceId)?.points??[],projector:m.curved?undefined:m.points})),
   down:gravityInScan(result.depth.pose,result.depth.turn??0),limits:depthCapture??undefined,device:navigator.userAgent.includes('iPad')?'iPad':'iPhone'});
  return {...built,fitPx:fit(built.capture)};
 }
 /** How well the desktop's own solve will line it up (output pixels at 1920 wide). */
 function fit(capture:DepthCapture){return desktopFit(capture,outputSize?outputSize.width/outputSize.height:16/9);}
 async function finishDepth(result:AutoMapResult|null){
  report('solving',1);message='Building the room scan…';await tick();
  if(FIXTURE&&!result){const {fixtureDepthCapture}=await import('../../mobile/studio/depthCaptureFixture');const f=fixtureDepthCapture();depthResult={...f,fitPx:fit(f.capture)};}
  else depthResult=captureFrom(result!,depthRequest?.screenId);
  message='';
  if(asked)await sendDepth();
 }
 async function sendDepth(){
  if(!depthResult||!ondepthsend)return;depthSending=true;report('sending',1);depthStatus='Sending to the desktop…';
  try{depthStatus=await ondepthsend(depthResult.capture,depthId,text=>depthStatus=text);}catch(e){depthStatus=e instanceof Error?e.message:'The scan could not be sent.';}
  finally{depthSending=false;if(asked){ondepthdone();asked=false;}}
 }
 async function saveDepth(e:MouseEvent){
  if(!depthResult)return;
  try{const done=await shareFile(DEPTH_CAPTURE_FILE,new Blob([JSON.stringify(depthResult.capture)],{type:'application/json'}),'application/json',e.currentTarget as HTMLElement);if(done)depthStatus='Saved. On the desktop: Interactive Studio → 3D world → Real objects → Scan with the phone → Open a depth capture.';}
  catch(err){depthStatus=err instanceof Error?err.message:'The file could not be saved.';}
 }
 let fraction=0,found:HTMLDivElement;
 /** Lets the paired desktop take photos through this phone while the preview is open. */
 export let remote:((camera:AutoMapCamera)=>()=>void)|undefined=undefined;
 let stopRemote:(()=>void)|undefined;
 /** The last stripe scan, kept so each outlined surface can be fitted on its own. */
 let scan:AutoMapProjector[]=[];
 /** A curved surface found with LiDAR: which projector scan and region it came from, and its current mesh. */
 type Curved={scan:number;region:number;surface:CurvedSurface};
 type Mapped={surfaceId:string;name:string;screenId:string;screenName:string;points:UV[];rmsPx:number;edgePx?:number;curved?:Curved};
 /** Per projector, the LiDAR side of the scan, kept so a surface can be rebuilt in the other mode. */
 let curvedScans:(CurvedScan&{projector:AutoMapProjector})[]=[];
 const round=(n:number)=>Math.round(n*1e5)/1e5;
 const pt=(p:UV)=>({x:round(p.x),y:round(p.y)});
 /** What the desktop needs to warp a layer onto a curved surface and hide what falls off it. */
 function meshPayload(c:CurvedSurface){return{mode:c.mode,contentOutline:c.contentOutline.map(pt),mesh:{rows:c.mesh.rows,cols:c.mesh.cols,points:c.mesh.points.map(pt),tangents:c.mesh.tangents?.map(t=>({right:pt(t.right),down:pt(t.down)}))??null,rest:{u0:round(c.mesh.rest.u0),v0:round(c.mesh.rest.v0),u1:round(c.mesh.rest.u1),v1:round(c.mesh.rest.v1)}}};}
 /** Wrap the surface, or match the camera's view: rebuilt from the kept scan. */
 function setMode(m:Mapped,mode:MeshMode){if(!m.curved||m.curved.surface.mode===mode)return;const c=curvedScans[m.curved.scan];if(!c)return;
  try{const surface=buildCurvedSurface(c.grid,c.regions[m.curved.region],{width:c.projector.width,height:c.projector.height,model:c.model},mode);
   mapped=mapped.map(x=>x===m?{...x,points:surface.corners,rmsPx:surface.rmsPx,curved:{...m.curved!,surface}}:x);}
  catch(e){message=e instanceof Error?e.message:'That surface could not be rebuilt.';}}
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
 let framing=false,preview:HTMLVideoElement,previewCanvas:HTMLCanvasElement,autoCamera:(AutoMapCamera&{stop():void})|undefined;
 // With LiDAR the scan runs on the depth camera, so curved forms get a mesh; otherwise the plain camera.
 async function openAuto(){framing=true;message='Starting the camera…';
  if(FIXTURE&&depth){await tick();autoCamera={grab:()=>Promise.reject(new Error('Fixture')),stop(){}};message='';return;}
  // The motion permission must be asked straight from the tap, before anything else waits.
  const held=lidar?null:await uprightTurn();await tick();try{autoCamera=lidar?await openLidarAutoMapCamera(previewCanvas):await openAutoMapCamera(preview,held?.turn??0);stopRemote=remote?.(autoCamera);message='';}catch(e){framing=false;message=e instanceof Error?e.message:'The camera could not start.';}}
 function closeAuto(){stopRemote?.();stopRemote=undefined;autoCamera?.stop();autoCamera=undefined;framing=false;}
 async function startAuto(){
  if(!autoCamera||!automap)return;busy=true;
  if(depth&&FIXTURE){try{for(let k=1;k<=20;k++){if(depthStopped)return;fraction=k/20*.85;message=k<18?`Screen 1: pattern ${k} of 17`:'Measuring depth';report(k<18?'patterns':'measuring',fraction);await new Promise(r=>setTimeout(r,90));}fraction=1;await finishDepth(null);}catch(e){depthFailed=e instanceof Error?e.message:'The scan failed.';}finally{busy=false;closeAuto();}return;}
  try{
   fraction=0;const result=await automap(autoCamera,(text,part)=>{message=text;if(part!==undefined)fraction=part;if(depth)report(stageOf(text),part);},depth&&depthRequest?.screenId?{screenId:depthRequest.screenId}:undefined);
   reference=result.reference;surfaces=[];points=[];mode='surface';
   projectors=result.projectors.map(p=>({id:crypto.randomUUID(),name:p.name,width:p.width,height:p.height,corners:p.corners}));
   scan=result.projectors;mapped=[];skipped=new Set();painting=null;curvedScans=[];
   // Find the flat surfaces in the scan (nobody has to tap corners); with depth, curved forms get a mesh,
   // and a flat fit drawn across one gives way to it. The stripes decide the flat faces either way.
   if(result.depth){message='Finding curved surfaces…';fraction=1;await tick();await new Promise(r=>setTimeout(r,30));}
   const found=autoMapSurfaces(scan.map(p=>({id:p.id,width:p.width,height:p.height,plan:p.plan,decoded:p.decoded,white:p.white})),result.depth,'wrap');
   (found.curvedScans??[]).forEach((c,index)=>{curvedScans[index]={...c,projector:scan[index]};});
   const curved=found.filter(f=>f.curved);
   for(const item of found){const projector=scan[item.scan];const surface={id:crypto.randomUUID(),name:`Surface ${surfaces.length+1}`,points:item.outline};
    surfaces=[...surfaces,surface];mapped=[...mapped,{surfaceId:surface.id,name:surface.name,screenId:projector.id,screenName:projector.name,points:item.points,rmsPx:item.rmsPx,...(item.edgePx!==undefined?{edgePx:item.edgePx}:{}),...(item.curved?{curved:{scan:item.scan,region:item.curved.region,surface:item.curved.surface}}:{})}];}
   skipped=skipped;
   const meshes=curved.length;
   if(depth){if(!depthStopped)await finishDepth(result);return;}
   message=surfaces.length?(result.depthError?`Depth was not measured (${result.depthError}) Curved forms were not meshed.`:''):(meshes||result.depth?'Nothing the projector lights could be mapped. Dim the room and try again, or trace a surface by hand.':'No flat surface was found in the scan. Dim the room and try again, or trace a surface by hand.');
  }catch(e){message=e instanceof Error?e.message:'Auto map failed.';if(depth){depthFailed=depthStopped?depthFailed:message;message='';if(asked&&!depthStopped){report('error',undefined,depthFailed);ondepthdone();asked=false;}}}
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
 <header><span class="ga-chip" data-tone="output" aria-hidden="true"><Icon name="scan" size={18}/></span><h2>{depth?'Room scan for Depth mode':automap?'Auto map':'Projector calibration'}</h2><button class="quiet" onclick={()=>depth?leaveDepth():onclose()} disabled={busy||depthSending}>Back</button></header>
 {#if automap}
 {#if depth}
  {#if depthFailed}
   <p class="am-lead" role="alert">{depthFailed}</p>
   <div class="am-actions">{#if lidar||FIXTURE}<button class="primary" onclick={()=>startDepth(null)}>Scan again</button>{/if}<button class="quiet" onclick={leaveDepth}>Back</button></div>
  {:else if depthResult}
   {@const r=depthResult.report}
   <div class="am-stage depth-out" style:aspect-ratio={outputSize?`${outputSize.width}/${outputSize.height}`:'16/9'} role="img" aria-label={`${r.surfaces} surfaces on the desktop output`}>
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{#each depthResult.capture.surfaces as surface}<polygon points={surface.outline.map(v=>`${v.x*1000},${v.y*1000}`).join(' ')}/>{/each}</svg>
    {#each depthResult.capture.surfaces as surface,i}{@const c=centre(surface.outline)}<b class="am-tag" style:left={`${c.x/10}%`} style:top={`${c.y/10}%`}>{i+1}</b>{/each}
   </div>
   <dl class="am-readout">
    <div><dt>Surfaces</dt><dd>{r.surfaces}</dd></div>
    <div><dt>Samples</dt><dd>{r.samples.toLocaleString()}</dd></div>
    <div><dt>Coverage</dt><dd>{Math.round(r.coverage*100)}%</dd></div>
    <div><dt>Fit</dt><dd>{depthResult.fitPx===null?'–':`${depthResult.fitPx.toFixed(1)} px`}</dd></div>
   </dl>
   <p class="am-note">{r.dropped?`${r.dropped} surface${r.dropped===1?' was':'s were'} left out: too few depth readings.`:'Where each surface lands on the desktop output.'}<InfoTip label="About the room scan"><p>The desktop places the projector and fits a face to each surface from these points, then Depth mode throws, pours and burns on the real objects.</p><p>Fit is how far the measured points land from where the projector shows them, in output pixels. Under 3 px lines up well.</p></InfoTip></p>
   <p class="status" role="status">{depthStatus}</p>
   <div class="am-actions">{#if ondepthsend}<button class="primary" onclick={sendDepth} disabled={depthSending}>{depthSending?'Sending…':depthStatus?'Send again':'Send to desktop'}</button>{/if}<button class="quiet" onclick={saveDepth}>Save / Share file</button></div>
   <div class="am-actions"><button class="quiet wide" onclick={()=>startDepth(null)} disabled={depthSending}>Scan again</button></div>
  {:else}
   <div class="am-stage">{#if FIXTURE}<div class="am-preview am-fixture" aria-hidden="true"></div>{:else}<canvas class="am-preview" bind:this={previewCanvas}></canvas>{/if}{#if busy}<div class="am-veil"><strong>{Math.round(fraction*100)}%</strong><span>{message}</span></div>{/if}</div>
   {#if busy}
    <div class="am-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction*100)}><i style:width={`${fraction*100}%`}></i></div>
    <p class="am-hint">Keep the phone still and stay out of the beam.</p>
   {:else}
    <p class="am-lead">Prop the phone where it sees the objects and the projection, then tap Start.<InfoTip label="How the room scan works"><ol><li>The projector shows stripes while the phone watches.</li><li>Then it goes dark while the LiDAR measures depth.</li><li>The phone sends the room to the desktop's Depth mode.</li></ol></InfoTip></p>
    <ul class="am-check"><li>The phone cannot move</li><li>The objects and the projection are in the picture</li><li>The room is dim, the objects within about 4 m</li></ul>
    {#if asked}<p class="am-note">The desktop asked for this scan.</p>{/if}
    <div class="am-actions"><button class="primary" onclick={startAuto} disabled={!autoCamera}>Start</button><button class="quiet" onclick={leaveDepth}>Cancel</button></div>
   {/if}
  {/if}
 {:else if framing}
  <div class="am-stage">{#if lidar}<canvas class="am-preview" bind:this={previewCanvas}></canvas>{:else}<video bind:this={preview} playsinline muted></video>{/if}{#if busy}<div class="am-veil"><strong>{Math.round(fraction*100)}%</strong><span>{message}</span></div>{/if}</div>
  {#if busy}
   <div class="am-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction*100)}><i style:width={`${fraction*100}%`}></i></div>
   <p class="am-hint">Keep the phone still and stay out of the beam.</p>
  {:else}
   <ul class="am-check"><li>Every surface you want is in the picture</li><li>The phone is propped so it cannot move</li><li>The room is dim</li>{#if lidar}<li>Curved and organic forms get a mesh from LiDAR, within about 4 m</li>{/if}</ul>
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
  <div class="am-chips">{#each scanned as s,i}{@const m=mapped.find(x=>x.surfaceId===s.id)}<button class="am-chip" class:on={!skipped.has(s.id)} aria-pressed={!skipped.has(s.id)} onclick={()=>toggle(s.id)}><b>{i+1}</b>{skipped.has(s.id)?'Off':m?.curved?'Mesh':'On'}</button>{/each}</div>
  {#each mapped.filter(m=>m.curved&&!skipped.has(m.surfaceId)) as m (m.surfaceId)}{@const n=scanned.findIndex(s=>s.id===m.surfaceId)+1}
   <div class="am-mode" role="radiogroup" aria-label={`Surface ${n}: how the picture sits on it`}><span><b>{n}</b>Curved</span>
    <button role="radio" aria-checked={m.curved?.surface.mode==='wrap'} class:on={m.curved?.surface.mode==='wrap'} onclick={()=>setMode(m,'wrap')}>Wrap the surface</button>
    <button role="radio" aria-checked={m.curved?.surface.mode==='camera'} class:on={m.curved?.surface.mode==='camera'} onclick={()=>setMode(m,'camera')}>Match camera view</button>
   </div>
  {/each}
  <div class="am-actions">{#if onsend}<button class="primary" onclick={sendDesktop} disabled={!sending}>Send {sending} to desktop</button>{/if}<button class="quiet" onclick={openAuto}>Scan again</button></div>
  <button class="am-painting" onclick={startPainting}><b>Painting on this wall?</b><span>Outline it and send its photo, already lined up and cropped.</span></button>
 {:else}
  <div class="am-hero">
   <p class="am-lead">The projector flashes stripes, the phone watches, and each flat surface it lights becomes a layer on the desktop.<InfoTip label="How auto map works"><ol><li>Open the Screen on the projector from the desktop.</li><li>Prop the phone near the projector, looking at what it lights.</li><li>Scan, then send the surfaces you want.</li></ol></InfoTip></p>
   <div class="am-actions"><button class="primary" onclick={openAuto} disabled={busy}>Open camera</button></div>
   {#if depthReady}<button class="am-painting am-depth-entry" onclick={()=>startDepth(null)}><b>Scan room for Depth mode</b><span>Measure the real objects with LiDAR so the desktop's 3D world lands on them.</span></button>{/if}
  </div>
 {/if}
 <p class="status" role="status" class:quiet={busy}>{busy?'':message}</p>
 <details class="manual" hidden={depth}><summary>Manual photo tools</summary>
 <p class="lead">Photograph the wall, trace its surfaces and mark the projector’s corners.<InfoTip label="About projector calibration" text="Export the preparation or send it to a paired desktop for review; the projector output changes only when you apply it there. Replacing the photo clears what you traced on it. Depth captures keep the photo, distances and coordinates lined up."/></p>
 <div class="row"><label class="file">Take / import photo<input type="file" accept="image/*" capture="environment" onchange={importPhoto} disabled={busy}/></label><button onclick={capture} disabled={!lidar||busy}>Capture RGB + depth</button></div>
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
 {#if mode==='corners'}<p class="lead">Tap the projected rectangle’s corners: <b>top left → top right → bottom right → bottom left</b>.<InfoTip label="About projector corners" text="These must be the projector’s own corners, not any corners in the room. Without a projector, save a draft and mark them later."/></p><label>Projector name<input bind:value={projectorName}/></label><div class="row"><label>Width<input type="number" min="2" max="16384" bind:value={width}/></label><label>Height<input type="number" min="2" max="16384" bind:value={height}/></label></div>
 {:else}<p class="lead">Tap around one flat surface, then add it.<InfoTip label="About tracing surfaces" text="Four-point calibration holds only on the same flat plane as the projector rectangle; surfaces at other depths need their own calibration."/></p>{/if}
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
 <p class="lead">Photograph the wall, trace its surfaces and mark the projector’s corners.<InfoTip label="About projector calibration" text="Export the preparation or send it to a paired desktop for review; the projector output changes only when you apply it there. Replacing the photo clears what you traced on it. Depth captures keep the photo, distances and coordinates lined up."/></p>
 <div class="row"><label class="file">Take / import photo<input type="file" accept="image/*" capture="environment" onchange={importPhoto} disabled={busy}/></label><button onclick={capture} disabled={!lidar||busy}>Capture RGB + depth</button></div>
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
 {#if mode==='corners'}<p class="lead">Tap the projected rectangle’s corners: <b>top left → top right → bottom right → bottom left</b>.<InfoTip label="About projector corners" text="These must be the projector’s own corners, not any corners in the room. Without a projector, save a draft and mark them later."/></p><label>Projector name<input bind:value={projectorName}/></label><div class="row"><label>Width<input type="number" min="2" max="16384" bind:value={width}/></label><label>Height<input type="number" min="2" max="16384" bind:value={height}/></label></div>
 {:else}<p class="lead">Tap around one flat surface, then add it.<InfoTip label="About tracing surfaces" text="Four-point calibration holds only on the same flat plane as the projector rectangle; surfaces at other depths need their own calibration."/></p>{/if}
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
 .am-stage .am-fixture{aspect-ratio:4/3;background:radial-gradient(circle at 50% 60%,#3a3f4a,#0b0d12 70%)}
 .depth-out{background:#05070b}
 .am-readout{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:14px 0 0}
 .am-readout div{display:grid;gap:2px;padding:4px 0;border-top:1px solid var(--ga-line-2)}
 .am-readout dt{font-size:12px;color:var(--ga-ink-2)}.am-readout dd{margin:0;font:600 17px/1.2 system-ui;font-variant-numeric:tabular-nums}
 .am-note{display:flex;align-items:center;gap:4px;font-size:12px;margin:10px 0 0}.am-note :global(.ga-info){margin:-12px 0}
 .am-actions .wide{flex:1}
 .am-depth-entry b{color:var(--ga-on-ink)}
 .am-handle{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2px solid #fff;background:var(--ga-blue,#5278ff);box-shadow:0 1px 8px #000c;pointer-events:none}
 .am-handle.held{transform:scale(1.35);background:#fff;border-color:var(--ga-blue,#5278ff)}
 .am-painting{display:grid;gap:3px;width:100%;margin-top:14px;padding:12px 14px;text-align:left;border-radius:10px;background:transparent;border:1px dashed var(--ga-line-3)}
 .am-painting b{font-size:13px;font-weight:600}.am-painting span{font-size:12px;color:var(--ga-ink-2)}
 .am-stage{position:relative;width:100%;background:#000;border-radius:10px;overflow:hidden;border:1px solid var(--ga-line-3)}
 .am-stage video,.am-stage .am-preview{display:block;width:100%;max-height:52vh;object-fit:contain;background:#000}
 .am-mode{display:grid;grid-template-columns:auto 1fr 1fr;gap:6px;align-items:center;margin-top:10px}
 .am-mode span{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ga-ink-2);padding-right:4px}
 .am-mode span b{display:grid;place-content:center;width:22px;height:22px;border-radius:50%;background:var(--ga-blue,#5278ff);color:#fff;font-size:12px}
 .am-mode button{min-height:44px;font-size:12px;border-radius:8px;background:transparent}
 .am-mode button.on{background:var(--ga-on-bg);border-color:var(--ga-on-line);color:var(--ga-on-ink)}
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
 .am-actions{display:flex;gap:10px;margin-top:16px}.am-actions .primary{flex:1;min-height:50px;font-weight:700;font-size:15px;border-radius:10px;background:var(--ga-act-bg);border-color:var(--ga-act-line);color:var(--ga-act-ink)}.am-actions .primary:disabled{opacity:.35}
 .quiet{background:transparent;border-color:var(--ga-line-3);border-radius:10px;padding:10px 16px}
 .am-summary{display:flex;justify-content:space-between;align-items:baseline;margin-top:14px}.am-summary strong{font-size:15px}.am-summary span{font-size:12px;color:var(--ga-ink-2)}
 .am-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
 .am-chip{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 12px 6px 6px;border-radius:20px;font-size:12px;color:var(--ga-ink-2);background:transparent}
 .am-chip b{display:grid;place-content:center;width:26px;height:26px;border-radius:50%;background:var(--ga-line-3);color:var(--ga-ink-0);font-size:12px}
 .am-chip.on{color:var(--ga-on-ink);border-color:var(--ga-on-line)}.am-chip.on b{background:var(--ga-blue,#5278ff);color:#fff}
 .am-hero{padding:6px 0 0}.am-lead{font-size:15px;line-height:1.5;color:var(--ga-ink-0);margin:8px 0 6px}.lead{margin:8px 0;color:var(--ga-ink-1)}.lead :global(.ga-info){vertical-align:middle;margin:-12px -6px -12px 0}
 .status.quiet{display:none}
 .manual{margin-top:26px;border-top:1px solid var(--ga-line-2);padding-top:6px}.manual summary{min-height:44px;display:flex;align-items:center;color:var(--ga-ink-2);font-size:12px;letter-spacing:.04em}
 section{padding:18px;font:13px/1.5 system-ui;color:var(--ga-ink-0)}header,.row,.item{display:flex;align-items:center;gap:8px;justify-content:space-between}header{gap:10px;margin:-6px 0 6px}header h2{flex:1}.row{flex-wrap:wrap;margin:12px 0}.row>*{flex:1;min-width:110px}h2{font-size:18px;font-weight:650;margin:0}h3{font-size:13px}p,.note{color:var(--ga-ink-2)}button,.file,input{box-sizing:border-box;min-height:44px;border:1px solid var(--ga-line-3);border-radius:5px;background:var(--ga-slot);color:inherit;padding:10px;font:inherit}button{touch-action:manipulation}button:disabled{opacity:.4}label{display:block;font-size:12px}input{display:block;width:100%;margin-top:4px}.file{cursor:pointer;font-size:13px}.file input{width:100%;font-size:12px}.primary{background:var(--ga-act-bg);border-color:var(--ga-act-line);color:var(--ga-act-ink);font-weight:700}.primary:disabled{background:var(--ga-slot);border-color:var(--ga-line-3);color:var(--ga-ink-1)}.active{background:var(--ga-on-bg);border-color:var(--ga-on-line);color:var(--ga-on-ink)}.photo{position:relative;width:100%;background:#000;touch-action:none;margin-top:12px;overflow:hidden}.photo img,.photo svg{position:absolute;width:100%;height:100%;inset:0;pointer-events:none}.photo img{object-fit:fill}polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2;vector-effect:non-scaling-stroke}.projector{stroke:#ffa45b;fill:#ffa45b15}polyline{fill:none;stroke:white;stroke-width:2;vector-effect:non-scaling-stroke}circle{fill:#ffa45b;stroke:#fff;stroke-width:2}text{fill:white;font-size:30px;font-weight:bold}.item{border-bottom:1px solid var(--ga-line-2);padding:8px 0}.item span{overflow-wrap:anywhere;min-width:0}.status{color:var(--ga-blue-200)}summary{min-height:44px;cursor:pointer;font-weight:bold}
</style>
