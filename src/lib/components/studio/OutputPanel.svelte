<script lang="ts">
 import {onMount} from 'svelte';
 import type {OutputStatus,OutputPreferences,OutputRotation,OutputFit} from '../../mobile/studio/externalOutput';
 import {canPickRoute,pickRoute} from '../../mobile/studio/nativeOutput';
 import {displaySize} from '../../mobile/studio/outputSetup';
 import OutputWizard from './OutputWizard.svelte';
 import Icon from './StudioIcon.svelte';
 import Section from './ui/Section.svelte';
 import InfoTip from './ui/InfoTip.svelte';
 export let status:OutputStatus;
 export let preferences:OutputPreferences;
 export let quality:540|720|1080;
 export let source:'mix'|'interactive'='mix';
 /** Open on the "Connect a projector" setup instead of the settings. */
 export let wizard=false;
 export let blackout=false;
 export let master=1;
 export let onpreferences:(value:OutputPreferences)=>void;
 export let onquality:(value:540|720|1080)=>void;
 export let onwireless:()=>void;
 export let onclose:()=>void;
 export let onretry:()=>void;
 export let onpreview:()=>void;
 export let ontestpattern:(on:boolean)=>void=()=>{};
 export let onblackout:()=>void=()=>{};
 export let onmaster:()=>void=()=>{};
 export let onpresent:()=>void=()=>{};
 export let onmap:()=>void=()=>{};
 let dialog:HTMLDialogElement;
 let view:'setup'|'settings'=wizard?'setup':'settings';
 let airplayButton:HTMLButtonElement;
 let pickFailed=false;
 const picker=canPickRoute();
 onMount(()=>dialog.showModal());
 const set=(patch:Partial<OutputPreferences>)=>onpreferences({...preferences,...patch});
 const turns:OutputRotation[]=[0,90,180,270];
 const fits:Array<[OutputFit,string]>=[['contain','Fit'],['cover','Fill'],['fill','Stretch']];
 async function chooseAirPlay(){pickFailed=false;try{pickFailed=!(await pickRoute(airplayButton)).shown;}catch{pickFailed=true;}}
 $: size=displaySize(status.display);
 $: modeValue=preferences.mode?`${preferences.mode.width}x${preferences.mode.height}`:'';
