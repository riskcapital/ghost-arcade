<script lang="ts">
 import {onDestroy,tick} from 'svelte';
 import {DesktopFeedPreview,type DesktopFeedKind} from '../../mobile/studio/desktopFeed';
 export let onsend:((canvas:HTMLCanvasElement|null,kind:string)=>void)|undefined=undefined;export let onclose:()=>void;export let lidar=false;export let dual=false;
 let kind:DesktopFeedKind='rear',canvas:HTMLCanvasElement,preview:DesktopFeedPreview|undefined,busy=false,message='',running=false,epoch=0,near=.2,far=5,color=0;
 const choices:{id:DesktopFeedKind;name:string}[]=[{id:'rear',name:'Rear camera'},{id:'front',name:'Selfie camera'},{id:'dual',name:'Front + rear'},{id:'depth',name:'Depth map'},{id:'contours',name:'Depth contours'},{id:'points',name:'Point cloud'}];
 function stop(){onsend?.(null,kind);epoch++;preview?.destroy();preview=undefined;running=false;busy=false;}
 async function start(){stop();const id=epoch;busy=true;message='';running=true;await tick();const next=new DesktopFeedPreview(canvas,kind,s=>message=s);preview=next;try{await next.start();if(id===epoch)message=onsend?'Preview ready. Tap Send to desktop.':'Local preview active. Connect to desktop from Tools to send this feed.';}catch(e){if(id===epoch){message=(e as Error).message;running=false;}}finally{if(id===epoch)busy=false;}}
 onDestroy(stop);
 $: if(preview){preview.near=near;preview.far=far;preview.color=color;}
</script>
<section>
 <header><div><small>DESKTOP TOOLS · LOCAL PREVIEW</small><h2>Feed studio</h2></div><button onclick={onclose}>Back</button></header>
 <p>Prepare the camera or depth look you want to send to desktop. Camera access starts only when you tap Preview.</p>
 <div class="choices">{#each choices as c}<button class:active={kind===c.id} disabled={busy||(c.id==='dual'&&!dual)||(['depth','contours','points'].includes(c.id)&&!lidar)} onclick={()=>{stop();kind=c.id;}}>{c.name}</button>{/each}</div>
 {#if running}<canvas bind:this={canvas} aria-label="Clean feed preview"></canvas>{:else}<div class="empty">{choices.find(c=>c.id===kind)?.name}</div>{/if}
 {#if ['depth','contours','points'].includes(kind)}<label>Near cut · {near.toFixed(1)} m<input type="range" min=".1" max="3" step=".1" bind:value={near}/></label><label>Far cut · {far.toFixed(1)} m<input type="range" min="3.1" max="10" step=".1" bind:value={far}/></label>{#if kind!=='depth'}<label>Color<input type="range" min="0" max="1" step=".01" bind:value={color}/></label>{/if}{/if}
 <div class="row"><button class="active" disabled={busy} onclick={start}>{busy?'Opening…':'Preview feed'}</button><button disabled={!running} onclick={stop}>Stop camera</button></div>
 <div class="row">{#if onsend}<button disabled={!running||busy} onclick={()=>onsend?.(canvas,kind)}>Send to desktop</button><button onclick={()=>onsend?.(null,kind)}>Stop sending</button>{/if}</div><p role="status">{message}</p><p class="note">Selfie is mirrored. Dual places rear on the left and selfie on the right. Depth and front camera cannot run together. These are visual feeds; measured depth is preserved separately in calibration exports. Desktop receives this as a normal video source; depth pictures do not transmit metric depth.</p>
</section>
<style>
 section{padding:18px;font:13px/1.5 system-ui;color:var(--ga-ink-0)}header,.row{display:flex;justify-content:space-between;gap:8px;align-items:center}small{font-size:9px;color:var(--ga-blue-200);letter-spacing:.12em}h2{font-size:20px;margin:4px 0}p{color:var(--ga-ink-2)}button{font:inherit;min-height:44px;padding:10px;border:1px solid var(--ga-line-3);border-radius:5px;background:var(--ga-slot);color:inherit;touch-action:manipulation}.choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}.active{background:var(--ga-selection-bg);border-color:var(--ga-blue-300)}button:disabled{opacity:.4}canvas{width:100%;max-height:42dvh;object-fit:contain;background:black;display:block;margin:12px 0}.empty{background:black;padding:48px 16px;text-align:center;margin:12px 0;color:var(--ga-ink-2)}label{display:block;margin:12px 0;font-size:12px}input{display:block;width:100%;height:44px;accent-color:var(--ga-blue-400);touch-action:none}.row>*{flex:1}.note{font-size:11px}
</style>
