<script lang="ts">
 import {screens,screenActions} from '../../stores/screens';
 import {MAIN_OUTPUT_ID} from '../../stores/screenOutputStatus';
 import {recordDiscreteAction} from '../../stores/historyHooks';
 import {readMobileCalibration,type ImportedCalibration} from '../../output/mobileCalibrationImport';
 import {inverseProjectorHomography} from '../../output/projectorCalibration';
 import {project} from '../../stores/layers';
 import {mediaLibrary} from '../../stores/media';
 import {createAssetRefFromGeneratedBlob} from '../../storage/assetRegistry';
 import {traceShapes,type TracedShape} from '../../painting/vectorize';
 import {createShapeLayers,picturePixels} from '../../painting/paintingShapes';
 import {phoneMeshLayer} from '../../output/mobileMeshImport';
 import {lastAutoMapRun} from '../../output/autoMapDiagnostics';
 import {rasterToComposition,placementCaveats,type OutputPath} from '../../output/autoMapPlacement';
 import {settings,masterWarpIsActive} from '../../stores/settings';
 import type {Layer,MeshWarpGrid} from '../../types';
 import {invoke} from '../../bridge';
 // Surfaces the phone measured with the stripe scan: each outline is already
 // in its projector's own picture, so it becomes a layer pinned to that face.
 // A curved surface (measured with LiDAR) also brings a mesh and its edge in the layer's picture.
 // `surfaceId` (newer phones) names the outline on the photo; older ones only its name.
 // `imageWarp: 'perspective'` (newer phones): a painting's photo is cut for a true-perspective pin; without it, for the bilinear one.
 type MappedSurface={surfaceId?:string;name:string;screenId:string;screenName:string;points:{x:number;y:number}[];rmsPx:number;edgePx?:number;image?:string;imageWarp?:string;mesh?:unknown;contentOutline?:unknown};
 /** Layers an auto map made carry this, so a new scan replaces them whatever they are called now. */
 const PHONE_AUTO_MAP='phone-auto-map';
 /** Made by the last scan: tagged, or (from before the tag) named so. */
 const mappedLayer=(l:Layer)=>l.autoMap===PHONE_AUTO_MAP||(!l.autoMap&&l.name.endsWith('(mapped)'));
 const surfaceKey=(m:{surfaceId?:unknown;name:unknown})=>typeof m.surfaceId==='string'&&m.surfaceId?`id:${m.surfaceId}`:`name:${String(m.name)}`;
 // A painting's photo travels as a JPEG or PNG data URL: nothing else is accepted, and not above 6 MB.
 const pictureOf=(m:MappedSurface)=>typeof m.image==='string'&&m.image.length<8_500_000&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(m.image)?m.image:'';
 $: mappedSurfaces=(()=>{try{const list=JSON.parse(incoming||'{}').mappedSurfaces;return Array.isArray(list)?list.filter((m:any)=>Array.isArray(m?.points)&&m.points.length>=3&&m.points.every((p:any)=>Number.isFinite(p?.x)&&Number.isFinite(p?.y))) as MappedSurface[]:[];}catch{return [] as MappedSurface[];}})();
 let createdFor='';
 // The photo and each surface's outline on it, for showing what was found.
 $: scene=(()=>{try{const c=JSON.parse(incoming||'{}');const image=typeof c?.reference?.image==='string'&&/^data:image\/(jpeg|png);base64,/.test(c.reference.image)?c.reference.image:'';
   // Each outline under both its id and its name: a surface sent with its id is matched by id, an older one by name.
   const outlines=new Map<string,{x:number;y:number}[]>();
   for(const o of (Array.isArray(c?.surfaces)?c.surfaces:[]).filter((s:any)=>Array.isArray(s?.points))){outlines.set(`name:${String(o.name)}`,o.points);if(typeof o.id==='string')outlines.set(`id:${o.id}`,o.points);}
   return{image,width:Number(c?.reference?.width)||16,height:Number(c?.reference?.height)||9,outlines};}catch{return{image:'',width:16,height:9,outlines:new Map<string,{x:number;y:number}[]>()};}})();
 let off=new Set<number>(),hover=-1,replaceOld=true,pickedFor='';
 /** Each layer the last Create made, and the outline on the photo it was measured from (for Verify). */
 let verifyKeys=new Map<string,string>();
 $: if(incoming!==pickedFor){pickedFor=incoming;off=new Set();hover=-1;}
 const flip=(i:number)=>{if(off.has(i))off.delete(i);else off.add(i);off=off;};
 $: chosen=mappedSurfaces.filter((_,i)=>!off.has(i)).length;
 // 0.4 of a stripe is the best a scan can report; well past that means the surface is not flat or moved.
 const quality=(rms:number)=>rms<17?'Clean':rms<26?'Fair':'Rough';
 // Newer phones also send how far the stripe edges on the face land from its fitted plane (sub-pixel when the face is flat and the phone held still).
 const fitQuality=(m:MappedSurface)=>{const e=Number(m.edgePx);if(Number.isFinite(e)&&e>=0)return{label:e<1.5?'Clean':e<4?'Fair':'Rough',px:` ±${e.toFixed(1)} px`,title:`Stripe edges land ${e.toFixed(2)} projector pixels (RMS) from this face's fitted plane`};const r=Number(m.rmsPx);return{label:quality(r),px:'',title:`Fit ${r.toFixed(1)} projector pixels`};};
 const centre=(points:{x:number;y:number}[])=>({x:points.reduce((t,p)=>t+p.x,0)/points.length*100,y:points.reduce((t,p)=>t+p.y,0)/points.length*100});
 let creating=false;
 // Cutting the painting into shapes: its patches of colour, each one a mapping layer.
 let paintingLayer='',paintingSrc='',detail=0.35,shapes:TracedShape[]=[],tracing=false,shaping=false,shapesMade=0,shapeNote='';
 let pixels:{data:Uint8ClampedArray;width:number;height:number}|null=null,pixelsFor='';
 async function retrace(){
  if(!paintingSrc)return;
  tracing=true;
  try{
   if(pixelsFor!==paintingSrc){pixels=await picturePixels(paintingSrc);pixelsFor=paintingSrc;}
   if(pixels)shapes=traceShapes(pixels.data,pixels.width,pixels.height,{detail,maxShapes:600});
   shapeNote='';
  }catch(e){shapes=[];shapeNote=e instanceof Error?e.message:'The picture could not be read.';}
  finally{tracing=false;}
 }
 $: if(paintingSrc){detail;void retrace();}
 async function makeShapes(){
  if(shaping||!shapes.length||!paintingLayer)return;shaping=true;
  try{shapesMade=await createShapeLayers(shapes,paintingLayer);shapeNote=`${shapesMade} shape layers created over the painting. Open Stage to run effects across them.`;}
  catch(e){shapeNote=e instanceof Error?e.message:'The shapes could not be created.';}
  finally{shaping=false;}
 }
 async function createLayers(){
  if(creating)return;creating=true;
  try{await createLayersNow();}finally{creating=false;}
 }
 /** The output a surface was measured on, as the picture reaches it: the main output's crop and turn, or the Screen's crop, turn and warp, under the Master Warp. */
 function outputPathOf(surface:MappedSurface):{path:OutputPath;screen?:typeof $screens[number]}{
  const out=$settings.output;
  const masterWarp=out?.masterWarp&&masterWarpIsActive(out.masterWarp)?{enabled:true,mode:out.masterWarp.mode??'corners',corners:out.masterWarp.corners??null,meshGrid:out.masterWarp.meshGrid??null}:null;
  // Measured on the main output (no Screen was open): the composition through the output's own crop and turn.
  const screen=surface.screenId===MAIN_OUTPUT_ID?undefined:$screens.find(s=>s.id===surface.screenId)??$screens.find(s=>s.name===surface.screenName)??($screens.length===1?$screens[0]:undefined);
  if(!screen)return{path:{crop:{x:out?.outputCropX??0,y:out?.outputCropY??0,w:out?.outputCropWidth??1,h:out?.outputCropHeight??1},rotation:out?.outputRotation??0,masterWarp}};
  return{screen,path:{crop:{x:screen.cropX??0,y:screen.cropY??0,w:screen.cropW??1,h:screen.cropH??1},rotation:screen.rotation??0,warpMode:screen.warpMode??'rect',corners:screen.corners??null,meshGrid:screen.meshGrid??null,masterWarp}};
 }
 /** True when the output shows the composition straight (crop only): the old placement, and a curved mesh is placed as before. */
 const plainPath=(p:OutputPath)=>!((((p.rotation??0)%360)+360)%360)&&(p.warpMode??'rect')==='rect'&&!p.masterWarp?.enabled;
 /** A curved surface's mesh carried through a turned or warped output: every point and handle moved into the composition. */
 function meshThrough(fields:NonNullable<ReturnType<typeof phoneMeshLayer>>,path:OutputPath):NonNullable<ReturnType<typeof phoneMeshLayer>>|null{
  const to=(p:{x:number;y:number})=>rasterToComposition({x:p.x,y:1-p.y},path);
  const grid=fields.meshGrid;
  const points=grid.points.map(row=>row.map(to));
  if(points.some(row=>row.some(p=>!p)))return null;
  const meshGrid:MeshWarpGrid={...grid,points:points as {x:number;y:number}[][]};
  // Handles are offsets: carry the point and the point plus the handle, and keep the difference.
  if(grid.tangents)meshGrid.tangents=grid.tangents.map((row,r)=>row.map((t,c)=>{if(!t)return t;const base=points[r][c]!,moved=(o?:{x:number;y:number})=>{if(!o)return undefined;const q=to({x:grid.points[r][c].x+o.x,y:grid.points[r][c].y+o.y});return q?{x:q.x-base.x,y:q.y-base.y}:undefined;};return{...t,right:moved(t.right),down:moved(t.down),left:moved(t.left),up:moved(t.up)};}));
  return{...fields,corners:{topLeft:{x:0,y:1},topRight:{x:1,y:1},bottomRight:{x:1,y:0},bottomLeft:{x:0,y:0}},meshGrid};
 }
 async function createLayersNow(){
  let made=0,skipped=0,straightened=false,pictures=0,pictureFailed=false,meshes=0,shaped=0,outside=0;
  const caveats=new Set<string>();
  // A new scan replaces the layers the last one made, unless asked to keep them.
  if(replaceOld)for(const layer of $project.layers.filter(mappedLayer))project.removeLayer(layer.id);
  for(const [index,surface] of mappedSurfaces.entries()){
   if(off.has(index))continue;
   const {path,screen}=outputPathOf(surface);
   for(const note of placementCaveats(path))caveats.add(`${screen?.name??'The output'}: ${note}`);
   // The surfaces were measured in the projector's own picture. A whole-Screen
   // corner correction would move every layer off its surface, so it goes off.
   if(screen?.projectorCalibration?.enabled){screenActions.update(screen.id,{projectorCalibration:{...screen.projectorCalibration,enabled:false}});straightened=true;}
   // Projector picture -> composition, through the output's crop, turn and warps (layer corners, y up).
   const placed=surface.points.map(p=>rasterToComposition(p,path));
   if(placed.some(p=>!p)){outside++;continue;}
   const at=placed as {x:number;y:number}[];
   // A curved surface: the picture follows it through a mesh and is masked to its edge
   // ('fill' keeps the native mask a plain cut). Anything malformed falls back to the corners.
   const crop=path.crop;
   let curved=phoneMeshLayer(surface,plainPath(path)?crop:{x:0,y:0,w:1,h:1});
   if(curved&&!plainPath(path))curved=meshThrough(curved,path);
   const picture=pictureOf(surface);
   if(!curved&&at.length!==4&&at.length<3){skipped++;continue;}
   const id=project.addLayer(`${surface.name} (mapped)`,'media');
   const layerId=id;if(!layerId){skipped++;continue;}
   project.updateLayer(layerId,{autoMap:PHONE_AUTO_MAP});
   if(curved){project.updateLayer(layerId,{warpMode:'mesh',...curved,contentFit:'fill'});meshes++;}
   else if(at.length===4){
    const [topLeft,topRight,bottomRight,bottomLeft]=at;
    // A flat face: a plain four-corner pin (four handles), drawn as a true perspective so the inside lands too.
    // A painting's photo from an older phone was cut for the bilinear pin: it keeps that pin, or it would be warped twice.
    const perspective=!picture||surface.imageWarp==='perspective';
    project.updateLayer(layerId,{warpMode:'corners',corners:{topLeft,topRight,bottomRight,bottomLeft},cornerPerspective:perspective});
   }else{
    // Not four corners (a traced outline): the layer covers the outline's box and is masked to the outline.
    const xs=at.map(p=>p.x),ys=at.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
    const w=Math.max(1e-6,x1-x0),h=Math.max(1e-6,y1-y0);
    const step=Math.ceil(at.length/32);
    project.updateLayer(layerId,{warpMode:'corners',corners:{topLeft:{x:x0,y:y1},topRight:{x:x1,y:y1},bottomRight:{x:x1,y:y0},bottomLeft:{x:x0,y:y0}},
     layerShape:{type:'custom',enabled:true,params:{customPoints:at.filter((_,i)=>i%step===0).map(p=>({x:(p.x-x0)/w,y:(p.y-y0)/h})),customClosed:true,customShapeFit:'mask',feather:0.002,rotation:0}}} as Partial<Layer>);
    shaped++;
   }
   made++;
   // A painting arrives with its own photo, cut to land exactly on it: put that on the layer.
   if(picture){
    try{
     const blob=await (await fetch(picture)).blob();
     const name=`painting-${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`;
     const captured=await createAssetRefFromGeneratedBlob(blob,name,blob.type||'image/jpeg');
     const item={id:crypto.randomUUID(),name,src:captured.runtimeUrl,type:'image' as const,thumbnail:captured.runtimeUrl,_assetRef:captured.assetRef};
     mediaLibrary.addItem(item);
     project.setLayerSource(layerId,{id:item.id,type:'image',src:item.src,name:item.name,_assetRef:item._assetRef});
     pictures++;paintingLayer=layerId;paintingSrc=picture;
    }catch{pictureFailed=true;}
   }
   verifyKeys.set(layerId,surfaceKey(surface));
  }
  verifyKeys=verifyKeys;
  recordDiscreteAction();createdFor=incoming;
  message=`${made} layer${made===1?'':'s'} created and pinned in place.${meshes?` ${meshes===made?(meshes===1?'It follows':'They follow'):meshes===1?'One follows':`${meshes} follow`} a curved surface with a mesh, masked to its edge.`:''}${shaped?` ${shaped===1?'One outline that is not four corners is':`${shaped} outlines that are not four corners are`} masked to ${shaped===1?'its':'their'} shape.`:''}${skipped?` ${skipped} skipped.`:''}${outside?` ${outside} left out: ${outside===1?'it falls':'they fall'} outside what the output shows of the composition.`:''} ${pictures?`The painting’s photo is on its layer, lined up and cropped: add effects to it.`:'Drop a shader or video on each one.'}${pictureFailed?' The photo could not be saved; the layer is in place without it.':''}${straightened?' The Screen’s own corner correction was turned off so the layers sit where they were measured.':''}${caveats.size?` Approximate: ${[...caveats].join('; ')}.`:''}`;
 }
 // Verification: each mapped layer shows a checker in its own colour with a white edge, the phone
 // photographs it from where it scanned, and both photos (plain and with the measured outlines) are kept
 // beside the run's diagnostics. Misalignment shows at a glance; the same photo feeds Tighten later.
 const VERIFY_COLOURS=['#4da3ff','#ff7a45','#36cfc9','#ffc53d','#9254de','#73d13d','#f759ab','#ffa940'];
 let verifying=false,verifyNote='',verifyShot='';
 function checker(colour:string):Promise<Blob>{
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d')!;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){g.fillStyle=(x+y)%2?'#000':colour;g.fillRect(x*64,y*64,64,64);}
  g.strokeStyle='#fff';g.lineWidth=16;g.strokeRect(8,8,496,496);
  return new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(new Error('No picture')),'image/png'));
 }
 // The checkers are made once and reused, outside the media library: they are a passing test picture, not media.
 const checkerSources=new Map<string,{src:string;assetRef:unknown}>();
 async function checkerSource(colour:string){
  let made=checkerSources.get(colour);
  if(!made){const blob=await checker(colour);const ref=await createAssetRefFromGeneratedBlob(blob,`auto-map-verify-${colour.slice(1)}.png`,'image/png');made={src:ref.runtimeUrl,assetRef:ref.assetRef};checkerSources.set(colour,made);}
  return made;
 }
 /** The phone's photo with each verified layer's measured outline, in that layer's checker colour. */
 async function outlined(image:string,width:number,height:number,shown:{key:string;colour:string}[]):Promise<string>{
  const img=new Image();img.src=image;await img.decode();
  const c=document.createElement('canvas');c.width=img.naturalWidth||width;c.height=img.naturalHeight||height;const g=c.getContext('2d')!;g.drawImage(img,0,0,c.width,c.height);
  g.lineWidth=Math.max(2,c.width/500);
  for(const {key,colour} of shown){const o=scene.outlines.get(key);if(!o)continue;g.strokeStyle=colour;g.beginPath();o.forEach((p,k)=>k?g.lineTo(p.x*c.width,p.y*c.height):g.moveTo(p.x*c.width,p.y*c.height));g.closePath();g.stroke();}
  return c.toDataURL('image/jpeg',0.88);
 }
 async function verifyWithPhone(){
  const remote=(window as any).__gaAutoMap;
  if(verifying)return;
  if(!remote?.camera){verifyNote='Keep the phone where it scanned, on its results screen (its camera stays on for 5 minutes), then try again.';return;}
  // Only the layers this scan made that are still there; each with the outline it was measured from.
  const layers=$project.layers.filter(l=>verifyKeys.has(l.id));
  if(!layers.length){verifyNote='None of the layers from this scan are left to verify.';return;}
  verifying=true;verifyNote='Showing the checkers…';
  const before=new Map(layers.map(l=>[l.id,(l as any).source??null]));
  const shown=layers.map((l,i)=>({key:verifyKeys.get(l.id)!,colour:VERIFY_COLOURS[i%VERIFY_COLOURS.length]}));
  try{
   for(const [i,layer] of layers.entries()){
    const checker=await checkerSource(shown[i].colour);
    project.setLayerSource(layer.id,{id:`auto-map-verify-${i}`,type:'image',src:checker.src,name:'Verify checker',_assetRef:checker.assetRef as any},{history:false});
   }
   await new Promise(r=>setTimeout(r,1200));
   verifyNote='Photographing from the phone…';
   const frame=await remote.grab();
   if(typeof frame?.image!=='string')throw new Error('The phone sent no photo.');
   const overlay=await outlined(frame.image,Number(frame.width)||0,Number(frame.height)||0,shown);
   verifyShot=overlay;
   const stamp=$lastAutoMapRun?.stamp??new Date().toISOString().replace(/[:.]/g,'-');
   await invoke('save_automap_diagnostics',{stamp,files:{'verify.jpg':frame.image,'verify-overlay.jpg':overlay},summary:`verification shot: ${layers.length} mapped layers as checkers`}).catch(()=>{});
   verifyNote='Saved. Coloured outlines are where the phone measured each face: each checker should fill its outline exactly.';
  }catch(e){verifyNote=e instanceof Error?e.message:'The verification failed.';}
  finally{for(const layer of layers)project.setLayerSource(layer.id,before.get(layer.id)??null,{history:false});verifying=false;}
 }
 export let incoming='';
 let seen='';
 $: if(incoming&&incoming!==seen){seen=incoming;try{data=readMobileCalibration(incoming);projector=surface=0;message='Received from phone. Review before applying to an output.';}catch(e){data=null;message=mappedSurfaces.length?'':(e as Error).message;}}
 let data:ImportedCalibration|null=null,message='',projector=0,surface=0,target='';
 // Pick the Screen this projector was measured on: the one with its name, or the only Screen there is.
 $: if(data&&!target){const named=$screens.find(s=>s.name===data?.projectors[projector]?.name);target=named?.id??($screens.length===1?$screens[0].id:'');}
 $: candidate=data?.projectors[projector];
 $: shape=candidate?.surfaces[surface];
 async function load(e:Event){const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;try{if(file.size>25_000_000)throw Error('Calibration exceeds 25 MB.');data=readMobileCalibration(await file.text());projector=surface=0;message='Review the surface and assign the matching physical projector output.';}catch(e){data=null;message=(e as Error).message;}(e.target as HTMLInputElement).value='';}
 // Only corners the output stage will draw are applied: anything else would black out the projector.
 function apply(){if(!shape?.corners||!inverseProjectorHomography(shape.corners)||!$screens.some(s=>s.id===target))return;screenActions.update(target,{projectorCalibration:{enabled:true,corners:shape.corners.map(p=>({...p}))}});recordDiscreteAction();message='Output geometry applied. Verify a grid on the physical surface, then save the project. Source crop and blending were preserved.';}
