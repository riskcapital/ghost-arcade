<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invoke } from '$lib/bridge';
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
  // site (synchronous get from the settings store). main.js applies
  // the precedence ordering (zeroCopy > webrtc > legacy) — we just
  // forward both bits.
  //   experimentalZeroCopy → mounts OutputSharedTextureDisplayApp
  //                          (`?mode=webgpu-display`). Opt-in.
  //   experimentalWebRTC   → mounts OutputDisplayApp
  //                          (`?mode=webrtc-display`). Default in 0.6.x.
  // Both off → falls back to webrtc-display (the v0.6.1 default).
  // See settings.ts experimental.outputZeroCopy / outputWebRTC for
  // the architectural rationale.
  function readExperimentalTransports(): { experimentalWebRTC: boolean; experimentalZeroCopy: boolean } {
    let webrtc = false;
    let zeroCopy = false;
    const unsub = settings.subscribe((s) => {
      webrtc = !!(s.experimental as any)?.outputWebRTC;
      zeroCopy = !!(s.experimental as any)?.outputZeroCopy;
    });
    unsub();
    return { experimentalWebRTC: webrtc, experimentalZeroCopy: zeroCopy };
  }

  // Open output window — opens a draggable window (double-click to fullscreen)
  export async function openPopup(preferExternal: boolean = true) {
    const { experimentalWebRTC, experimentalZeroCopy } = readExperimentalTransports();
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
        experimentalZeroCopy: false, // legacy IPC path only
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
      // from WebGPUCanvas at mount). Once the new window's
      // OutputSharedTextureDisplayApp signals 'output-ready', the
      // presenter establishes the MessageChannel and starts pumping.
      const { attachOutputWindow } = await import('$lib/sync/outputSharedTexturePresenter');
      attachOutputWindow(newWin);
    } catch (err) {
      console.error('[Output] zero-copy open failed:', err);
      alert('Could not open zero-copy output window: ' + ((err as any)?.message ?? err));
    }
  }

  // Open fullscreen on external monitor (or primary if no external)
  export async function openFullscreenExternal() {
    const { experimentalWebRTC, experimentalZeroCopy } = readExperimentalTransports();
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
    isOpen = false;
    onClose();
  }

  onDestroy(() => {
    close();
  });
</script>
