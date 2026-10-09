<script lang="ts">
 import {onMount} from 'svelte';
 import MobileStudio from './MobileStudio.svelte';
 import MobileApp from '../MobileApp.svelte';
 import {parseCompanionLink,companionHost,rememberedDesktop,forgetDesktop} from '../../mobile/studio/companionLink';

 let remote=false,dialog=false,scanning=false,link='',draft='',error='',note='';
 // A pairing link is never acted on by itself. It waits here until the performer confirms the
 // host, so a stray QR code or a tapped link cannot pull them out of a running set.
 let pending:{link:string;host:string}|null=null;
 let remembered=rememberedDesktop();
 const cap=(window as any).Capacitor;
 const native=()=>['ios','android'].includes(cap?.getPlatform?.());

 function openDialog(){remembered=rememberedDesktop();pending=null;error='';note='';dialog=true;}
 function closeDialog(){dialog=false;pending=null;error='';note='';}
 /** Decode a scanned, pasted or deep-linked pairing link and ask before using it. */
 function review(raw:string){
  note='';
  try{const next=parseCompanionLink(raw);pending={link:next,host:companionHost(next)};error='';}
  catch(e){pending=null;error=e instanceof Error?e.message:'That is not a pairing link.';}
  dialog=true;
 }
 function connect(){
  if(!pending)return;
  link=pending.link;pending=null;draft='';error='';dialog=false;remote=true;
 }
 function forget(){
  forgetDesktop();remembered=null;pending=null;
  note='Desktop forgotten. Scan its QR code to pair again.';
 }
 async function scan(){
  scanning=true;error='';note='';
  try{
   if(!native()||!cap?.nativePromise)throw new Error('Use your camera to scan the desktop QR, or paste its pairing link below.');
   const result=await cap.nativePromise('StudioCapture','scanPairingCode',{});
   if(result.url)review(result.url);
  }catch(e){error=e instanceof Error?e.message:'Could not open camera.';}
  finally{scanning=false;}
 }
 onMount(()=>{
  let disposed=false,busy=false;
  const poll=async()=>{
   if(busy||disposed||!native())return;
   busy=true;
   try{const result=await cap.nativePromise(cap.getPlatform()==='ios'?'StudioCapture':'CompanionLink','takePairingLink',{});if(!disposed&&result.url)review(result.url);}
   catch{}finally{busy=false;}
  };
  // Newer app builds announce an arriving link; returning to the app is the other moment one can
  // appear. The slow timer only covers older builds that do neither.
  const wake=()=>{if(document.visibilityState==='visible')void poll();};
  window.addEventListener('ghost-pairing-link',poll);
  document.addEventListener('visibilitychange',wake);
  window.addEventListener('focus',wake);
  void poll();
  const timer=setInterval(poll,3000);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('ghost-pairing-link',poll);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);};
 });
</script>
{#if remote}{#key link}<MobileApp nativeShell pairingLink={link} onExit={()=>{remote=false;remembered=rememberedDesktop();}}/>{/key}{:else}<MobileStudio oncompanion={openDialog}/>{/if}
{#if dialog}<div class="backdrop"><div class="pair-panel" role="dialog" tabindex="-1" aria-modal="true" aria-label="Desktop Companion">
 <header><h2>Desktop Connect</h2><button onclick={closeDialog} aria-label="Close companion setup">×</button></header>
 {#if pending}
  <div class="confirm" data-pair-confirm role="alertdialog" aria-label="Confirm desktop">
   <h3>Connect to {pending.host}?</h3>
   <p>Only connect to your own desktop. {remote?'This switches to that desktop.':'Your set stays saved on this device while you control the desktop.'}</p>
   <button class="connect" onclick={connect}>Connect</button>
   <button class="plain" onclick={()=>pending=null}>Cancel</button>
  </div>
 {:else}
  <p>On your desktop, open Connect Mobile → App Connect. Keep both devices on the same Wi-Fi network.</p>
  <button class="connect" disabled={scanning} onclick={scan}>{scanning?"Scanner open…":"Scan desktop QR"}</button>
  <p>Or paste the desktop pairing link below.</p>
  <label>Pairing link<input type="url" bind:value={draft} placeholder="Paste desktop pairing link" autocapitalize="off" autocomplete="off" spellcheck="false"/></label>
  {#if error}<p role="alert">{error}</p>{/if}
  <button class="connect" disabled={!draft.trim()} onclick={()=>review(draft)}>Connect to desktop</button>
  {#if remembered}<div class="remembered" data-remembered><span>Last desktop<strong>{remembered.host}</strong></span><button data-reconnect onclick={()=>remembered&&review(remembered.link)}>Reconnect</button><button data-forget onclick={forget}>Forget this desktop</button></div>{/if}
  {#if note}<p role="status" data-pair-note>{note}</p>{/if}
  <small>Your standalone set stays saved. Desktop mode controls the desktop’s show.</small>
 {/if}
</div></div>{/if}
<style>.backdrop{position:fixed;inset:0;z-index:200;background:#000b;display:grid;place-items:center;padding:20px}.pair-panel{max-width:480px;width:100%;max-height:calc(100dvh - 40px);overflow:auto;padding:24px;background:var(--ga-inspector-bg);border:1px solid var(--ga-line-3);border-radius:12px;color:var(--ga-ink-0);font:14px system-ui}header{display:flex;align-items:center;justify-content:space-between}h2{font-size:18px}h3{font-size:17px;margin:14px 0 6px;overflow-wrap:anywhere}p{line-height:1.5;color:var(--ga-ink-1)}label{display:grid;gap:8px}input,button{font:inherit;color:inherit;background:var(--ga-slot);border:1px solid var(--ga-line-3);border-radius:5px;min-height:44px;padding:8px}input{min-width:0}header button{min-width:44px}.connect{width:100%;margin:16px 0;background:var(--ga-selection-bg)}.plain{width:100%}.confirm .connect{margin-bottom:8px}.remembered{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0 14px;padding-top:14px;border-top:1px solid var(--ga-line-2)}.remembered span{flex:1 1 140px;min-width:0;display:grid;gap:2px;font-size:11px;color:var(--ga-ink-2)}.remembered strong{font-size:14px;color:var(--ga-ink-0);overflow-wrap:anywhere}small{display:block;color:var(--ga-ink-2);line-height:1.5}</style>
