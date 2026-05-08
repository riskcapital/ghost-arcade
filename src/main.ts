import { mount } from 'svelte';
import { initErrorReporter } from './lib/utils/errorReporter';
import { silenceThreeSerializationNoise } from './lib/utils/silenceThreePatches';

// Patch THREE.Texture.toJSON before anything else — any tree walker that
// serializes a live texture would otherwise log "Unable to serialize Texture"
// per frame and starve the renderer.
silenceThreeSerializationNoise();

// Install global error handlers
initErrorReporter();

// Check URL mode parameter
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const isSpoutOutput = mode === 'spout-output';
const isOutputWindow = mode === 'output';
// `webrtc-display` is the experimental output transport. When the
// `experimental.outputWebRTC` setting is on, electron/main.js opens
// the output window with this mode, mounting OutputDisplayApp instead
// of the legacy SpoutOutputApp full renderer. OutputDisplayApp is a
// dumb presentation surface — receives the editor's canvas via WebRTC
// and shows a single `<video srcObject>`. See OutputDisplayApp.svelte
// for the full architectural rationale. When the flag is off
// (default) main.js stays on `?mode=output` and this branch is never
// reached.
const isWebRTCDisplay = mode === 'webrtc-display';

// Set global flags so Canvas.svelte knows not to create Spout sender/receiver
// Use try/catch because Electron's contextBridge.exposeInMainWorld makes these read-only
if (isSpoutOutput && !window.__SPOUT_OSR_MODE__) {
  try { (window as any).__SPOUT_OSR_MODE__ = true; } catch { /* already set by preload */ }
}

if ((isOutputWindow || isWebRTCDisplay) && !(window as any).__OUTPUT_WINDOW_MODE__) {
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* already set by preload */ }
}

async function init() {
  if (isWebRTCDisplay) {
    // Experimental: WebRTC presentation-only output. Receives the
    // editor's canvas stream over a same-process RTCPeerConnection
    // and displays it in a `<video srcObject>`. No state-sync, no
    // decoders, no per-layer rendering — just frames in, frames out.
    const { default: OutputDisplayApp } = await import('./OutputDisplayApp.svelte');
    mount(OutputDisplayApp, {
      target: document.getElementById('app')!,
    });
  } else if (isSpoutOutput || isOutputWindow) {
    // Legacy / default output modes. Both mount SpoutOutputApp:
    //   spout-output → hidden OSR window, paint events → DXGI → Spout
    //   output       → visible projector/external-display window with
    //                  its own Three.js compositor + state-sync
    // The visible `output` path is the production fallback when the
    // WebRTC experiment is off or fails its success-criteria sweep.
    const { default: SpoutOutputApp } = await import('./SpoutOutputApp.svelte');
    mount(SpoutOutputApp, {
      target: document.getElementById('app')!,
    });
  } else {
    // Normal mode: full UI
    const { default: App } = await import('./App.svelte');
    mount(App, {
      target: document.getElementById('app')!,
    });
  }
}

init();
