<script lang="ts">
 import {screens,screenActions} from '../../stores/screens';
 import {recordDiscreteAction} from '../../stores/historyHooks';
 import {readMobileCalibration,type ImportedCalibration} from '../../output/mobileCalibrationImport';
 import {inverseProjectorHomography} from '../../output/projectorCalibration';
 import {project} from '../../stores/layers';
 // Surfaces the phone measured with the stripe scan: each outline is already
 // in its projector's own picture, so it becomes a layer pinned to that face.
 type MappedSurface={name:string;screenId:string;screenName:string;points:{x:number;y:number}[];rmsPx:number};
 $: mappedSurfaces=(()=>{try{const list=JSON.parse(incoming||'{}').mappedSurfaces;return Array.isArray(list)?list.filter((m:any)=>Array.isArray(m?.points)&&m.points.length>=3&&m.points.every((p:any)=>Number.isFinite(p?.x)&&Number.isFinite(p?.y))) as MappedSurface[]:[];}catch{return [] as MappedSurface[];}})();
 let createdFor='';
 function createLayers(){
  let made=0,skipped=0,straightened=false;
  for(const surface of mappedSurfaces){
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
  }
  recordDiscreteAction();createdFor=incoming;
  message=`${made} layer${made===1?'':'s'} created and pinned in place.${skipped?` ${skipped} skipped: only four-corner surfaces can be pinned.`:''} Drop a shader or video on each one.${straightened?' The Screen’s own corner correction was turned off so the layers sit where they were measured.':''}`;
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
<section>{#if mappedSurfaces.length}<div class="mapped"><h2>Mapped surfaces</h2><p>The phone measured {mappedSurfaces.length} surface{mappedSurfaces.length===1?'':'s'} with the stripe scan. Each becomes a layer already pinned to that surface.</p>
 <ul>{#each mappedSurfaces as m}<li>{m.name} on {m.screenName} · fit {Number(m.rmsPx).toFixed(1)} px</li>{/each}</ul>
 <button onclick={createLayers} disabled={createdFor===incoming}>{createdFor===incoming?'Layers created':'Create layers'}</button></div>
{:else}<h2>Phone calibration import</h2><p>In the mobile app, open Tools → Projector calibration. Capture a projected rectangle, mark its corners in TL / TR / BR / BL order, then trace the desired flat surface in that same order. Export and open the file here.</p><input aria-label="Import phone calibration" type="file" accept=".json,.ghostcal" onchange={load}/>
{#if data}<h3>{data.name}</h3><img src={data.image} alt="Calibration reference photograph"/><div class="fields"><label>Measured projector<select bind:value={projector} onchange={()=>surface=0}>{#each data.projectors as p,i}<option value={i}>{p.name} · {p.width} × {p.height}</option>{/each}</select></label><label>Traced surface<select bind:value={surface}>{#each candidate?.surfaces??[] as s,i}<option value={i}>{s.name}</option>{/each}</select></label><label>Physical output<select bind:value={target}><option value="">Choose a screen</option>{#each $screens as s}<option value={s.id}>{s.name}</option>{/each}</select></label></div>
<svg viewBox="-0.1 -0.1 1.2 1.2" aria-label="Proposed projector raster geometry"><rect x="0" y="0" width="1" height="1" fill="#070b10" stroke="var(--ga-blue-mute-300)" stroke-width=".004"/><polygon points={(shape?.corners??shape?.points??[]).map(p=>`${p.x},${p.y}`).join(' ')} fill="var(--ga-blue-a28)" stroke="var(--ga-blue-300)" stroke-width=".008"/>{#if shape?.corners}<circle cx={shape.corners[0].x} cy={shape.corners[0].y} r=".03" fill="#ffd45c"><title>Top left of the picture</title></circle>{/if}</svg>
{#if shape?.corners&&shape.reordered}<p class="warn">The surface was not traced top left, top right, bottom right, bottom left as this projector sees it, so its corners were put in that order. The picture will be upright in the projector's raster, with its top left at the yellow dot. For a turned surface use the Screen's Rotation.</p>{/if}
{#if candidate?.mirrored}<p class="warn">This projector's corners run anticlockwise in the photo: a mirrored or rear-projection view, or corners marked out of order. Check the result on the surface before relying on it.</p>{/if}
{#if !shape?.corners}<p role="alert">Choose a convex four-corner surface within the supported projector raster. Polygons and non-planar objects cannot be applied as a corner calibration.</p>{/if}<button disabled={!target||!shape?.corners} onclick={apply}>Apply geometry to selected output</button>{/if}<p class="note">This is a planar photo calibration. Match the selected display’s resolution to the measured projector. Depth measurements do not make this an automatic 3D projector solve. Verify alignment at the venue; overlap blending remains a separate step.</p>{/if}
<p role="status">{message}</p></section>
<style>.mapped ul{margin:12px 0;padding:0;list-style:none;display:grid;gap:4px;max-height:40vh;overflow:auto}.mapped li{padding:8px 10px;border:1px solid var(--ga-blue-mute-600);border-radius:5px;font-variant-numeric:tabular-nums}.mapped button{min-width:180px}section{padding:24px;color:#e5ebf4;font:14px/1.6 system-ui}h2{margin-top:0}img{display:block;max-height:260px;max-width:100%;object-fit:contain;background:#000}.fields{display:flex;gap:16px;flex-wrap:wrap}label{display:grid;gap:5px;margin:16px 0;flex:1}select,button,input{font:inherit;color:inherit;background:var(--ga-blue-mute-800);border:1px solid var(--ga-blue-mute-600);border-radius:5px;padding:10px;min-height:44px;max-width:100%}button:disabled{opacity:.4}svg{width:240px;height:240px;display:block}.note{color:#a7b5c7;font-size:12px}p[role=status]{color:var(--ga-blue-200)}.warn{color:#f0c674}</style>
