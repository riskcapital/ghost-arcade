<script lang="ts">
 import {onDestroy} from 'svelte';
 import {touchSliders} from '../../mobile/studio/touchSliders';
 import '../../mobile/studio/touchSliders.css';
 import type {Project,Point2D,WarpCorners} from '../../types';
 import {grabOffset,draggedPoint} from '../../mobile/studio/mappingInteraction';
 export let project:Project|null;export let selectedId:string|null;
 export let canRoute=false;export let layerCount=4;export let onroute:(id:string,source:number|null)=>void=()=>{};
 export let onselect:(id:string)=>void;
 export let oncorner:(id:string,key:keyof WarpCorners,p:Point2D)=>void;
 export let onmesh:(id:string,row:number,col:number,p:Point2D)=>void;
 export let onmode:(mode:'corners'|'mesh')=>void;
 export let onresize:(rows:number,cols:number)=>void;
 export let onparameter:(id:string,param:string,value:number|string|boolean)=>void;
 const keys:(keyof WarpCorners)[]=['topLeft','topRight','bottomRight','bottomLeft'];
 let viewportWidth=0,viewportHeight=0;
 $: stageAspect=(project?.width||1920)/(project?.height||1080);
 $: fitWidth=Math.max(1,Math.min(viewportWidth-48,(viewportHeight-48)*stageAspect));
 let grid=true,snap=false,zoom=1,stage:HTMLDivElement,drag:number|null=null;
 let draft:WarpCorners|null=null,mesh:Point2D[][]|null=null;
 // Finger-to-handle offset at touch-down, so a corner moves by the distance dragged and never jumps.
 let grab={x:0,y:0};
 let selectedCorner: keyof WarpCorners='topLeft';let selectedMesh:[number,number]|null=null;
 let pending:(()=>void)|null=null,frame=0;
 $: layer=project?.layers.find(l=>l.id===selectedId);
 $: if(drag===null&&layer){draft=structuredClone(layer.corners);mesh=layer.meshGrid?structuredClone(layer.meshGrid.points):null;}
 $: handles=layer?.warpMode==='mesh'&&mesh?mesh.flatMap((row,r)=>row.map((p,c)=>({key:`${r}:${c}`,p,r,c,corner:null}))):draft?keys.map(corner=>({key:corner,p:draft![corner],corner,r:-1,c:-1})):[];
 function send(action:()=>void){pending=action;if(!frame)frame=requestAnimationFrame(()=>{frame=0;const p=pending;pending=null;p?.();});}
 function flush(){if(frame)cancelAnimationFrame(frame);frame=0;const p=pending;pending=null;p?.();}
 function move(e:PointerEvent){if(drag!==e.pointerId||!layer)return;const box=stage.getBoundingClientRect();const fix=(v:number)=>Math.max(-1,Math.min(2,snap?Math.round(v*20)/20:v));const at=draggedPoint({x:e.clientX,y:e.clientY},grab,box);const p={x:fix(at.x),y:fix(1-at.y)};const id=layer.id;if(selectedMesh&&mesh){const [r,c]=selectedMesh;mesh[r][c]=p;mesh=mesh;send(()=>onmesh(id,r,c,p));}else if(draft){draft[selectedCorner]=p;draft=draft;const corner=selectedCorner;send(()=>oncorner(id,corner,p));}}
 function down(e:PointerEvent,h:typeof handles[number]){if(drag!==null||layer?.locked)return;e.preventDefault();e.stopPropagation();drag=e.pointerId;grab=grabOffset({x:e.clientX,y:e.clientY},{x:h.p.x,y:1-h.p.y},stage.getBoundingClientRect());selectedCorner=h.corner||'topLeft';selectedMesh=h.corner?null:[h.r,h.c];(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}
 function finish(e:PointerEvent){if(drag!==e.pointerId)return;flush();if(layer&&draft){layer.corners=structuredClone(draft);if(layer.meshGrid&&mesh)layer.meshGrid.points=structuredClone(mesh);}drag=null;}
 function nudge(dx:number,dy:number){if(!layer||!draft||layer.locked)return;const p=selectedMesh&&mesh?mesh[selectedMesh[0]][selectedMesh[1]]:draft[selectedCorner];const q={x:p.x+dx/(project?.width||1920),y:p.y-dy/(project?.height||1080)};if(selectedMesh&&mesh){mesh[selectedMesh[0]][selectedMesh[1]]=q;mesh=mesh;onmesh(layer.id,...selectedMesh,q);}else{draft[selectedCorner]=q;draft=draft;oncorner(layer.id,selectedCorner,q);}}
 onDestroy(()=>{if(frame)cancelAnimationFrame(frame);});
</script>
<div class="mapping-workspace studio" use:touchSliders={project}>
 <section class="canvas-panel"><header><strong>DESKTOP MAPPING</strong><button class:active={grid} onclick={()=>grid=!grid}>Grid</button><button class:active={snap} onclick={()=>snap=!snap}>Snap</button><label class="zoom-control">Zoom<input aria-label="Mapping zoom" type="range" min=".1" max="3" step=".05" bind:value={zoom}/><output>{Math.round(zoom*100)}%</output></label></header>
 <div class="canvas-scroll" bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}><div class="stage" bind:this={stage} class:grid style:width={`${fitWidth*zoom}px`} style:margin-top={`${Math.max(0,(viewportHeight-48-fitWidth*zoom/stageAspect)/2)}px`} style:aspect-ratio={`${project?.width||1920}/${project?.height||1080}`}>
 <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Desktop mapping screens">
 {#each project?.layers.filter(l=>l.corners) || [] as l}<polygon points={keys.map(k=>`${l.corners[k].x*1000},${(1-l.corners[k].y)*1000}`).join(' ')} class:selected={l.id===selectedId} class:hidden={!l.visible} role="button" tabindex="0" aria-label={`Select ${l.name}`} onclick={()=>{flush();onselect(l.id);}} onkeydown={e=>{if(e.key==='Enter')onselect(l.id);}}/>{/each}
 {#if layer?.warpMode==='mesh'&&mesh}{#each mesh as row}<polyline points={row.map(p=>`${p.x*1000},${(1-p.y)*1000}`).join(' ')}/>{/each}{#each mesh[0]||[] as _,c}<polyline points={mesh.map(row=>`${row[c].x*1000},${(1-row[c].y)*1000}`).join(' ')}/>{/each}{:else if draft}<polygon class="outline" points={keys.map(k=>`${draft![k].x*1000},${(1-draft![k].y)*1000}`).join(' ')}/>{/if}
 </svg>
 {#each handles as h}<button class="handle" class:chosen={h.corner?selectedCorner===h.corner:!!selectedMesh&&selectedMesh[0]===h.r&&selectedMesh[1]===h.c} aria-label={`Warp ${h.key}`} style:left={`${h.p.x*100}%`} style:top={`${(1-h.p.y)*100}%`} onpointerdown={e=>down(e,h)} onpointermove={move} onpointerup={finish} onpointercancel={finish} onlostpointercapture={finish}><span></span></button>{/each}
 </div></div>

 </section>
 <aside><h2>Screens & layers</h2><div class="layers">{#each project?.layers||[] as l}<button class:active={l.id===selectedId} onclick={()=>{flush();onselect(l.id);}}>{l.name}<small>{l.visible?'Visible':'Hidden'}</small></button>{/each}</div>
 {#if layer}<h3>{layer.name}{layer.locked?' · Locked':''}</h3>
 {#if canRoute}<label>VJ source<select aria-label="Desktop screen VJ source" disabled={layer.locked} value={layer.vjLayerIndex??'none'} onchange={e=>onroute(layer!.id,e.currentTarget.value==='none'?null:Number(e.currentTarget.value))}><option value="none">Own media / shader</option><option value="-1">Full VJ mix</option>{#each Array.from({length:Math.min(64,layerCount)}) as _,i}<option value={i}>VJ layer {i+1}</option>{/each}</select></label>{/if}<div class="segmented"><button class:active={layer.warpMode!=='mesh'} onclick={()=>onmode('corners')}>Corners</button><button class:active={layer.warpMode==='mesh'} onclick={()=>onmode('mesh')}>Mesh</button></div>
 {#if layer.warpMode==='mesh'}<label>Mesh density<select value={`${layer.meshGrid?.rows||3}x${layer.meshGrid?.cols||3}`} onchange={e=>{const [r,c]=e.currentTarget.value.split('x').map(Number);onresize(r,c);}}>{#each [2,3,4,5,6,8,10,12] as size}<option value={`${size}x${size}`}>{size} × {size}</option>{/each}</select></label>{/if}
 <label>Opacity<input aria-label="Remote layer opacity" type="range" min="0" max="1" step=".005" value={layer.opacity} oninput={e=>onparameter(layer!.id,'opacity',+e.currentTarget.value)}/></label>
 <button class:active={layer.visible} onclick={()=>onparameter(layer!.id,'visible',!layer!.visible)}>{layer.visible?'Visible':'Hidden'}</button>
 <h3>Precision · 1 pixel</h3><div class="nudges"><button aria-label="Nudge left" onclick={()=>nudge(-1,0)}>←</button><button aria-label="Nudge up" onclick={()=>nudge(0,-1)}>↑</button><button aria-label="Nudge down" onclick={()=>nudge(0,1)}>↓</button><button aria-label="Nudge right" onclick={()=>nudge(1,0)}>→</button></div>
 {/if}<p>Changes apply to the desktop show immediately. Grid and snap are local editing aids.</p></aside>
</div>
<style>
.mapping-workspace{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 260px;background:var(--ga-void,#08090b);color:var(--ga-ink-0,#eee);font:13px Satoshi,system-ui;overflow:hidden}.canvas-panel{min-width:0;min-height:0;display:flex;flex-direction:column}header{display:flex;align-items:center;gap:8px;padding:12px;border-bottom:1px solid #30353e;flex-wrap:wrap}header strong{font-size:11px;letter-spacing:.1em}button,select{font:inherit;min-height:44px;background:var(--ga-hardware-bg,#16191e);border:1px solid var(--ga-line-3,#353b47);border-radius:5px;color:inherit;padding:6px 12px;touch-action:manipulation}.active{background:var(--ga-selection-bg,#182e60);border-color:#526ba6}.canvas-scroll{flex:1;min-height:0;overflow:auto;padding:24px;display:block;box-sizing:border-box;touch-action:pan-x pan-y}.stage{position:relative;min-width:0;margin:0 auto;background:#030609;border:1px solid #404a59;box-sizing:border-box}.stage.grid{background-image:linear-gradient(#25334470 1px,transparent 1px),linear-gradient(90deg,#25334470 1px,transparent 1px);background-size:5% 5%}svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}polygon{fill:#182a4840;stroke:#73849e;stroke-width:1.5;vector-effect:non-scaling-stroke;cursor:pointer}polygon.selected{fill:#294f8f55;stroke:#77b7ff}.hidden{opacity:.3}polyline,.outline{fill:none;stroke:#6fafff;stroke-width:1.5;vector-effect:non-scaling-stroke;pointer-events:none}.handle{position:absolute;transform:translate(-50%,-50%);width:44px;height:44px;border:0;background:none;padding:12px;touch-action:none}.handle span{display:block;width:16px;height:16px;border:2px solid #eff8ff;border-radius:50%;background:#4b8dec;box-shadow:0 0 0 2px #051321}.handle.chosen span{background:#b2f46c}label{display:flex;gap:8px;align-items:center;margin:12px 0}input{min-width:0;min-height:44px;accent-color:#465dee;flex:1;touch-action:none}aside{padding:16px;border-left:1px solid #30353e;overflow:auto;padding-bottom:20px}h2{font-size:14px}h3{font-size:12px;margin-top:20px}.layers{display:grid;gap:5px;max-height:32vh;overflow:auto}.layers button{text-align:left;display:flex;gap:8px;justify-content:space-between}.layers small{font-size:10px;color:#9eabba}.segmented,.nudges{display:flex;gap:4px}.segmented button,.nudges button{flex:1;min-width:0;padding:6px}.nudges button{font-size:20px}aside p{font-size:11px;line-height:1.5;color:#9eabba}@media(max-width:760px){.mapping-workspace{grid-template-columns:1fr;grid-template-rows:minmax(260px,1fr) 240px}aside{border-left:0;border-top:1px solid #30353e;padding:12px 12px 20px}.layers{display:flex;max-height:none;overflow:auto}.layers button{flex:none}.canvas-scroll{padding:24px}.stage{margin:0 auto}header strong{display:none}header{padding:6px}}


header{flex:none;padding:6px 12px;gap:6px}header strong{margin-right:auto}header .zoom-control{margin:0 0 0 6px;gap:8px;flex:0 1 210px;min-width:150px;font-size:11px}header .zoom-control input{width:90px;min-width:60px}header output{width:36px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ga-ink-1)}
@media(max-width:1050px){header strong{display:none}.zoom-control{margin-left:auto!important}}
</style>
