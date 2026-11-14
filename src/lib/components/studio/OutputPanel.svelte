<script lang="ts">
 import {onMount} from 'svelte';
 import type {OutputStatus,OutputPreferences,OutputRotation,OutputFit} from '../../mobile/studio/externalOutput';
 import {canPickRoute,pickRoute} from '../../mobile/studio/nativeOutput';
 import {displaySize} from '../../mobile/studio/outputSetup';
 import OutputWizard from './OutputWizard.svelte';
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
 <header><strong>{view==='setup'?'Projector':'Output settings'}</strong><button aria-label={view==='setup'?'Close projector setup':'Close output settings'} onclick={()=>dialog.close()}>×</button></header>
 <div class="content">
 {#if view==='setup'}
 <OutputWizard {status} {blackout} {master} enabled={preferences.enabled} {ontestpattern} {onretry} {onwireless} {onmaster} {onblackout}
  onenable={()=>set({enabled:true})} onpresent={()=>{dialog.close();onpresent();}} onmap={()=>{dialog.close();onmap();}} onsettings={()=>view='settings'} ondone={()=>dialog.close()}/>
 {:else}
 <div class="status" class:live={status.state==='live'}>{status.state==='live'?'Clean output · Live':status.state==='connecting'?'Starting clean output…':status.state==='off'?'Output off · TV is black':status.state==='error'?'Output needs attention':'No external display connected'}</div>
 {#if status.native}<div class="setup-row">
  {#if status.connected}<button class="wide" onclick={()=>view='setup'} data-run-setup>Check with a test pattern</button><button class="wide" onclick={()=>{dialog.close();onpresent();}} data-present>Present: dim this phone</button>
  {:else}<button class="wide primary" onclick={()=>view='setup'} data-run-setup>Connect a projector</button>{/if}
 </div>{/if}
 <p class="source">Source · <strong>{source==='interactive'?'Interactive scene':'Deck mix'}</strong></p>
 {#if status.display}<p class="display">{status.display.name} · {size}</p>{/if}
 <label class="switch"><span>Clean external output</span><input aria-label="Enable clean external output" type="checkbox" checked={preferences.enabled} onchange={e=>set({enabled:e.currentTarget.checked})}/></label>
 <span class="label">CONNECTION SETUP</span>
 <div class="connections"><button class:active={preferences.method==='wireless'} aria-pressed={preferences.method==='wireless'} onclick={()=>set({method:'wireless'})}>{status.platform==='android'?'Wireless display':'AirPlay · Apple TV'}</button><button class:active={preferences.method==='wired'} aria-pressed={preferences.method==='wired'} onclick={()=>set({method:'wired'})}>Wired · HDMI / USB-C</button></div>
 {#if !status.native}<p>Use the installed iPhone/iPad or Android app for clean external displays. The browser preview can configure output but cannot connect a TV.</p>
 {:else if preferences.method==='wired'}<p>Connect a compatible video adapter or dock to your device, then connect the HDMI/DisplayPort cable to your TV or projector. Clean output starts automatically.</p><p class="hint">Your device and adapter must support video output. Charging-only USB cables cannot carry a display signal.</p>
 {:else if status.platform==='android'}<p>Choose a supported wireless display in Android’s system casting settings, then return to Ghost Arcade. Controls remain on your phone.</p><button onclick={onwireless}>Choose wireless display</button><p class="hint">Supports displays Android exposes as a separate presentation, including supported Miracast routes. Google Cast / Chromecast needs a separate receiver integration and is not supported by this path.</p>
 {:else if picker}<button class="wide" bind:this={airplayButton} onclick={chooseAirPlay} data-pick-airplay>Choose an AirPlay display</button><p class="more">Your phone and the display need the same Wi-Fi. Not in the list? Open Control Center and use Screen Mirroring.</p>{#if pickFailed}<p class="more">The AirPlay list did not open. Use Control Center → Screen Mirroring.</p>{/if}
 {:else}<ol><li>Connect iPhone and Apple TV to the same Wi-Fi.</li><li>Open Control Center → Screen Mirroring and choose your Apple TV.</li><li>Return to Ghost Arcade. The TV switches to clean output automatically.</li></ol><p class="hint">Apple calls the connection picker “Screen Mirroring.” Ghost Arcade uses that connection as a separate display.</p>{/if}
 <p class="hint">Your device selects the active display. Changing this setup guide does not disconnect an existing display.</p>
 <section class="picture" aria-label="Picture on the projector" data-picture-settings>
  <span class="label">PICTURE ON THE PROJECTOR</span>
  <div class="row"><span>Turn</span><div class="segmented four">{#each turns as turn}<button class:active={preferences.rotation===turn} aria-pressed={preferences.rotation===turn} aria-label={`Turn the picture ${turn} degrees`} onclick={()=>set({rotation:turn})}>{turn}°</button>{/each}</div></div>
  <div class="row"><span>Shape</span><div class="segmented">{#each fits as [fit,name]}<button class:active={preferences.fit===fit} aria-pressed={preferences.fit===fit} onclick={()=>set({fit})}>{name}</button>{/each}</div></div>
  <p class="more">{preferences.fit==='contain'?'Fit shows the whole picture, with black bars on a display of another shape.':preferences.fit==='cover'?'Fill covers the display and trims the edges that do not fit.':'Stretch reaches every edge of the display, so you can map to its whole area.'}</p>
  <label class="switch"><span>Mirror for rear projection</span><input type="checkbox" checked={preferences.mirror} onchange={e=>set({mirror:e.currentTarget.checked})}/></label>
  <label class="switch"><span>Use the whole display</span><input type="checkbox" checked={preferences.fullFrame} onchange={e=>set({fullFrame:e.currentTarget.checked})}/></label>
  <p class="more">{preferences.fullFrame?'Every pixel reaches the projector. Turn off only for a TV that cuts off its edges.':'iOS keeps a margin for TVs that cut off their edges, so the corners are not used.'}</p>
  {#if status.connected && (status.modes?.length ?? 0) > 1}<label class="mode">Display mode<select value={modeValue} onchange={e=>{const [w,h]=e.currentTarget.value.split('x').map(Number);set({mode:w&&h?{width:w,height:h}:null});}}><option value="">Automatic</option>{#each status.modes ?? [] as mode}<option value={`${mode.width}x${mode.height}`}>{mode.width} × {mode.height}</option>{/each}</select></label>{/if}
 </section>
 <div class="quality">
 {#if source==='interactive'}
 <div class="fixed-resolution"><span>Render resolution</span><strong>960 × 540</strong><span>Effect detail adapts to your device.</span></div>
 {:else}
 <label>Render resolution<select aria-label="Output render resolution" value={quality} onchange={e=>onquality(Number(e.currentTarget.value) as 540|720|1080)}><option value={540}>540p · efficient</option><option value={720}>720p · balanced</option><option value={1080}>1080p · detail</option></select></label>
 {/if}
 <label>Output frame rate<select aria-label="Output frame rate" value={preferences.frameRate} onchange={e=>set({frameRate:Number(e.currentTarget.value) as 30|60})}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
 </div>
 {#if source==='mix'}<p class="hint">Render resolution is the output size. Several playing shaders share it, and detail lowers itself if the frame rate drops, then returns.</p><p class="hint">Mapping, Looks and Flux stay in the TV feed.</p>{/if}
 <p class="hint">Master, Hold and Blackout apply to this output. Editing outlines and controls stay on this device. Actual frame rate depends on your device and connection.</p>
 {#if status.message}<p class="error">{status.message}</p>{/if}
 {#if status.connected&&preferences.enabled}<button onclick={onretry}>Retry output</button>{/if}
 <button onclick={onpreview}>Full-screen preview on this device</button>
 {/if}
 </div>
</dialog>
<style>
 dialog{position:fixed;inset:0;margin:auto;width:min(440px,calc(100% - 24px));max-height:85dvh;padding:0;overflow:auto;border:1px solid var(--ga-line-3);border-radius:12px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;font:13px/1.5 system-ui;}dialog::backdrop{background:#000b}header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 18px;border-bottom:1px solid var(--ga-line-2)}header strong{font-size:16px;margin-right:auto}button,select{font:inherit;color:inherit;min-height:44px;border:1px solid var(--ga-line-2);border-radius:5px;background:var(--ga-hardware-bg);padding:8px 10px;touch-action:manipulation}header button{width:44px;font-size:22px}.content{padding:18px}.content>button{display:block;width:100%;margin-top:10px}.status{padding:10px 12px;background:var(--ga-slot);border:1px solid var(--ga-line-2);border-radius:5px;font-weight:650}.live,.active{border-color:var(--ga-selection-line);background:var(--ga-selection-bg)}li{margin-bottom:8px}ol{padding-left:22px}.hint{font-size:11px;color:var(--ga-ink-2)}.error{color:#f3a6a6}.switch{display:flex;align-items:center;justify-content:space-between;min-height:52px;font-weight:600}.switch input{width:24px;height:24px;accent-color:var(--ga-slider-fill)}.label{font-size:10px;letter-spacing:.08em;color:var(--ga-ink-2)}.connections,.quality{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:6px 0 12px}.connections button{font-size:12px}.quality{padding-top:16px;border-top:1px solid var(--ga-line-2)}.quality label{font-size:11px;color:var(--ga-ink-1)}.quality select{display:block;width:100%;margin-top:6px;font-size:13px;min-width:0}.display{font-size:11px;color:var(--ga-ink-2)}
 .source{margin:10px 0;color:var(--ga-ink-1)}.source strong{color:var(--ga-ink-0)}.fixed-resolution{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--ga-ink-1)}.fixed-resolution strong{font-size:13px;color:var(--ga-ink-0)}
 .setup-row{display:grid;gap:8px;margin-top:10px}.wide{display:block;width:100%;font-weight:650;font-size:13px}.wide.primary{min-height:48px;font-size:14px;border-color:var(--ga-selection-line);background:var(--ga-selection-bg)}
 .more{margin:8px 0 0;font-size:12px;color:var(--ga-ink-1)}
 .picture{display:grid;gap:8px;margin:14px 0 16px;padding-top:14px;border-top:1px solid var(--ga-line-2)}.picture .row{display:grid;grid-template-columns:52px minmax(0,1fr);align-items:center;gap:8px;font-size:13px;font-weight:600}.segmented{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.segmented.four{grid-template-columns:repeat(4,minmax(0,1fr))}.segmented button{padding:6px 4px;font-size:13px}.picture .switch{min-height:44px;font-size:13px}.mode{display:grid;gap:6px;font-size:13px;font-weight:600}.mode select{width:100%;font-size:13px}.picture .label{font-size:12px}
</style>
