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
// `webrtc-display` is the legacy WebRTC output transport — kept as
// escape hatch behind `experimental.outputWebRTC`. See
// OutputDisplayApp.svelte for the full rationale.
const isWebRTCDisplay = mode === 'webrtc-display';
// `webgpu-display` is the production zero-copy output transport.
// When `experimental.outputZeroCopy` is on (default), main.js opens
// the output window in this mode and pairs it with the editor via a
// MessageChannelMain. This window mounts OutputSharedTextureDisplayApp
// — a WebGPU presenter that consumes editor VideoFrames via
// importExternalTexture for true zero-copy GPU sampling.
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
    // Production zero-copy: WebGPU presenter. Receives VideoFrames
    // from the editor via a cross-process MessagePort (paired by
    // main.js as a MessageChannelMain) and binds them via
    // importExternalTexture for GPU-resident sampling on a fullscreen
    // quad shader. The shader handles rotation/brightness/contrast/
    // gamma/fit-policy in WGSL — true linear-space color correction
    // instead of CSS filters. No state-sync; the editor pushes
    // transform deltas through the same port.
    const { default: OutputSharedTextureDisplayApp } = await import('./OutputSharedTextureDisplayApp.svelte');
    mount(OutputSharedTextureDisplayApp, {
      target: document.getElementById('app')!,
    });
  } else if (isWebRTCDisplay) {
    // Legacy escape hatch: WebRTC presentation-only output. Kept
    // around in case a specific driver/GPU combo lands on CPU
    // fallback in the WebGPU path; ops can flip the flag and diff
    // the two transports at runtime.
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