</script>
<section>{#if mappedSurfaces.length}<div class="am">
 <header><small>AUTO MAP</small><h2>{mappedSurfaces.length} surface{mappedSurfaces.length===1?'':'s'} found</h2><p>Measured by the phone on {mappedSurfaces[0].screenName}. Each one becomes a media layer pinned to its surface.</p></header>
 <div class="am-body">
  {#if scene.image}<div class="am-photo" style:aspect-ratio={`${scene.width}/${scene.height}`}>
   <img src={scene.image} alt="The scanned scene"/>
   <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{#each mappedSurfaces as m,i}{@const o=scene.outlines.get(surfaceKey(m))}{#if o}<polygon class:off={off.has(i)} class:hot={hover===i} points={o.map(p=>`${p.x*100},${p.y*100}`).join(' ')}/>{/if}{/each}</svg>
   {#each mappedSurfaces as m,i}{@const o=scene.outlines.get(surfaceKey(m))}{#if o}{@const c=centre(o)}<button class="am-tag" class:off={off.has(i)} class:hot={hover===i} style:left={`${c.x}%`} style:top={`${c.y}%`} onclick={()=>flip(i)} onmouseenter={()=>hover=i} onmouseleave={()=>hover=-1} aria-pressed={!off.has(i)} aria-label={`${m.name}: ${off.has(i)?'off':'on'}`}>{i+1}</button>{/if}{/each}
  </div>{/if}
  <div class="am-side">
   <ul>{#each mappedSurfaces as m,i}<li class:off={off.has(i)} class:hot={hover===i} onmouseenter={()=>hover=i} onmouseleave={()=>hover=-1}>
    <label><input type="checkbox" checked={!off.has(i)} onchange={()=>flip(i)}/><b>{i+1}</b><span>{m.name}{pictureOf(m)?' · with its photo':''}{m.mesh?' · curved, meshed':''}</span></label>
    <em class={fitQuality(m).label.toLowerCase()} title={fitQuality(m).title}>{fitQuality(m).label}{fitQuality(m).px}</em></li>{/each}</ul>
   <label class="am-option"><input type="checkbox" bind:checked={replaceOld}/>Replace layers from the last scan</label>
   <button class="am-go" onclick={createLayers} disabled={!chosen||creating||createdFor===incoming}>{createdFor===incoming?'Layers created':`Create ${chosen} layer${chosen===1?'':'s'}`}</button>
   <p class="am-status" role="status">{message}</p>
   {#if createdFor===incoming}<button class="am-go" onclick={verifyWithPhone} disabled={verifying}>{verifying?'Verifying…':'Verify with the phone'}</button>
    {#if verifyNote}<p class="am-status" role="status">{verifyNote}</p>{/if}
    {#if verifyShot}<img class="am-verify" src={verifyShot} alt="The phone's view of the checkers, with the measured outlines"/>{/if}{/if}
  </div>
 </div>
 {#if paintingSrc}<div class="am-shapes">
  <header><small>SHAPES</small><h3>Cut the painting into shapes</h3><p>Each patch of color becomes its own mapping layer. Less detail gives a few broad shapes; more gives many small ones.</p></header>
  <div class="am-shapes-body">
   <div class="am-shapes-view"><img src={paintingSrc} alt="The painting"/>
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{#each shapes as shape}<polygon points={shape.points.map(p=>`${p.x},${p.y}`).join(' ')}/>{/each}</svg></div>
   <div class="am-shapes-side">
    <label class="am-detail"><span>Detail</span><input type="range" min="0" max="1" step="0.01" bind:value={detail} aria-label="Shape detail"/></label>
    <p class="am-count"><b>{shapes.length}</b> shape{shapes.length===1?'':'s'}{tracing?' …':''}</p>
    <button class="am-go" onclick={makeShapes} disabled={!shapes.length||shaping||shapesMade>0}>{shapesMade?'Shapes created':shaping?'Creating…':`Create ${shapes.length} shape layer${shapes.length===1?'':'s'}`}</button>
    <p class="am-status" role="status">{shapeNote}</p>
   </div>
  </div>
 </div>{/if}
 </div>
{:else}<h2>Phone calibration import</h2><p>In the mobile app, open Tools → Projector calibration. Capture a projected rectangle, mark its corners in TL / TR / BR / BL order, then trace the desired flat surface in that same order. Export and open the file here.</p><input aria-label="Import phone calibration" type="file" accept=".json,.ghostcal" onchange={load}/>
{#if data}<h3>{data.name}</h3><img src={data.image} alt="Calibration reference photograph"/><div class="fields"><label>Measured projector<select bind:value={projector} onchange={()=>surface=0}>{#each data.projectors as p,i}<option value={i}>{p.name} · {p.width} × {p.height}</option>{/each}</select></label><label>Traced surface<select bind:value={surface}>{#each candidate?.surfaces??[] as s,i}<option value={i}>{s.name}</option>{/each}</select></label><label>Physical output<select bind:value={target}><option value="">Choose a screen</option>{#each $screens as s}<option value={s.id}>{s.name}</option>{/each}</select></label></div>
<svg viewBox="-0.1 -0.1 1.2 1.2" aria-label="Proposed projector raster geometry"><rect x="0" y="0" width="1" height="1" fill="#070b10" stroke="var(--ga-blue-mute-300)" stroke-width=".004"/><polygon points={(shape?.corners??shape?.points??[]).map(p=>`${p.x},${p.y}`).join(' ')} fill="var(--ga-blue-a28)" stroke="var(--ga-blue-300)" stroke-width=".008"/>{#if shape?.corners}<circle cx={shape.corners[0].x} cy={shape.corners[0].y} r=".03" fill="#ffd45c"><title>Top left of the picture</title></circle>{/if}</svg>
{#if shape?.corners&&shape.reordered}<p class="warn">The surface was not traced top left, top right, bottom right, bottom left as this projector sees it, so its corners were put in that order. The picture will be upright in the projector's raster, with its top left at the yellow dot. For a turned surface use the Screen's Rotation.</p>{/if}
{#if candidate?.mirrored}<p class="warn">This projector's corners run counterclockwise in the photo: a mirrored or rear-projection view, or corners marked out of order. Check the result on the surface before relying on it.</p>{/if}
{#if !shape?.corners}<p role="alert">Choose a convex four-corner surface within the supported projector raster. Polygons and non-planar objects cannot be applied as a corner calibration.</p>{/if}<button disabled={!target||!shape?.corners} onclick={apply}>Apply geometry to selected output</button>{/if}<p class="note">This is a planar photo calibration. Match the selected display’s resolution to the measured projector. Depth measurements do not make this an automatic 3D projector solve. Verify alignment at the venue; overlap blending remains a separate step.</p>{/if}
{#if !mappedSurfaces.length}<p role="status">{message}</p>{/if}</section>
<style>
 .am-verify{width:100%;border-radius:8px;margin-top:8px}
 .am header small{font-size:var(--ga-text-eyebrow,10px);font-weight:700;letter-spacing:var(--ga-eyebrow-tracking,.08em);color:var(--ga-ink-2)}.am header h2{margin:4px 0 6px;font-size:var(--ga-text-display,20px);font-weight:var(--ga-weight-title,650)}.am header p{margin:0;color:var(--ga-ink-1);max-width:60ch}
 .am-body{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:28px;margin-top:22px;align-items:start}
 @media (max-width:820px){.am-body{grid-template-columns:1fr}}
 .am-photo{position:relative;border-radius:var(--ga-r-tile,7px);overflow:hidden;background:#000;border:1px solid var(--ga-line-2)}
 .am-photo img,.am-photo svg{position:absolute;inset:0;width:100%;height:100%;display:block;max-height:none}
 .am-photo polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2;vector-effect:non-scaling-stroke;transition:fill .12s}
 .am-photo polygon.hot{fill:var(--ga-blue-a28);stroke:#fff}.am-photo polygon.off{fill:transparent;stroke:#ffffff55;stroke-dasharray:6 5}
 .am-tag{position:absolute;transform:translate(-50%,-50%);min-width:24px;min-height:24px;height:24px;padding:0 7px;border:0;border-radius:12px;background:var(--ga-blue,#5278ff);color:#fff;font:600 12px/24px system-ui;cursor:pointer;box-shadow:0 1px 6px #000a}
 .am-tag.off{background:#000b;color:#fff8}.am-tag.hot{outline:2px solid #fff}
 .am-side ul{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:2px;max-height:46vh;overflow:auto}
 .am-side li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 10px 2px 4px;border-radius:7px}.am-side li.hot{background:var(--ga-sub)}.am-side li.off span{color:var(--ga-ink-3)}
 .am-side li label{display:flex;align-items:center;gap:10px;margin:0;min-height:38px;flex:1;cursor:pointer}
 .am-side li b{display:grid;place-content:center;width:22px;height:22px;border-radius:50%;background:var(--ga-raise);font-size:var(--ga-text-meta,11px)}
 .am-side input[type=checkbox]{min-height:0;width:16px;height:16px;padding:0;accent-color:var(--ga-blue,#5278ff)}
 .am-side em{font-style:normal;font-size:var(--ga-text-meta,11px);font-weight:600;padding:2px 8px;border-radius:var(--ga-r-hard,5px);border:1px solid transparent}
 .am-side em.clean{color:#7fe0b0;border-color:#7fe0b044}.am-side em.fair{color:#f0c674;border-color:#f0c67444}.am-side em.rough{color:#ff8f7a;border-color:#ff8f7a44}
 .am-option{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:var(--ga-ink-1);font-size:var(--ga-text-body,13px);cursor:pointer}
 .am-go{width:100%;min-height:36px;border:1px solid var(--ga-violet-line,var(--ga-line-3));border-radius:var(--ga-r-soft,8px);background:var(--ga-accent-gradient,var(--ga-ink-0));color:var(--ga-void,#0a0908);font-weight:var(--ga-weight-control,600);font-size:var(--ga-text-body,13px);cursor:pointer}.am-go:disabled{opacity:.4;cursor:default}
 .am-status{min-height:1.6em;margin:12px 0 0;font-size:var(--ga-text-control,12px);color:var(--ga-ink-1)}
section{padding:20px 24px;color:var(--ga-ink-0);font:var(--ga-text-body,13px)/1.6 var(--ga-font-ui,system-ui)}h2{margin-top:0}img{display:block;max-height:260px;max-width:100%;object-fit:contain;background:#000}.fields{display:flex;gap:16px;flex-wrap:wrap}label{display:grid;gap:5px;margin:16px 0;flex:1}select,button,input{font:inherit;color:inherit;background:var(--ga-slot);border:1px solid var(--ga-line-2);border-radius:var(--ga-r-hard,5px);padding:4px 10px;min-height:30px;max-width:100%}button:disabled{opacity:.4}svg{width:240px;height:240px;display:block}.note{color:var(--ga-ink-2);font-size:var(--ga-text-meta,11px)}p[role=status]{color:var(--ga-ink-1)}.warn{color:#f0c674} .am-shapes{margin-top:18px;padding-top:16px;border-top:1px solid var(--ga-line,rgba(255,255,255,.08))}
 .am-shapes header small{font-size:var(--ga-text-eyebrow,10px);font-weight:700;line-height:1;letter-spacing:var(--ga-eyebrow-tracking,.08em);color:var(--ga-ink-2)}
 .am-shapes header h3{margin:6px 0 4px;font-size:var(--ga-text-title,14px);font-weight:var(--ga-weight-title,650)}
 .am-shapes header p{margin:0 0 12px;font-size:12px;color:var(--ga-ink-2,#a9b2bd);max-width:60ch}
 .am-shapes-body{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(200px,1fr);gap:16px;align-items:start}
 .am-shapes-view{position:relative;border-radius:6px;overflow:hidden;background:#000;line-height:0}
 .am-shapes-view img{width:100%;height:auto;display:block;opacity:.85}
 .am-shapes-view svg{position:absolute;inset:0;width:100%;height:100%}
 .am-shapes-view polygon{fill:rgba(255,255,255,.04);stroke:#fff;stroke-width:1;vector-effect:non-scaling-stroke;stroke-opacity:.85}
 .am-shapes-side{display:flex;flex-direction:column;gap:10px}
 .am-detail{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--ga-ink-2,#a9b2bd)}
 .am-detail input{width:100%}
 .am-count{margin:0;font-size:12px;color:var(--ga-ink-2,#a9b2bd)}
 .am-count b{font-size:var(--ga-text-display,20px);color:var(--ga-ink-0,#fff);margin-right:4px}
</style>
