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
const isWebRTCDisplay = mode === 'webrtc-display';
const isWebGPUDisplay = mode === 'webgpu-display';

// Set global flags so Canvas.svelte knows not to create Spout sender/receiver
// Use try/catch because Electron's contextBridge.exposeInMainWorld makes these read-only
if (isSpoutOutput && !window.__SPOUT_OSR_MODE__) {
  try { (window as any).__SPOUT_OSR_MODE__ = true; } catch { /* already set by preload */ }
}

if ((isOutputWindow || isWebRTCDisplay || isWebGPUDisplay) && !(window as any).__OUTPUT_WINDOW_MODE__) {
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* already set by preload */ }
}

async function init() {
  if (isWebGPUDisplay) {
    // WebGPU zero-copy presentation surface: receives the editor
    // canvas frames over a same-process MessagePort as transferred
    // VideoFrames, builds a GPUExternalTexture per frame, and renders
    // a fullscreen quad. Counterpart to outputSharedTexturePresenter
    // on the editor side.
    const { default: OutputSharedTextureDisplayApp } = await import('./OutputSharedTextureDisplayApp.svelte');
    mount(OutputSharedTextureDisplayApp, {
      target: document.getElementById('app')!,
    });
  } else if (isWebRTCDisplay) {
    // WebRTC presentation surface: receives the editor canvas as a
    // same-process MediaStream and renders it into a single
    // <video srcObject>. Replaces the legacy second-renderer pattern
    // that ran its own RenderEngine + state-sync; that path was prone
    // to freezing on external displays under load. Single-renderer
    // architecture matches Resolume / TouchDesigner / VDMX.
    const { default: OutputDisplayApp } = await import('./OutputDisplayApp.svelte');
    mount(OutputDisplayApp, {
      target: document.getElementById('app')!,
    });
  } else if (isSpoutOutput || isOutputWindow) {
    // Legacy output paths (Spout OSR + visible output window second renderer).
    // SpoutOutput: hidden window, paint events → DXGI → Spout
    // OutputWindow: visible window on projector/external display
    // Set GHOSTARCADE_OUTPUT_LEGACY=1 to force the visible output to
    // route through here instead of the WebRTC path above.
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
