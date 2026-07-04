<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '$lib/bridge';
  import { getNativeRendererStatus, setNativeRendererOutputWindow } from '$lib/api/native-renderer';
  import type { RenderEngine } from '../renderer/engine';
  import { settings } from '../stores/settings';

  export let isOpen = false;
  export let onClose: () => void = () => {};
  // Reference to the main canvas engine (kept for API compatibility)
  export let mainEngine: RenderEngine | null = null;

  // NOTE: rotation / cropRegion / showCursor used to be props bound from
  // App.svelte. They now live in $settings.output and reach the output
  // window via the BroadcastChannel state-sync, applied as CSS on the
  // output canvas. The thin shims below stay for any external callers
  // (admin panel, MIDI mapping, etc.) that still call them by name.

  export function setRotation(deg: number) {
    const norm = (((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    settings.update(s => ({ ...s, output: { ...s.output, outputRotation: norm } }));
  }

  export function setCropRegion(region: { x: number; y: number; width: number; height: number }) {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        outputCropX: region.x,
        outputCropY: region.y,
        outputCropWidth: region.width,
        outputCropHeight: region.height,
      },
    }));
  }

  export function setShowCursor(show: boolean) {
    settings.update(s => ({ ...s, output: { ...s.output, outputShowCursor: show } }));
  }

  export function toggleCursor() {
    let next = false;
    settings.update(s => {
      next = !(s.output.outputShowCursor ?? false);
      return { ...s, output: { ...s.output, outputShowCursor: next } };
    });
    return next;
  }

  // Update cursor position from main viewport (normalized 0-1 coordinates)
  export function updateCursorPosition(x: number, y: number) {
    // Cursor position forwarding can be added later
  }

  // Clear cursor when mouse leaves the main viewport
  export function clearCursor() {
    // Cursor clearing can be added later
  }

  // Read the experimental output-transport flags once at the call
  // site (synchronous get from the settings store). The open helpers apply
  // the precedence ordering (nativeCore > zeroCopy > webrtc > legacy).
  //   outputNativeCore    → opens the Rust/wgpu managed output window.
  //   experimentalZeroCopy → mounts OutputSharedTextureDisplayApp
  //                          (`?mode=webgpu-display`). On by default.
  //   experimentalWebRTC   → mounts OutputDisplayApp
  //                          (`?mode=webrtc-display`). Escape hatch.
  // Both off → SpoutOutputApp (`?mode=output`), legacy default.
  // See settings.ts experimental.outputNativeCore / outputZeroCopy /
  // outputWebRTC for the architectural rationale.
  function readExperimentalTransports(): {
    experimentalWebRTC: boolean;
    experimentalZeroCopy: boolean;
    outputNativeCore: boolean;
  } {
    let webrtc = false;
    let zeroCopy = false;
    let nativeCore = false;
    const unsub = settings.subscribe((s) => {
      webrtc = !!s.experimental?.outputWebRTC;
      zeroCopy = !!s.experimental?.outputZeroCopy;
      nativeCore = !!s.experimental?.outputNativeCore;
    });
    unsub();
    return { experimentalWebRTC: webrtc, experimentalZeroCopy: zeroCopy, outputNativeCore: nativeCore };
  }

  // Open output window — opens a draggable window (double-click to fullscreen)
  export async function openPopup(preferExternal: boolean = true) {
    const { experimentalWebRTC, experimentalZeroCopy, outputNativeCore } = readExperimentalTransports();
    if (outputNativeCore && await openNativeCoreOutput(preferExternal, false)) {
      return;
    }
    if (experimentalZeroCopy) {
      return openPopupZeroCopy(preferExternal);
    }
    const transportTag = experimentalWebRTC ? ' [WebRTC]' : '';
    try {
      // Get available displays from Electron
      const displays: any[] = await invoke('get_displays');

      let target = displays[0]; // fallback to first display
      if (preferExternal) {
        // Pick the first non-primary display
        const external = displays.find((d: any) => !(d.isPrimary ?? d.primary));
        if (external) {
          target = external;
        }
      }

      // Open at 1280x720 centered on the target display (not full size)
      const bounds = target.bounds || target;
      const winW = Math.min(1280, bounds.width);
      const winH = Math.min(720, bounds.height);
      const x = bounds.x + Math.round((bounds.width - winW) / 2);
      const y = bounds.y + Math.round((bounds.height - winH) / 2);

      await invoke('create_output_window', {
        width: winW, height: winH, x, y,
        fullscreen: false,
        displayId: target.id,
        experimentalWebRTC,
        experimentalZeroCopy: false, // legacy path only
      });
      isOpen = true;
      console.log(`[Output] Window opened on display "${target.label}" (${winW}x${winH})${transportTag}`);
    } catch (error) {
      console.error('Failed to create output window:', error);
      // Fallback: open without display info
      try {
        await invoke('create_output_window', {
          width: 1280, height: 720,
          x: 100, y: 100,
          fullscreen: false,
          experimentalWebRTC,
          experimentalZeroCopy: false,
        });
        isOpen = true;
      } catch (e2) {
        alert('Could not open output window: ' + e2);
      }
    }
  }

  // Zero-copy path: open the output window via window.open() so it
  // lives in the SAME renderer process as the editor (Chromium routes
  // same-origin window.open to the same renderer). This is the only
  // way to get true zero-copy VideoFrame transfer between editor and
  // output — cross-process Mojo IPC silently drops GpuMemoryBuffer
  // handles for generic MessagePort transfers.
  //
  // Flow:
  //   1. Pre-stage placement config with main process via IPC. The
  //      setWindowOpenHandler in main.js reads + clears it on the
  //      next matching window.open call.
  //   2. window.open(url, name, features) — Chromium creates the new
  //      BrowserWindow in the same renderer process and returns a
  //      Window proxy. main.js's did-create-window listener captures
  //      the BrowserWindow into the global `outputWindow` so existing
  //      placement IPCs (toggle fullscreen, move, close) keep working.
  //   3. Hand the Window proxy to the presenter via attachOutputWindow.
  //      The presenter listens for the output's 'ready' message and
  //      establishes the local MessageChannel from there.
  async function openPopupZeroCopy(preferExternal: boolean) {
    try {
      const displays: any[] = await invoke('get_displays');
      let target = displays[0];
      if (preferExternal) {
        const external = displays.find((d: any) => !(d.isPrimary ?? d.primary));
        if (external) target = external;
      }
      const bounds = target.bounds || target;
      const winW = Math.min(1280, bounds.width);
      const winH = Math.min(720, bounds.height);
      const x = bounds.x + Math.round((bounds.width - winW) / 2);
      const y = bounds.y + Math.round((bounds.height - winH) / 2);

      // 1) Pre-stage placement config so setWindowOpenHandler knows
      // where to put the new BrowserWindow.
      await invoke('configure_next_output_window', {
        displayId: target.id,
        width: winW,
        height: winH,
        x, y,
        fullscreen: false,
      });

      // 2) Open the window via the renderer. URL is the current
      // origin + ?mode=webgpu-display, which Vite serves for dev and
      // file:// resolves correctly for prod. setWindowOpenHandler
      // gates on the URL pattern; non-matching URLs are denied.
      const url = new URL(window.location.href);
      url.search = '?mode=webgpu-display';
      // Window features hint to Chromium; Electron's setWindowOpenHandler
      // will override these anyway with overrideBrowserWindowOptions.
      const features = `popup=true,width=${winW},height=${winH},left=${x},top=${y}`;
      const newWin = window.open(url.toString(), 'ga-output', features);
      if (!newWin) {
        alert('Output window failed to open. Check Chromium popup-blocker behaviour.');
        return;
      }
      isOpen = true;
      console.log(`[Output] Window opened on display "${target.label}" (${winW}x${winH}) [WebGPU zero-copy]`);

      // 3) Tell the presenter to attach to this window. The presenter
      // already has the editor canvas (registerEditorCanvas was called
      // from Canvas.svelte at mount). Once the new window's
      // OutputSharedTextureDisplayApp signals 'output-ready', the
      // presenter establishes the MessageChannel and starts pumping.
      const { attachOutputWindow } = await import('$lib/sync/outputSharedTexturePresenter');
      attachOutputWindow(newWin);
    } catch (err) {
      console.error('[Output] zero-copy open failed:', err);
      alert('Could not open zero-copy output window: ' + ((err as any)?.message ?? err));
    }
  }

  async function openNativeCoreOutput(preferExternal: boolean, fullscreen: boolean): Promise<boolean> {
    try {
      const status = await getNativeRendererStatus().catch(() => null);
      if (!status?.backend_ready) {
        console.warn(
          '[Output] Native render-core output requested but the core is not ready; falling back.',
          status?.last_frame_error ?? status,
        );
        return false;
      }

      const displays: any[] = await invoke('get_displays');
      let target = displays[0];
      if (preferExternal) {
        const external = displays.find((d: any) => !(d.isPrimary ?? d.primary));
        if (external) target = external;
      }

      const bounds = target?.bounds || target || { x: 100, y: 100, width: 1280, height: 720 };
      const displayX = bounds.x ?? 100;
      const displayY = bounds.y ?? 100;
      const displayW = bounds.width ?? 1280;
      const displayH = bounds.height ?? 720;
      const winW = fullscreen ? displayW : Math.min(1280, displayW);
      const winH = fullscreen ? displayH : Math.min(720, displayH);
      const x = fullscreen ? displayX : displayX + Math.round((displayW - winW) / 2);
      const y = fullscreen ? displayY : displayY + Math.round((displayH - winH) / 2);

      await setNativeRendererOutputWindow({
        title: 'Ghost Arcade Native Output',
        label: 'Ghost Arcade Native Output',
        width: winW,
        height: winH,
        x,
        y,
        fullscreen,
        attached: true,
        visible: true,
        decorations: !fullscreen,
        resizable: !fullscreen,
      });
      isOpen = true;
      console.log(
        `[Output] Native render-core output opened on display "${target?.label || target?.id || 'default'}" (${winW}x${winH})`,
      );
      return true;
    } catch (err) {
      console.warn('[Output] Native render-core output failed; falling back:', err);
      return false;
    }
  }

  // Open fullscreen on external monitor (or primary if no external)
  export async function openFullscreenExternal() {
    const { experimentalWebRTC, experimentalZeroCopy, outputNativeCore } = readExperimentalTransports();
    if (outputNativeCore && await openNativeCoreOutput(true, true)) {
      return;
    }
    if (experimentalZeroCopy) {
      // Reuse the openPopup zero-copy path with a fullscreen flag.
      // Need to also pre-stage the fullscreen bit in the placement
      // config so setWindowOpenHandler picks the entire display
      // bounds and sets fullscreen:true on the BrowserWindow options.
      try {
        const displays: any[] = await invoke('get_displays');
        const primary = displays.find((d: any) => d.isPrimary ?? d.primary) || displays[0];
        const target = displays.find((d: any) => !(d.isPrimary ?? d.primary)) || primary;
        await invoke('configure_next_output_window', {
          displayId: target.id,
          fullscreen: true,
        });
        const url = new URL(window.location.href);
        url.search = '?mode=webgpu-display';
        const newWin = window.open(url.toString(), 'ga-output', 'popup=true');
        if (!newWin) {
          alert('Output window failed to open. Check Chromium popup-blocker behaviour.');
          return;
        }
        isOpen = true;
        console.log(`[Output] Fullscreen on display ${target.label || target.id} [WebGPU zero-copy]`);
        const { attachOutputWindow } = await import('$lib/sync/outputSharedTexturePresenter');
        attachOutputWindow(newWin);
      } catch (err) {
        console.error('[Output] zero-copy fullscreen open failed:', err);
      }
      return;
    }
    const transportTag = experimentalWebRTC ? ' [WebRTC]' : '';
    try {
      const result: any = await invoke('output_fullscreen_external', { experimentalWebRTC, experimentalZeroCopy: false });
      isOpen = true;
      console.log(`[Output] Fullscreen on display ${result.displayId}, external=${result.isExternal}${transportTag}`);
    } catch (error) {
      console.error('Failed to open fullscreen output:', error);
    }
  }

  // Toggle fullscreen on existing output window
  export async function toggleFullscreen() {
    try {
      return await invoke('output_toggle_fullscreen');
    } catch (error) {
      console.error('Failed to toggle fullscreen:', error);
      return false;
    }
  }

  // Open output fullscreen in current window (local fallback)
  export function openFullscreen(containerEl: HTMLElement) {
    if (containerEl.requestFullscreen) {
      containerEl.requestFullscreen();
    }
  }

  export function close() {
    invoke('close_output_window').catch(() => {});
    setNativeRendererOutputWindow({ attached: false, visible: false }).catch(() => {});
    isOpen = false;
    onClose();
  }

  onDestroy(() => {
    close();
  });
</script>
