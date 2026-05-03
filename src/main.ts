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

// Set global flags so Canvas.svelte knows not to create Spout sender/receiver
// Use try/catch because Electron's contextBridge.exposeInMainWorld makes these read-only
if (isSpoutOutput && !window.__SPOUT_OSR_MODE__) {
  try { (window as any).__SPOUT_OSR_MODE__ = true; } catch { /* already set by preload */ }
}

if (isOutputWindow && !(window as any).__OUTPUT_WINDOW_MODE__) {
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* already set by preload */ }
}

async function init() {
  if (isSpoutOutput || isOutputWindow) {
    // Output modes: render just the canvas fullscreen (no UI panels)
    // SpoutOutput: hidden window, paint events → DXGI → Spout
    // OutputWindow: visible window on projector/external display
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
