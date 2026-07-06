<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { invoke, isMac, isWindows } from '$lib/bridge';
  import {
    getNativeRendererCapabilities,
    getNativeRendererReadinessReport,
    getNativeRendererStatus,
    detachNativeRendererOutputWindow,
    setNativeRendererOutputWindow,
    startNativeRenderer,
  } from '$lib/api/native-renderer';
  import type { RenderEngine } from '../renderer/engine';
  import { settings } from '../stores/settings';
  import { project } from '../stores/layers';
  import {
    inferNativeGraphRuntimeFlags,
    updateNativeRendererRuntimeFromStartup,
  } from '../stores/nativeRenderer';

  export let isOpen = false;
  export let onClose: () => void = () => {};
  // Reference to the main canvas engine (kept for API compatibility)
  export let mainEngine: RenderEngine | null = null;

  const NATIVE_OUTPUT_READY_WAIT_MS = 1500;
  const NATIVE_OUTPUT_ACTIVE_WAIT_MS = 2500;
  const NATIVE_OUTPUT_READY_POLL_MS = 100;

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

  // Read the output-transport flags once at the call site (synchronous get
  // from the settings store). The open helpers apply
  // the precedence ordering (nativeCore > zeroCopy > webrtc > legacy).
  //   outputNativeCore    → opens the Rust/wgpu managed output window.
  //   zeroCopy            → mounts OutputSharedTextureDisplayApp
  //                          (`?mode=webgpu-display`). Fallback default.
  //   webRTC              → mounts OutputDisplayApp
  //                          (`?mode=webrtc-display`). Escape hatch.
  // Both off → SpoutOutputApp (`?mode=output`), legacy default.
  // The settings still live under `experimental` for migration stability.
  function readOutputTransports(): {
    webRTC: boolean;
    zeroCopy: boolean;
    nativeCore: boolean;
  } {
    const s = get(settings);
    return {
      webRTC: !!s.experimental?.outputWebRTC,
      zeroCopy: !!s.experimental?.outputZeroCopy,
      nativeCore: !!s.experimental?.outputNativeCore,
    };
  }

  // Open output window — opens a draggable window (double-click to fullscreen)
  export async function openPopup(preferExternal: boolean = true) {
    const { webRTC, zeroCopy, nativeCore } = readOutputTransports();
    if (nativeCore && await openNativeCoreOutput(preferExternal, false)) {
      return;
    }
    if (zeroCopy) {
      return openPopupZeroCopy(preferExternal);
    }
    const transportTag = webRTC ? ' [WebRTC]' : '';
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
        experimentalWebRTC: webRTC,
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
          experimentalWebRTC: webRTC,
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

      const status = await ensureNativeCoreReady(winW, winH);
      if (!status) {
        console.warn(
          '[Output] Native render-core output requested but the core is not ready; falling back.',
        );
        return false;
      }

      const configuredStatus = await setNativeRendererOutputWindow({
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
      await publishNativeRuntimeHandshake(configuredStatus).catch(() => {});

      const activeStatus = nativeManagedOutputIsActive(configuredStatus)
        ? configuredStatus
        : await waitForNativeManagedOutputActive();
      if (!nativeManagedOutputIsActive(activeStatus)) {
        console.warn(
          `[Output] Native render-core output did not present; falling back. ${nativeOutputActivationDetail(activeStatus)}`,
        );
        await detachNativeRendererOutputWindow().catch(() => {});
        const detachedStatus = await getNativeRendererStatus().catch(() => null);
        if (detachedStatus) await publishNativeRuntimeHandshake(detachedStatus).catch(() => {});
        return false;
      }

      if (activeStatus) await publishNativeRuntimeHandshake(activeStatus).catch(() => {});
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

  async function publishNativeRuntimeHandshake(status: Awaited<ReturnType<typeof getNativeRendererStatus>>) {
    const [capabilities, readiness] = await Promise.all([
      getNativeRendererCapabilities().catch(() => null),
      getNativeRendererReadinessReport().catch(() => null),
    ]);
    const graphFlags = inferNativeGraphRuntimeFlags(capabilities, readiness);
    updateNativeRendererRuntimeFromStartup(
      status,
      readiness,
      capabilities,
      graphFlags.graphCatalogComplete,
      graphFlags.nativeGraphSourceFrames,
    );
    return { capabilities, readiness };
  }

  function nativeOutputDriverReady(
    readiness: Awaited<ReturnType<typeof getNativeRendererReadinessReport>> | null | undefined,
  ): boolean {
    return !!readiness?.modes?.output_driver?.ok;
  }

  function nativeOutputDriverNotReadyDetail(
    readiness: Awaited<ReturnType<typeof getNativeRendererReadinessReport>> | null | undefined,
  ): string {
    const mode = readiness?.modes?.output_driver;
    if (mode?.detail) return mode.detail;
    const blocker = readiness?.modes?.full_v2?.blockers?.[0] || readiness?.blockers?.[0];
    return blocker || 'native output driver readiness report is unavailable';
  }

  async function waitForNativeCoreReady(deadlineMs = NATIVE_OUTPUT_READY_WAIT_MS) {
    const startedAt = Date.now();
    let last = await getNativeRendererStatus().catch(() => null);
    while (last?.running && !last.backend_ready && Date.now() - startedAt < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, NATIVE_OUTPUT_READY_POLL_MS));
      last = await getNativeRendererStatus().catch(() => null);
    }
    return last;
  }

  function nativeManagedOutputIsActive(
    status: Awaited<ReturnType<typeof getNativeRendererStatus>> | null | undefined,
  ): boolean {
    return !!(
      status?.running &&
      status.backend_ready &&
      status.output_window_attached &&
      status.output_swapchain_ready &&
      status.output_present_healthy &&
      Number(status.swapchain_presented ?? 0) > 0
    );
  }

  function nativeOutputActivationDetail(
    status: Awaited<ReturnType<typeof getNativeRendererStatus>> | null | undefined,
  ): string {
    if (!status) return 'No status was returned from the native render-core.';
    if (!status.running) return 'Native render-core is not running.';
    if (!status.backend_ready) return status.last_frame_error || 'Native render-core backend is not ready.';
    if (!status.output_window_attached) return 'Native output window is detached.';
    if (Number(status.swapchain_presented ?? 0) <= 0) {
      return `No native frames presented yet; last=${status.swapchain_last_present_result || 'none'}.`;
    }
    if (!status.output_swapchain_ready) {
      return `Native output swapchain is not ready; last=${status.swapchain_last_present_result || 'none'}.`;
    }
    if (!status.output_present_healthy) {
      return `Native output present is unhealthy after ${status.output_present_consecutive_failures ?? 0} consecutive failure(s); last=${status.swapchain_last_present_result || 'none'}.`;
    }
    return 'Native output status did not satisfy the active-present gate.';
  }

  async function waitForNativeManagedOutputActive(
    deadlineMs = NATIVE_OUTPUT_ACTIVE_WAIT_MS,
  ): Promise<Awaited<ReturnType<typeof getNativeRendererStatus>> | null> {
    const startedAt = Date.now();
    let last = await getNativeRendererStatus().catch(() => null);
    while (
      last?.running &&
      last.backend_ready &&
      !nativeManagedOutputIsActive(last) &&
      Date.now() - startedAt < deadlineMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, NATIVE_OUTPUT_READY_POLL_MS));
      last = await getNativeRendererStatus().catch(() => null);
    }
    return last;
  }

  async function ensureNativeCoreReady(fallbackWidth: number, fallbackHeight: number): Promise<boolean> {
    const existing = await waitForNativeCoreReady();
    if (existing?.backend_ready) {
      const handshake = await publishNativeRuntimeHandshake(existing).catch(() => null);
      if (!nativeOutputDriverReady(handshake?.readiness)) {
        console.warn(
          `[Output] Native render-core backend is ready but output driver gates are not: ${nativeOutputDriverNotReadyDetail(handshake?.readiness)}`,
        );
        return false;
      }
      return true;
    }
    if (existing?.running) {
      console.warn('[Output] Native render-core is running but not ready:', existing.last_frame_error ?? existing);
      return false;
    }

    const p = get(project);
    const width = Math.max(1, Math.round(p.width || fallbackWidth || 1920));
    const height = Math.max(1, Math.round(p.height || fallbackHeight || 1080));
    const backend = isMac ? 'metal' : isWindows ? 'd3d12' : 'vulkan';
    const decodeBackend = isWindows ? 'ffmpeg_d3d11va' : 'ffmpeg_software';

    await startNativeRenderer({
      backend,
      decode_backend: decodeBackend,
      width,
      height,
      target_fps: 60,
      present_mode: 'immediate',
      allow_tearing: false,
      max_frame_latency: 2,
      use_waitable_object: true,
      native_quality_policy: 'auto',
    });

    const started = await getNativeRendererStatus().catch(() => null);
    if (!started?.backend_ready) {
      console.warn('[Output] Native render-core did not become ready after start:', started?.last_frame_error ?? started);
      return false;
    }
    const handshake = await publishNativeRuntimeHandshake(started).catch(() => null);
    if (!nativeOutputDriverReady(handshake?.readiness)) {
      console.warn(
        `[Output] Native render-core started but output driver gates are not ready: ${nativeOutputDriverNotReadyDetail(handshake?.readiness)}`,
      );
      return false;
    }
    return true;
  }

  // Open fullscreen on external monitor (or primary if no external)
  export async function openFullscreenExternal() {
    const { webRTC, zeroCopy, nativeCore } = readOutputTransports();
    if (nativeCore && await openNativeCoreOutput(true, true)) {
      return;
    }
    if (zeroCopy) {
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
    const transportTag = webRTC ? ' [WebRTC]' : '';
    try {
      const result: any = await invoke('output_fullscreen_external', { experimentalWebRTC: webRTC, experimentalZeroCopy: false });
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
