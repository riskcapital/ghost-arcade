<script lang="ts">
 import {screens,screenActions} from '../../stores/screens';
 import {recordDiscreteAction} from '../../stores/historyHooks';
 import {readMobileCalibration,type ImportedCalibration} from '../../output/mobileCalibrationImport';
 import {inverseProjectorHomography} from '../../output/projectorCalibration';
 import {project} from '../../stores/layers';
 import {mediaLibrary} from '../../stores/media';
 import {createAssetRefFromGeneratedBlob} from '../../storage/assetRegistry';
 // Surfaces the phone measured with the stripe scan: each outline is already
 // in its projector's own picture, so it becomes a layer pinned to that face.
 type MappedSurface={name:string;screenId:string;screenName:string;points:{x:number;y:number}[];rmsPx:number;image?:string};
 // A painting's photo travels as a JPEG or PNG data URL: nothing else is accepted, and not above 6 MB.
 const pictureOf=(m:MappedSurface)=>typeof m.image==='string'&&m.image.length<8_500_000&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(m.image)?m.image:'';
 $: mappedSurfaces=(()=>{try{const list=JSON.parse(incoming||'{}').mappedSurfaces;return Array.isArray(list)?list.filter((m:any)=>Array.isArray(m?.points)&&m.points.length>=3&&m.points.every((p:any)=>Number.isFinite(p?.x)&&Number.isFinite(p?.y))) as MappedSurface[]:[];}catch{return [] as MappedSurface[];}})();
 let createdFor='';
 // The photo and each surface's outline on it, for showing what was found.
 $: scene=(()=>{try{const c=JSON.parse(incoming||'{}');const image=typeof c?.reference?.image==='string'&&/^data:image\/(jpeg|png);base64,/.test(c.reference.image)?c.reference.image:'';
   const outlines=new Map<string,{x:number;y:number}[]>((Array.isArray(c?.surfaces)?c.surfaces:[]).filter((s:any)=>Array.isArray(s?.points)).map((s:any)=>[String(s.name),s.points]));
   return{image,width:Number(c?.reference?.width)||16,height:Number(c?.reference?.height)||9,outlines};}catch{return{image:'',width:16,height:9,outlines:new Map<string,{x:number;y:number}[]>()};}})();
 let off=new Set<number>(),hover=-1,replaceOld=true,pickedFor='';
 $: if(incoming!==pickedFor){pickedFor=incoming;off=new Set();hover=-1;}
 const flip=(i:number)=>{if(off.has(i))off.delete(i);else off.add(i);off=off;};
 $: chosen=mappedSurfaces.filter((_,i)=>!off.has(i)).length;
 // 0.4 of a stripe is the best a scan can report; well past that means the surface is not flat or moved.
 const quality=(rms:number)=>rms<17?'Clean':rms<26?'Fair':'Rough';
 const centre=(points:{x:number;y:number}[])=>({x:points.reduce((t,p)=>t+p.x,0)/points.length*100,y:points.reduce((t,p)=>t+p.y,0)/points.length*100});
 let creating=false;
 async function createLayers(){
  if(creating)return;creating=true;
  try{await createLayersNow();}finally{creating=false;}
 }
 async function createLayersNow(){
  let made=0,skipped=0,straightened=false,pictures=0,pictureFailed=false;
  // A new scan replaces the layers the last one made, unless asked to keep them.
  if(replaceOld)for(const layer of $project.layers.filter(l=>l.name.endsWith('(mapped)')))project.removeLayer(layer.id);
  for(const [index,surface] of mappedSurfaces.entries()){
   if(off.has(index))continue;
   if(surface.points.length!==4){skipped++;continue;}
   // Projector picture -> composition, through the part of it the Screen shows.
   const screen=$screens.find(s=>s.id===surface.screenId)??$screens.find(s=>s.name===surface.screenName)??($screens.length===1?$screens[0]:undefined);
   // The surfaces were measured in the projector's own picture. A whole-Screen
   // corner correction would move every layer off its surface, so it goes off.
   if(screen?.projectorCalibration?.enabled){screenActions.update(screen.id,{projectorCalibration:{...screen.projectorCalibration,enabled:false}});straightened=true;}
   const crop={x:screen?.cropX??0,y:screen?.cropY??0,w:screen?.cropW??1,h:screen?.cropH??1};
   const [topLeft,topRight,bottomRight,bottomLeft]=surface.points.map(p=>({x:crop.x+p.x*crop.w,y:1-(crop.y+p.y*crop.h)}));
   const id=project.addLayer(`${surface.name} (mapped)`,'media');
   const layerId=id;if(!layerId){skipped++;continue;}
   project.updateLayer(layerId,{warpMode:'corners',corners:{topLeft,topRight,bottomRight,bottomLeft}});made++;
   // A painting arrives with its own photo, cut to land exactly on it: put that on the layer.
   const picture=pictureOf(surface);
   if(picture){
    try{
     const blob=await (await fetch(picture)).blob();
     const name=`painting-${new Date().toISOString().replace(/[:.]/g,'-')}.jpg`;
     const captured=await createAssetRefFromGeneratedBlob(blob,name,blob.type||'image/jpeg');
     const item={id:crypto.randomUUID(),name,src:captured.runtimeUrl,type:'image' as const,thumbnail:captured.runtimeUrl,_assetRef:captured.assetRef};
     mediaLibrary.addItem(item);
     project.setLayerSource(layerId,{id:item.id,type:'image',src:item.src,name:item.name,_assetRef:item._assetRef});
     pictures++;
    }catch{pictureFailed=true;}
   }
  }
  recordDiscreteAction();createdFor=incoming;
  message=`${made} layer${made===1?'':'s'} created and pinned in place.${skipped?` ${skipped} skipped: only four-corner surfaces can be pinned.`:''} ${pictures?`The painting’s photo is on its layer, lined up and cropped: add effects to it.`:'Drop a shader or video on each one.'}${pictureFailed?' The photo could not be saved; the layer is in place without it.':''}${straightened?' The Screen’s own corner correction was turned off so the layers sit where they were measured.':''}`;
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
   <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{#each mappedSurfaces as m,i}{@const o=scene.outlines.get(m.name)}{#if o}<polygon class:off={off.has(i)} class:hot={hover===i} points={o.map(p=>`${p.x*100},${p.y*100}`).join(' ')}/>{/if}{/each}</svg>
   {#each mappedSurfaces as m,i}{@const o=scene.outlines.get(m.name)}{#if o}{@const c=centre(o)}<button class="am-tag" class:off={off.has(i)} class:hot={hover===i} style:left={`${c.x}%`} style:top={`${c.y}%`} onclick={()=>flip(i)} onmouseenter={()=>hover=i} onmouseleave={()=>hover=-1} aria-pressed={!off.has(i)} aria-label={`${m.name}: ${off.has(i)?'off':'on'}`}>{i+1}</button>{/if}{/each}
  </div>{/if}
  <div class="am-side">
   <ul>{#each mappedSurfaces as m,i}<li class:off={off.has(i)} class:hot={hover===i} onmouseenter={()=>hover=i} onmouseleave={()=>hover=-1}>
    <label><input type="checkbox" checked={!off.has(i)} onchange={()=>flip(i)}/><b>{i+1}</b><span>{m.name}{pictureOf(m)?' · with its photo':''}</span></label>
    <em class={quality(Number(m.rmsPx)).toLowerCase()} title={`Fit ${Number(m.rmsPx).toFixed(1)} projector pixels`}>{quality(Number(m.rmsPx))}</em></li>{/each}</ul>
   <label class="am-option"><input type="checkbox" bind:checked={replaceOld}/>Replace layers from the last scan</label>
   <button class="am-go" onclick={createLayers} disabled={!chosen||creating||createdFor===incoming}>{createdFor===incoming?'Layers created':`Create ${chosen} layer${chosen===1?'':'s'}`}</button>
   <p class="am-status" role="status">{message}</p>
  </div>
 </div></div>
{:else}<h2>Phone calibration import</h2><p>In the mobile app, open Tools → Projector calibration. Capture a projected rectangle, mark its corners in TL / TR / BR / BL order, then trace the desired flat surface in that same order. Export and open the file here.</p><input aria-label="Import phone calibration" type="file" accept=".json,.ghostcal" onchange={load}/>
{#if data}<h3>{data.name}</h3><img src={data.image} alt="Calibration reference photograph"/><div class="fields"><label>Measured projector<select bind:value={projector} onchange={()=>surface=0}>{#each data.projectors as p,i}<option value={i}>{p.name} · {p.width} × {p.height}</option>{/each}</select></label><label>Traced surface<select bind:value={surface}>{#each candidate?.surfaces??[] as s,i}<option value={i}>{s.name}</option>{/each}</select></label><label>Physical output<select bind:value={target}><option value="">Choose a screen</option>{#each $screens as s}<option value={s.id}>{s.name}</option>{/each}</select></label></div>
<svg viewBox="-0.1 -0.1 1.2 1.2" aria-label="Proposed projector raster geometry"><rect x="0" y="0" width="1" height="1" fill="#070b10" stroke="var(--ga-blue-mute-300)" stroke-width=".004"/><polygon points={(shape?.corners??shape?.points??[]).map(p=>`${p.x},${p.y}`).join(' ')} fill="var(--ga-blue-a28)" stroke="var(--ga-blue-300)" stroke-width=".008"/>{#if shape?.corners}<circle cx={shape.corners[0].x} cy={shape.corners[0].y} r=".03" fill="#ffd45c"><title>Top left of the picture</title></circle>{/if}</svg>
{#if shape?.corners&&shape.reordered}<p class="warn">The surface was not traced top left, top right, bottom right, bottom left as this projector sees it, so its corners were put in that order. The picture will be upright in the projector's raster, with its top left at the yellow dot. For a turned surface use the Screen's Rotation.</p>{/if}
{#if candidate?.mirrored}<p class="warn">This projector's corners run anticlockwise in the photo: a mirrored or rear-projection view, or corners marked out of order. Check the result on the surface before relying on it.</p>{/if}
{#if !shape?.corners}<p role="alert">Choose a convex four-corner surface within the supported projector raster. Polygons and non-planar objects cannot be applied as a corner calibration.</p>{/if}<button disabled={!target||!shape?.corners} onclick={apply}>Apply geometry to selected output</button>{/if}<p class="note">This is a planar photo calibration. Match the selected display’s resolution to the measured projector. Depth measurements do not make this an automatic 3D projector solve. Verify alignment at the venue; overlap blending remains a separate step.</p>{/if}
{#if !mappedSurfaces.length}<p role="status">{message}</p>{/if}</section>
<style>
 .am header small{font-size:10px;letter-spacing:.14em;color:var(--ga-blue-200)}.am header h2{margin:4px 0 6px;font-size:24px;font-weight:600}.am header p{margin:0;color:#a7b5c7;max-width:60ch}
 .am-body{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:28px;margin-top:22px;align-items:start}
 @media (max-width:820px){.am-body{grid-template-columns:1fr}}
 .am-photo{position:relative;border-radius:10px;overflow:hidden;background:#000;border:1px solid var(--ga-blue-mute-600)}
 .am-photo img,.am-photo svg{position:absolute;inset:0;width:100%;height:100%;display:block;max-height:none}
 .am-photo polygon{fill:var(--ga-blue-a16);stroke:var(--ga-blue-200);stroke-width:2;vector-effect:non-scaling-stroke;transition:fill .12s}
 .am-photo polygon.hot{fill:var(--ga-blue-a28);stroke:#fff}.am-photo polygon.off{fill:transparent;stroke:#ffffff55;stroke-dasharray:6 5}
 .am-tag{position:absolute;transform:translate(-50%,-50%);min-width:24px;min-height:24px;height:24px;padding:0 7px;border:0;border-radius:12px;background:var(--ga-blue,#5278ff);color:#fff;font:600 12px/24px system-ui;cursor:pointer;box-shadow:0 1px 6px #000a}
 .am-tag.off{background:#000b;color:#fff8}.am-tag.hot{outline:2px solid #fff}
 .am-side ul{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:2px;max-height:46vh;overflow:auto}
 .am-side li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 10px 2px 4px;border-radius:7px}.am-side li.hot{background:var(--ga-blue-mute-800)}.am-side li.off span{color:#7c8898}
 .am-side li label{display:flex;align-items:center;gap:10px;margin:0;min-height:38px;flex:1;cursor:pointer}
 .am-side li b{display:grid;place-content:center;width:22px;height:22px;border-radius:50%;background:var(--ga-blue-mute-600);font-size:11px}
 .am-side input[type=checkbox]{min-height:0;width:16px;height:16px;padding:0;accent-color:var(--ga-blue,#5278ff)}
 .am-side em{font-style:normal;font-size:11px;letter-spacing:.04em;padding:3px 9px;border-radius:10px;border:1px solid transparent}
 .am-side em.clean{color:#7fe0b0;border-color:#7fe0b044}.am-side em.fair{color:#f0c674;border-color:#f0c67444}.am-side em.rough{color:#ff8f7a;border-color:#ff8f7a44}
 .am-option{display:flex;align-items:center;gap:10px;margin:0 0 14px;color:#a7b5c7;font-size:13px;cursor:pointer}
 .am-go{width:100%;min-height:48px;border:0;border-radius:9px;background:var(--ga-blue,#5278ff);color:#fff;font-weight:600;font-size:15px;cursor:pointer}.am-go:disabled{opacity:.4;cursor:default}
 .am-status{min-height:1.6em;margin:12px 0 0;font-size:13px;color:var(--ga-blue-200)}
section{padding:24px;color:#e5ebf4;font:14px/1.6 system-ui}h2{margin-top:0}img{display:block;max-height:260px;max-width:100%;object-fit:contain;background:#000}.fields{display:flex;gap:16px;flex-wrap:wrap}label{display:grid;gap:5px;margin:16px 0;flex:1}select,button,input{font:inherit;color:inherit;background:var(--ga-blue-mute-800);border:1px solid var(--ga-blue-mute-600);border-radius:5px;padding:10px;min-height:44px;max-width:100%}button:disabled{opacity:.4}svg{width:240px;height:240px;display:block}.note{color:#a7b5c7;font-size:12px}p[role=status]{color:var(--ga-blue-200)}.warn{color:#f0c674}</style>
