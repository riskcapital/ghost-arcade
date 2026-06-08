import { mount } from 'svelte';
import { Capacitor } from '@capacitor/core';
import { initErrorReporter } from './lib/utils/errorReporter';
import { silenceThreeSerializationNoise } from './lib/utils/silenceThreePatches';
// Theme system: importing the store self-registers + applies the saved
// theme to :root on first run, so every component's var(--ga-*) reads
// land before any markup mounts.
import './lib/theming/store';
// Theme-aware webfonts. The two themes use different families (Hanken
// Grotesk + IBM Plex Mono for Studio, Archivo + Chakra Petch + IBM
// Plex Mono + VT323 for Arcade). One stylesheet hits both so swapping
// at runtime needs no extra font request.
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

// Capacitor native shell (iOS / Android) — Ghost Arcade Mobile app.
// When the bundle runs inside the Capacitor WebView, default-mount the
// MobileApp regardless of URL params. The native shell never opens with
// ?mode= query strings, so this short-circuit is safe and keeps the desktop
// router below untouched.
const isCapacitorNative = Capacitor.isNativePlatform();

// Check URL mode parameter
const urlParams = new URLSearchParams(window.location.search);
const mode = urlParams.get('mode');
const isStage3DWindow = mode === 'stage-3d';
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
// Dev/QA escape hatch: `?mode=mobile-standalone` mounts the standalone
// mobile shell in any desktop browser so we can iterate the mobile UI
// without spinning up a sim or device. No Capacitor required.
const isMobileStandalonePreview = mode === 'mobile-standalone';
const isMobileRemotePreview = mode === 'mobile-remote';

// Set global flags so Canvas.svelte knows not to create Spout sender/receiver
// Use try/catch because Electron's contextBridge.exposeInMainWorld makes these read-only
if (isSpoutOutput && !window.__SPOUT_OSR_MODE__) {
  try { (window as any).__SPOUT_OSR_MODE__ = true; } catch { /* already set by preload */ }
}

if ((isOutputWindow || isWebRTCDisplay || isWebGPUDisplay || isSliceDisplay || isStage3DWindow) && !(window as any).__OUTPUT_WINDOW_MODE__) {
  try { (window as any).__OUTPUT_WINDOW_MODE__ = true; } catch { /* already set by preload */ }
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hidden');
    setTimeout(() => splash.remove(), 600);
  }
}

type MobileMode = 'standalone' | 'remote';
const MOBILE_MODE_KEY = 'ga-mobile-mode';

async function mountMobile(mode: MobileMode | null) {
  const target = document.getElementById('app')!;
  // Wipe any previously-mounted root before mounting the next mode.
  // Svelte 5's `mount` returns an instance with unmount(), but we cleanly
  // tear down by clearing the target — the old component's effects run their
  // cleanup hooks via the GC path. Cheap enough for a mode swap.
  target.innerHTML = '';

  if (mode === 'standalone') {
    const { default: StandaloneApp } = await import('./lib/components/StandaloneApp.svelte');
    mount(StandaloneApp, {
      target,
      props: { onSwitchMode: () => switchMobileMode() },
    });
    return;
  }
  if (mode === 'remote') {
    const { default: MobileApp } = await import('./lib/components/MobileApp.svelte');
    mount(MobileApp, { target });
    return;
  }
  // First-launch / cleared selection: show the picker.
  const { default: MobileModeSelect } = await import('./lib/components/MobileModeSelect.svelte');
  mount(MobileModeSelect, {
    target,
    props: {
      onSelect: (picked: MobileMode) => {
        try { localStorage.setItem(MOBILE_MODE_KEY, picked); } catch { /* private mode */ }
        mountMobile(picked);
      },
    },
  });
}

function switchMobileMode() {
  try { localStorage.removeItem(MOBILE_MODE_KEY); } catch { /* private mode */ }
  mountMobile(null);
}

async function init() {
  if (isCapacitorNative) {
    let stored: MobileMode | null = null;
    try {
      const raw = localStorage.getItem(MOBILE_MODE_KEY);
      if (raw === 'standalone' || raw === 'remote') stored = raw;
    } catch { /* private mode — show picker every launch */ }
    await mountMobile(stored);
    hideSplash();
    return;
  }
  if (isMobileStandalonePreview) {
    await mountMobile('standalone');
    hideSplash();
    return;
  }
  if (isMobileRemotePreview) {
    await mountMobile('remote');
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
  } else if (isStage3DWindow) {
    const { default: Stage3DWindowApp } = await import('./Stage3DWindowApp.svelte');
    mount(Stage3DWindowApp, {
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
