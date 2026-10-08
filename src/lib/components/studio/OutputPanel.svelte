<script lang="ts">
 import {onMount} from 'svelte';
 import type {OutputStatus,OutputPreferences} from '../../mobile/studio/externalOutput';
 export let status:OutputStatus;
 export let preferences:OutputPreferences;
 export let quality:540|720|1080;
 export let source:'mix'|'interactive'='mix';
 export let onpreferences:(value:OutputPreferences)=>void;
 export let onquality:(value:540|720|1080)=>void;
 export let onwireless:()=>void;
 export let onclose:()=>void;
 export let onretry:()=>void;
 export let onpreview:()=>void;
 let dialog:HTMLDialogElement;
 onMount(()=>dialog.showModal());
</script>
<dialog bind:this={dialog} aria-label="Output settings" onclose={onclose} onclick={e=>{if(e.target===dialog)dialog.close();}}>
 <header><strong>Output settings</strong><button aria-label="Close output settings" onclick={()=>dialog.close()}>×</button></header>
 <div class="content">
 <div class="status" class:live={status.state==='live'}>{status.state==='live'?'Clean output · Live':status.state==='connecting'?'Starting clean output…':status.state==='off'?'Output off · TV is black':status.state==='error'?'Output needs attention':'No external display connected'}</div>
 <p class="source">Source · <strong>{source==='interactive'?'Interactive scene':'Deck mix'}</strong></p>
 {#if status.display}<p class="display">{status.display.name} · {status.display.width} × {status.display.height}</p>{/if}
 <label class="switch"><span>Clean external output</span><input aria-label="Enable clean external output" type="checkbox" checked={preferences.enabled} onchange={e=>onpreferences({...preferences,enabled:e.currentTarget.checked})}/></label>
 <span class="label">CONNECTION SETUP</span>
 <div class="connections"><button class:active={preferences.method==='wireless'} aria-pressed={preferences.method==='wireless'} onclick={()=>onpreferences({...preferences,method:'wireless'})}>{status.platform==='android'?'Wireless display':'AirPlay · Apple TV'}</button><button class:active={preferences.method==='wired'} aria-pressed={preferences.method==='wired'} onclick={()=>onpreferences({...preferences,method:'wired'})}>Wired · HDMI / USB-C</button></div>
 {#if !status.native}<p>Use the installed iPhone/iPad or Android app for clean external displays. The browser preview can configure output but cannot connect a TV.</p>
 {:else if preferences.method==='wired'}<p>Connect a compatible video adapter or dock to your device, then connect the HDMI/DisplayPort cable to your TV or projector. Clean output starts automatically.</p><p class="hint">Your device and adapter must support video output. Charging-only USB cables cannot carry a display signal.</p>
 {:else if status.platform==='android'}<p>Choose a supported wireless display in Android’s system casting settings, then return to Ghost Arcade. Controls remain on your phone.</p><button onclick={onwireless}>Choose wireless display</button><p class="hint">Supports displays Android exposes as a separate presentation, including supported Miracast routes. Google Cast / Chromecast needs a separate receiver integration and is not supported by this path.</p>
 {:else}<ol><li>Connect iPhone and Apple TV to the same Wi-Fi.</li><li>Open Control Center → Screen Mirroring and choose your Apple TV.</li><li>Return to Ghost Arcade. The TV switches to clean output automatically.</li></ol><p class="hint">Apple calls the connection picker “Screen Mirroring.” Ghost Arcade uses that connection as a separate display.</p>{/if}
 <p class="hint">Your device selects the active display. Changing this setup guide does not disconnect an existing display.</p>
 <div class="quality">
 {#if source==='interactive'}
 <div class="fixed-resolution"><span>Render resolution</span><strong>960 × 540</strong><span>Effect detail adapts to your device.</span></div>
 {:else}
 <label>Render resolution<select aria-label="Output render resolution" value={quality} onchange={e=>onquality(Number(e.currentTarget.value) as 540|720|1080)}><option value={540}>540p · efficient</option><option value={720}>720p · balanced</option><option value={1080}>1080p · detail</option></select></label>
 {/if}
 <label>Output frame rate<select aria-label="Output frame rate" value={preferences.frameRate} onchange={e=>onpreferences({...preferences,frameRate:Number(e.currentTarget.value) as 30|60})}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
 </div>
 {#if source==='mix'}<p class="hint">Render resolution is the output size. Several playing shaders share it, and detail lowers itself if the frame rate drops, then returns.</p><p class="hint">Mapping, Looks and Flux stay in the TV feed.</p>{/if}
 <p class="hint">Master, Hold and Blackout apply to this output. Editing outlines and controls stay on this device. Actual frame rate depends on your device and connection.</p>
 {#if status.message}<p class="error">{status.message}</p>{/if}
 {#if status.connected&&preferences.enabled}<button onclick={onretry}>Retry output</button>{/if}
 <button onclick={onpreview}>Full-screen preview on this device</button>
 </div>
</dialog>
<style>
 dialog{position:fixed;inset:0;margin:auto;width:min(440px,calc(100% - 24px));max-height:85dvh;padding:0;overflow:auto;border:1px solid var(--ga-line-3);border-radius:12px;background:var(--ga-inspector-bg);color:var(--ga-ink-0);box-shadow:0 16px 60px #000c;font:13px/1.5 system-ui;}dialog::backdrop{background:#000b}header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--ga-line-2)}header strong{font-size:16px}button,select{font:inherit;color:inherit;min-height:44px;border:1px solid var(--ga-line-2);border-radius:5px;background:var(--ga-hardware-bg);padding:8px 10px;touch-action:manipulation}header button{width:44px;font-size:22px}.content{padding:18px}.content>button{display:block;width:100%;margin-top:10px}.status{padding:10px 12px;background:var(--ga-slot);border:1px solid var(--ga-line-2);border-radius:5px;font-weight:650}.live,.active{border-color:var(--ga-selection-line);background:var(--ga-selection-bg)}li{margin-bottom:8px}ol{padding-left:22px}.hint{font-size:11px;color:var(--ga-ink-2)}.error{color:#f3a6a6}.switch{display:flex;align-items:center;justify-content:space-between;min-height:52px;font-weight:600}.switch input{width:24px;height:24px;accent-color:var(--ga-slider-fill)}.label{font-size:10px;letter-spacing:.08em;color:var(--ga-ink-2)}.connections,.quality{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin:6px 0 12px}.connections button{font-size:12px}.quality{padding-top:16px;border-top:1px solid var(--ga-line-2)}.quality label{font-size:11px;color:var(--ga-ink-1)}.quality select{display:block;width:100%;margin-top:6px;font-size:13px;min-width:0}.display{font-size:11px;color:var(--ga-ink-2)}
 .source{margin:10px 0;color:var(--ga-ink-1)}.source strong{color:var(--ga-ink-0)}.fixed-resolution{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--ga-ink-1)}.fixed-resolution strong{font-size:13px;color:var(--ga-ink-0)}
</style>
