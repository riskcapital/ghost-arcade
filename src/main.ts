import { mount } from 'svelte';
import { initErrorReporter } from './lib/utils/errorReporter';
import { silenceThreeSerializationNoise } from './lib/utils/silenceThreePatches';
// Theme system: importing the store self-registers + applies the saved
// theme to :root on first run, so every component's var(--ga-*) reads
// land before any markup mounts.
import './lib/theming/store';
// Theme-aware webfonts. The app uses two families globally: Space
// Grotesk for UI/display and IBM Plex Mono for technical readouts.
import './lib/theming/fonts.css';
// Global skin overrides — re-skins the existing markup to the v10
// visual identity (toolbar chips, layer rows, faders, status bar) so
// the new design lands without per-component edits.
import './lib/theming/studio-skin.css';
import { installRangeProgressSync } from './lib/theming/rangeProgress';

installRangeProgressSync();

// Patch THREE.Texture.toJSON before anything else — any tree walker that
// serializes a live texture would otherwise log "Unable to serialize Texture"
// per frame and starve the renderer.
silenceThreeSerializationNoise();

// Install global error handlers
initErrorReporter();

// Check URL mode parameter
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const isStage3DWindow = mode === 'stage-3d';
const isProjectionSimWindow = mode === 'projection-sim';
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
// `slice-display` is the per-slice multi-output window — one window per
// slice routed to a physical display. Each one mirrors the editor via
// BroadcastChannel state-sync and CSS-clips to its slice's region. See
// SliceOutputApp.svelte for the full architecture.
const isSliceDisplay = mode === 'slice-display';
// `slice-atlas` is the hidden OSR compositor for multi-slice zero-copy
// senders — renders every Spout/Syphon sender slice into one atlas
// texture that the native addon fans out to per-name senders. See
// SliceAtlasApp.svelte + docs/multi-slice-zerocopy-plan.md.
const isSliceAtlas = mode === 'slice-atlas';
// Dev/QA escape hatch: `?mode=mobile-remote` mounts the desktop mobile
// companion directly in a browser. The native iOS/Android standalone app
// lives behind src/native-mobile-main.ts + vite.config.native-mobile.ts so
// Capacitor-only code cannot leak into desktop installers.
const isMobileRemotePreview = mode === 'mobile-remote';

// Set global flags so Canvas.svelte knows not to create Spout sender/receiver
// Use try/catch because Electron's contextBridge.exposeInMainWorld makes these read-only
if (isSpoutOutput && !window.__SPOUT_OSR_MODE__) {
  try { (window as any).__SPOUT_OSR_MODE__ = true; } catch { /* already set by preload */ }
}

if ((isOutputWindow || isWebRTCDisplay || isWebGPUDisplay || isSliceDisplay || isSliceAtlas || isStage3DWindow || isProjectionSimWindow) && !(window as any).__OUTPUT_WINDOW_MODE__) {
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* already set by preload */ }
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 600);
  }
}

async function init() {
  if (isMobileRemotePreview) {
    const { default: MobileApp } = await import('./lib/components/MobileApp.svelte');
    mount(MobileApp, { target: document.getElementById('app')! });
    hideSplash();
    return;
  }
  if (isSliceDisplay) {
    // Per-slice multi-output window. Lazy-load so the slice-only
    // bundle doesn't ship to the editor process. Also needs the audio
    // + modulation broadcast receivers because Canvas.svelte (mounted
    // inside SliceOutputApp) reads from those stores during render.
    const [
      { default: SliceOutputApp },
      { startAudioBroadcastReceiver },
      { audioStore },
      { startModulationBroadcastReceiver },
    ] = await Promise.all([
      import('./SliceOutputApp.svelte'),
      import('./lib/sync/audioBroadcast'),
      import('./lib/stores/audio'),
      import('./lib/sync/modulationBroadcast'),
    ]);
    startAudioBroadcastReceiver({
      onFrame: (frame) => audioStore.injectBroadcastedFrame(frame),
    });
    startModulationBroadcastReceiver();
    mount(SliceOutputApp, {
      target: document.getElementById('app')!,
    });
  } else if (isWebGPUDisplay) {
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
  } else if (isSliceAtlas) {
    // Hidden OSR compositor for multi-slice zero-copy senders. Needs the
    // audio + modulation receivers because the master <Canvas/> it mounts
    // reads those stores during render (same as the other output modes).
    const [
      { default: SliceAtlasApp },
      { startAudioBroadcastReceiver },
      { audioStore },
      { startModulationBroadcastReceiver },
    ] = await Promise.all([
      import('./SliceAtlasApp.svelte'),
      import('./lib/sync/audioBroadcast'),
      import('./lib/stores/audio'),
      import('./lib/sync/modulationBroadcast'),
    ]);
    startAudioBroadcastReceiver({ onFrame: (frame) => audioStore.injectBroadcastedFrame(frame) });
    startModulationBroadcastReceiver();
    mount(SliceAtlasApp, {
      target: document.getElementById('app')!,
    });
  } else if (isStage3DWindow) {
    const { default: Stage3DWindowApp } = await import('./Stage3DWindowApp.svelte');
    mount(Stage3DWindowApp, {
      target: document.getElementById('app')!,
    });
  } else if (isProjectionSimWindow) {
    const { default: ProjectionSimulatorWindowApp } = await import('./ProjectionSimulatorWindowApp.svelte');
    mount(ProjectionSimulatorWindowApp, {
      target: document.getElementById('app')!,
    });
  } else if (isSpoutOutput || isOutputWindow) {
    // Legacy / default output modes. Both mount SpoutOutputApp:
    //   spout-output → hidden OSR window, paint events → DXGI → Spout
    //   output       → visible projector/external-display window with
    //                  its own Three.js compositor + state-sync
    // The visible `output` path is the production fallback when the
    // WebRTC experiment is off or fails its success-criteria sweep.
    //
    // These windows render shaders independently and have no microphone
    // access, so audio uniforms (audioLevel, audioBass, audioFFT,
    // audioWaveform) come out as zero unless we forward analysis bytes
    // from the editor. Wire the BroadcastChannel receiver before mounting
    // so the very first rendered frame has live audio.
    const [
      { default: SpoutOutputApp },
      { startAudioBroadcastReceiver },
      { audioStore },
      { startModulationBroadcastReceiver },
    ] = await Promise.all([
      import('./SpoutOutputApp.svelte'),
      import('./lib/sync/audioBroadcast'),
      import('./lib/stores/audio'),
      import('./lib/sync/modulationBroadcast'),
    ]);
    startAudioBroadcastReceiver({
      onFrame: (frame) => audioStore.injectBroadcastedFrame(frame),
    });
    // Without the modulation map, the OSR window's shaders + effects
    // sit at their un-modulated baseline even though audio data is
    // flowing. The receiver bulkLoads modulation entries and starts
    // the engine so OSR computes modulated values in parallel with
    // the editor.
    startModulationBroadcastReceiver();
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