</script>
<dialog bind:this={dialog} aria-label={view==='setup'?'Connect a projector':'Output settings'} onclose={onclose} onclick={e=>{if(e.target===dialog)dialog.close();}}>
 <header><span class="chip" aria-hidden="true"><Icon name="projector" size={18}/></span><strong>{view==='setup'?'Projector':'Output settings'}</strong><button class="close" aria-label={view==='setup'?'Close projector setup':'Close output settings'} onclick={()=>dialog.close()}><Icon name="close" size={20}/></button></header>
 <div class="content">
 {#if view==='setup'}
 <OutputWizard {status} {blackout} {master} enabled={preferences.enabled} {ontestpattern} {onretry} {onwireless} {onmaster} {onblackout}
  onenable={()=>set({enabled:true})} onpresent={()=>{dialog.close();onpresent();}} onmap={()=>{dialog.close();onmap();}} onsettings={()=>view='settings'} ondone={()=>dialog.close()}/>
 {:else}
 <Section plain title="Projector" icon="projector" tone="output" info="The projector or TV shows only your visuals, without the controls. Ghost Arcade sends the picture as soon as a display connects." infoLabel="About the projector output">
  <p class="status" class:live={status.state==='live'} role="status"><i aria-hidden="true"></i>{status.state==='live'?`Live${status.display?` · ${status.display.name}${size?` · ${size}`:''}`:''}`:status.state==='connecting'?'Starting the picture…':status.state==='off'?'Output is off. The projector shows black.':status.state==='error'?'Output needs attention':'No projector connected'}</p>
  {#if status.native}<div class="setup-row">
   {#if status.connected}<button class="wide" onclick={()=>view='setup'} data-run-setup><Icon name="check" size={18}/>Check with a test pattern</button><button class="wide" onclick={()=>{dialog.close();onpresent();}} data-present><Icon name="phone" size={18}/>Present: dim this phone</button>
   {:else}<button class="wide ga-act" onclick={()=>view='setup'} data-run-setup><Icon name="output" size={18}/>Connect a projector</button>{/if}
  </div>{/if}
  <label class="switch"><span>Send the picture to the projector<small>Shows: {source==='interactive'?'Interactive scene':'Deck mix'}</small></span><input aria-label="Enable clean external output" type="checkbox" checked={preferences.enabled} onchange={e=>set({enabled:e.currentTarget.checked})}/></label>
 </Section>
 <Section plain title="How it connects" icon="cable" tone="output" info="This only chooses which steps to show. Your device picks the display, and changing this does not disconnect one that is already showing." infoLabel="About connection type">
  <div class="connections segmented two"><button class:active={preferences.method==='wireless'} aria-pressed={preferences.method==='wireless'} aria-label={status.platform==='android'?'Wireless display':'AirPlay · Apple TV'} onclick={()=>set({method:'wireless'})}><Icon name="airplay" size={16}/>{status.platform==='android'?'Wireless':'AirPlay'}</button><button class:active={preferences.method==='wired'} aria-pressed={preferences.method==='wired'} aria-label="Wired · HDMI / USB-C" onclick={()=>set({method:'wired'})}><Icon name="cable" size={16}/>Cable</button></div>
  {#if !status.native}<p class="line">Projector output needs the Ghost Arcade app on iPhone, iPad or Android.</p>
  {:else if preferences.method==='wired'}<p class="line">Plug an HDMI or USB-C video adapter into this device, then the cable into the projector.<InfoTip label="Cable tips" text="Your device and adapter must support video output. Charging-only USB cables cannot carry a picture. The picture starts by itself."/></p>
  {:else if status.platform==='android'}<button class="wide" onclick={onwireless}><Icon name="airplay" size={18}/>Choose a wireless display</button><p class="line">Pick it in Android's casting settings, then come back.<InfoTip label="Wireless display tips" text="Works with displays Android shows as a separate screen, including Miracast. Google Cast / Chromecast is not supported."/></p>
  {:else if picker}<button class="wide" bind:this={airplayButton} onclick={chooseAirPlay} data-pick-airplay><Icon name="airplay" size={18}/>Choose an AirPlay display</button><p class="line">This device and the display need the same Wi-Fi.<InfoTip label="AirPlay tips" text="Not in the list? Open Control Center, tap Screen Mirroring and choose it there."/></p>{#if pickFailed}<p class="note">The AirPlay list did not open. Use Control Center → Screen Mirroring.</p>{/if}
  {:else}<p class="line">Open Control Center → Screen Mirroring and choose your Apple TV.<InfoTip label="AirPlay steps" text="Put this device and the Apple TV on the same Wi-Fi first. Come back to Ghost Arcade afterwards: the TV switches to the clean picture by itself. Apple calls the picker Screen Mirroring; Ghost Arcade uses it as a separate display."/></p>{/if}
 </Section>
 <Section plain title="Picture on the projector" icon="frame" tone="output" data-picture-settings info="Turn the picture when the projector hangs sideways or upside down. Fit shows all of it with black bars, Fill covers the display and trims the edges, Stretch reaches every edge so you can map the whole area. Mirror is for projecting from behind a screen. Use the whole display sends every pixel; turn it off only for a TV that cuts off its edges." infoLabel="About the projector picture">
  <div class="row"><span>Turn</span><div class="segmented four">{#each turns as turn}<button class:active={preferences.rotation===turn} aria-pressed={preferences.rotation===turn} aria-label={`Turn the picture ${turn} degrees`} onclick={()=>set({rotation:turn})}>{turn}°</button>{/each}</div></div>
  <div class="row"><span>Shape</span><div class="segmented">{#each fits as [fit,name]}<button class:active={preferences.fit===fit} aria-pressed={preferences.fit===fit} onclick={()=>set({fit})}>{name}</button>{/each}</div></div>
  <p class="line small">{preferences.fit==='contain'?'Fit: the whole picture, black bars on a display of another shape.':preferences.fit==='cover'?'Fill: covers the display, trims the edges.':'Stretch: reaches every edge of the display.'}</p>
  <label class="switch"><span>Mirror for rear projection</span><input type="checkbox" checked={preferences.mirror} onchange={e=>set({mirror:e.currentTarget.checked})}/></label>
  <label class="switch"><span>Use the whole display</span><input type="checkbox" checked={preferences.fullFrame} onchange={e=>set({fullFrame:e.currentTarget.checked})}/></label>
  {#if status.connected && (status.modes?.length ?? 0) > 1}<label class="mode">Display mode<select value={modeValue} onchange={e=>{const [w,h]=e.currentTarget.value.split('x').map(Number);set({mode:w&&h?{width:w,height:h}:null});}}><option value="">Automatic</option>{#each status.modes ?? [] as mode}<option value={`${mode.width}x${mode.height}`}>{mode.width} × {mode.height}</option>{/each}</select></label>{/if}
 </Section>
 <Section plain title="Quality" icon="gauge" tone="neutral" info={source==='mix'?'Render resolution is the size of the picture. The playing visuals share it, and detail lowers itself if the frame rate drops, then comes back. Mapping, Looks and Flux are in the projector picture. Master, Hold and Blackout apply to it; outlines and controls stay on this device.':'The interactive scene renders at 960 × 540; effect detail adapts to your device. Master, Hold and Blackout apply to it.'} infoLabel="About output quality">
  <div class="quality">
  {#if source==='interactive'}
  <div class="fixed-resolution"><span>Render resolution</span><strong>960 × 540</strong></div>
  {:else}
  <label>Render resolution<select aria-label="Output render resolution" value={quality} onchange={e=>onquality(Number(e.currentTarget.value) as 540|720|1080)}><option value={540}>540p · efficient</option><option value={720}>720p · balanced</option><option value={1080}>1080p · detail</option></select></label>
  {/if}
  <label>Frame rate<select aria-label="Output frame rate" value={preferences.frameRate} onchange={e=>set({frameRate:Number(e.currentTarget.value) as 30|60})}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
  </div>
 </Section>
 <div class="actions">
  {#if status.message}<p class="note error">{status.message}</p>{/if}
  {#if status.connected&&preferences.enabled}<button class="wide" onclick={onretry}><Icon name="restart" size={18}/>Retry output</button>{/if}
  <button class="wide" onclick={onpreview}><Icon name="frame" size={18}/>Full-screen preview on this device</button>
 </div>
 {/if}
 </div>
</dialog>
<style>
 dialog{position:fixed;inset:0;margin:auto;width:min(460px,calc(100% - 24px));max-height:88dvh;padding:0;overflow:auto;overscroll-behavior:contain;border:1px solid var(--ga-line-3);border-radius:14px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;font:13px/1.5 var(--ga-font-ui,system-ui);}
 dialog::backdrop{background:#000b}
 header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:6px 6px 6px 14px;border-bottom:1px solid var(--ga-line-2);background:linear-gradient(90deg,var(--ga-tone-output-soft),transparent 70%),var(--ga-panel)}
 header strong{flex:1;font-size:17px;font-weight:650}
 .chip{--ga-icon-tone:var(--ga-tone-output);display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:var(--ga-tone-output-soft);box-shadow:inset 0 0 0 1px #ffffff10}
 button,select{font:inherit;color:inherit;min-height:44px;border:1px solid var(--ga-line-2);border-radius:var(--ga-r-control,8px);background:var(--ga-hardware-bg);padding:8px 10px;touch-action:manipulation}
 button{display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer}
 header .close{width:44px;padding:0;border:0;background:none;color:var(--ga-ink-1)}
 .content{padding:2px 16px 18px}
 .content > :global(.ga-section.plain:first-child){margin-top:4px;border-top:0}
 .status{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:14px;font-weight:650;color:var(--ga-ink-0)}
 .status i{flex:none;width:10px;height:10px;border-radius:50%;background:var(--ga-coral-400);box-shadow:0 0 8px var(--ga-coral-a45)}
 .status.live i{background:var(--ga-green);box-shadow:0 0 8px #46d18a80}
 .setup-row{display:grid;gap:8px;margin:0 0 4px}
 .wide{display:flex;width:100%;font-weight:650;font-size:14px}
 .switch{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;font-size:14px;font-weight:600}
 .switch span{display:grid;gap:1px}
 .switch small{font-size:12px;font-weight:500;color:var(--ga-ink-2)}
 .switch input{flex:none;width:24px;height:24px;margin:10px;accent-color:var(--ga-coral-400)}
 .segmented{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
 .segmented.four{grid-template-columns:repeat(4,minmax(0,1fr))}
 .segmented.two{grid-template-columns:repeat(2,minmax(0,1fr));margin:0 0 10px}
 .segmented button{padding:6px 4px;font-size:13px}
 .active{border-color:var(--ga-on-line);background:var(--ga-on-bg);color:var(--ga-on-ink)}
 .line{display:flex;align-items:center;gap:2px;margin:8px 0 0;font-size:13px;line-height:1.4;color:var(--ga-ink-1)}
 .line.small{margin:2px 0 4px 60px;font-size:12px}
 .note{margin:8px 0 0;padding:0 0 0 10px;border-left:3px solid #ffc570;font-size:13px;color:var(--ga-ink-0)}
 .note.error{border-color:var(--ga-record);color:#ffb4ab}
 .row{display:grid;grid-template-columns:52px minmax(0,1fr);align-items:center;gap:8px;margin:0 0 8px;font-size:13px;font-weight:600}
 .mode{display:grid;gap:6px;font-size:13px;font-weight:600}
 .mode select{width:100%;font-size:13px}
 .quality{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
 .quality label{font-size:13px;color:var(--ga-ink-1)}
 .quality select{display:block;width:100%;margin-top:6px;font-size:13px;min-width:0}
 .fixed-resolution{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--ga-ink-1)}
 .fixed-resolution strong{font-size:14px;color:var(--ga-ink-0)}
 .actions{display:grid;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid var(--ga-section-head-line,var(--ga-line-2))}
 button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--ga-focus);outline-offset:2px}
</style>
