<script lang="ts">
 import {onMount} from 'svelte';
 import type {Clip} from '../../mobile/studio/model';
 import {shaderThumbnail} from '../../mobile/studio/model';
 import {getAsset} from '../../mobile/studio/assets';
 export let clip:Clip;
 let image=clip.kind==='shader'?shaderThumbnail(clip.shaderId!):clip.thumbnail || '';
 onMount(()=>{
  if(image||!clip.assetId)return;
  let dead=false,url='',timer:ReturnType<typeof setTimeout>;
  const media=clip.kind==='video'?document.createElement('video'):new Image();
  const release=()=>{clearTimeout(timer);if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute('src');media.load();}if(url){URL.revokeObjectURL(url);url='';}};
  const capture=()=>{if(dead)return;try{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.getContext('2d')!.drawImage(media,0,0,160,90);image=canvas.toDataURL('image/jpeg',.75);}catch{}release();};
  getAsset(clip.assetId).then(blob=>{if(!blob||dead)return;url=URL.createObjectURL(blob);timer=setTimeout(release,5000);if(media instanceof HTMLVideoElement){media.muted=true;media.playsInline=true;media.preload='auto';media.onloadeddata=capture;media.onerror=release;}else{media.onload=capture;media.onerror=release;}media.src=url;}).catch(()=>{});
  return()=>{dead=true;release();};
 });
</script>
{#if image}<img src={image} alt="" draggable="false" loading="lazy" onerror={()=>image=''}/>{:else}<span aria-hidden="true">{clip.kind==='depth'?'◈ Depth':clip.kind==='camera'?(clip.facing==='user'?'◉ Front':'◉ Rear'):clip.kind==='video'?'▶':clip.kind==='image'?'▧':'✦'}</span>{/if}
<style>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}span{color:var(--ga-ink-2);font-size:18px}</style>
