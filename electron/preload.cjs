/**
 * Ghost Arcade — Electron Preload Script
 *
 * Exposes a safe IPC bridge to the renderer process.
 * Replaces Tauri's `invoke()` with `window.electronAPI.invoke()`.
 * Also sets `window.__ELECTRON__` flag for runtime detection.
 *
 * NOTE: Must be CommonJS (.js) — Electron preload scripts with
 * contextIsolation: true do NOT support ESM (.mjs) reliably.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Allowed IPC commands — restrict renderer to known-safe operations
const ALLOWED_IPC_COMMANDS = new Set([
  // Spout
  'spout_is_available', 'spout_list_senders', 'spout_start_sender', 'spout_stop_sender',
  'spout_send_frame', 'spout_send_image', 'spout_get_status',
  'spout_start_receiver', 'spout_stop_receiver', 'spout_receive_frame',
  'spout_start_osr', 'spout_stop_osr', 'spout_send_shared_texture',
  // Multi-slice zero-copy senders (atlas OSR + native fan-out).
  // slice-atlas window publishes its packed layout here; main (re)builds
  // per-name senders + resizes the atlas OSR window. See
  // docs/multi-slice-zerocopy-plan.md.
  'texshare_atlas_layout', 'texshare_start_atlas', 'texshare_stop_atlas',
  // OSR window → main lifecycle callbacks. Fired from the hidden
  // SpoutOutputApp renderer when it's done initializing / has resized,
  // so the main process can flip osrActive=true and start forwarding
  // shared-texture paint events. Were missing from this allowlist
  // until recently, which made every "ready" signal fail silently —
  // osrActive stayed false, the CPU send pump ran instead, and the
  // operator had no visible signal that zero-copy was off.
  'spout_osr_ready', 'spout_osr_resize',
  // Display/window
  'get_displays', 'get_output_display_info',
  'create_output_window', 'configure_next_output_window',
  'close_output_window', 'move_output_window',
  'resize_output_window', 'show_main_window',
  // Stage 3D pop-out window + state relay
  'open_stage3d_window', 'stage3d_window_closing',
  'stage3d_publish_state', 'stage3d_get_state', 'stage3d_is_open',
  'stage3d_set_fullscreen', 'stage3d_get_fullscreen',
  // Projection Simulator pop-out window
  'open_projection_sim_window', 'projection_sim_window_closing', 'projection_sim_is_open',
  'projection_sim_set_fullscreen', 'projection_sim_get_fullscreen',
  // SRC tab Capture chooser — enumerates screens + app windows
  // with thumbnails so the renderer can show a Zoom/Slack-style picker.
  'screen_sources_list',
  // License
  'license_get_status', 'license_activate', 'license_deactivate', 'license_validate_online',
  // HTTP proxy
  'http_fetch', 'http_fetch_binary', 'http_put_binary',
  // Shader thumbnail
  'save_shader_thumbnail',
  // Cloud shader source persistence (saves synced .fs files to userData)
  'save_shader_source', 'list_shader_sources', 'delete_shader_source',
  // File system
  'pick_directory', 'save_file_binary', 'save_file_bytes', 'save_file_text', 'save_project_dialog',
  'jpeg_sequence_start', 'jpeg_sequence_write_frame', 'jpeg_sequence_finish', 'jpeg_sequence_cancel',
  'save_generated_asset',
  'video_loop_create', 'video_append_segment',
  // Native FFmpeg converter
  'video_converter_pick_webm', 'video_converter_pick_sequence_folder', 'video_converter_pick_output',
  'video_converter_start', 'video_converter_cancel', 'video_converter_reveal_path',
  // Fast sibling-asset materialization. Copies a known-on-disk file to a
  // destination path without round-tripping its bytes through base64+IPC.
  // Saves seconds per gigabyte over save_file_binary for large videos/.glb.
  'copy_file_to_project',
  'open_project_dialog',
  'download_demo_zip', 'read_project_file',
  // Update installer download + launch
  'open_external_url', 'download_update_installer', 'launch_update_installer',
  // Texture sharing info (Spout/Syphon)
  'texture_share_info',
  // Output window controls
  'output_toggle_fullscreen',
  'output_fullscreen_external',
  'output_set_cursor',
  // Per-slice multi-output windows (Phase 2 multi-output system)
  'output_open_slice_window',
  'output_close_slice_window',
  'output_list_slice_windows',
  // Ping
  'ping',
  // Restart the app — used when experimental flags (renderer / GPU
  // settings) need a fresh process to take effect.
  'app_relaunch',
  // Error reporting
  'report_error',
  // Debug log forwarding to main-process log file
  'debug_log',
  // Director AI agent streaming
  'http_fetch_stream',
  // License machine ID
  'license_get_machine_id',
  // Native renderer process bridge
  'native_renderer_start', 'native_renderer_stop', 'native_renderer_submit_batch',
  'native_renderer_submit_commands', 'native_renderer_run_compute_graph',
  'native_renderer_upload_source_gpu_shared_texture',
  'native_renderer_prefetch_media', 'native_renderer_clear_prefetch_cache',
  'native_renderer_clear_decode_preview_cache', 'native_renderer_clear_runtime_caches',
  'native_renderer_set_vram_budget', 'native_renderer_set_target_fps',
  'native_renderer_set_render_clock',
  'native_renderer_set_command_drain_policy', 'native_renderer_set_auto_present_policy',
  'native_renderer_set_decode_cpu_backup_policy',
  'native_renderer_set_decode_synthetic_fallback_policy',
  'native_renderer_set_texture_pool_cap', 'native_renderer_set_shader_precompile_policy',
  'native_renderer_set_media_prefetch_policy', 'native_renderer_set_media_drop_policy',
  'native_renderer_set_decode_preview_policy', 'native_renderer_set_decode_target_policy',
  'native_renderer_set_decode_upload_policy', 'native_renderer_set_decode_handoff_policy',
  'native_renderer_set_decode_estimate_cache_policy', 'native_renderer_set_present_policy',
  'native_renderer_set_metadata_cache_caps', 'native_renderer_attach_output_window',
  'native_renderer_detach_output_window', 'native_renderer_get_status',
  'native_renderer_get_stats', 'native_renderer_get_snapshot',
  'native_renderer_get_frame_snapshot',
  'native_renderer_get_capabilities',
  'native_renderer_get_readiness_report', 'native_renderer_export_snapshot_json',
  'native_renderer_reset_stats', 'native_renderer_set_decode_policy',
  'native_renderer_set_prefetch_policy', 'native_renderer_get_decode_capabilities',
  'native_renderer_set_output_window',
  // WLED — UDP DRGB packets to LED controllers on the LAN
  'wled_send_frame', 'wled_close_socket',
  // Ableton Link — LAN tempo/beat sync (session lives in main; the
  // renderer polls state and bridges tempo into the master BPM).
  'link_enable', 'link_disable', 'link_set_tempo', 'link_get_state',
]);

// Expose a bridge that mirrors Tauri's invoke() API
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Restricted invoke — only allows whitelisted IPC commands.
   * Frontend code can call: await window.electronAPI.invoke('spout_list_senders')
   */
  invoke: (command, args) => {
    if (!ALLOWED_IPC_COMMANDS.has(command)) {
      return Promise.reject(new Error(`IPC command not allowed: ${command}`));
    }
    return ipcRenderer.invoke(command, args);
  },

  /**
   * Listen for IPC events from main process (used by Director SSE streaming).
   * Returns a cleanup function that removes the listener.
   */
  on: (channel, callback) => {
    const allowed = ['director-stream-chunk', 'director-stream-end', 'demo-download-progress', 'update-download-progress', 'spout-osr-status', 'texshare-atlas-status', 'stage3d-fullscreen-changed', 'projection-sim-fullscreen-changed', 'video-converter-progress', 'video-loop-progress'];
    if (!allowed.includes(channel)) return () => {};
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Platform detection
   */
  platform: process.platform,

  /**
   * Resolve the absolute filesystem path for a File object obtained from
   * a drag-and-drop or <input type="file"> in the renderer.
   *
   * Replaces Electron's removed `File.path` property (gone since
   * Electron 32). The renderer now calls
   *   const path = window.electronAPI.getPathForFile(file);
   * instead of the old `(file as any).path`.
   *
   * Returns '' (empty string) if the input is not a File or the path
   * can't be resolved (e.g. files received from a remote drop or browser
   * sandbox). Callers must treat empty as "no real path available" and
   * fall back to the file picker / save-as flow.
   */
  getPathForFile: (file) => {
    try {
      if (!file || typeof file !== 'object') return '';
      // webUtils.getPathForFile is the official Electron 32+ replacement
      // for File.path. It accepts a Web File object and returns the
      // absolute path on disk. Throws if not a real File from the OS.
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});

// NDI (NewTek Network Device Interface) sender bridge — cross-platform
// network video streaming. The native addon is only built when the
// NDI Advanced SDK is present at compile time, so `available()`
// reflects "is the addon loadable AND the NDI runtime initialized?".
// On machines without NDI, every send returns { ok: false } and the
// app continues with Spout / Syphon as the only output transports.
contextBridge.exposeInMainWorld('ghostNDI', {
  available: () => ipcRenderer.invoke('ndi_available'),
  // Sender API
  createSender: (name) => ipcRenderer.invoke('ndi_create_sender', { name }),
  destroySender: (name) => ipcRenderer.invoke('ndi_destroy_sender', { name }),
  // Buffer data is structured-cloned over IPC; renderer passes a
  // Uint8Array, main receives a Node Buffer view of the same bytes.
  sendImage: (name, data, width, height) =>
    ipcRenderer.invoke('ndi_send_image', { name, data, width, height }),
  // Receiver API — discovery + per-source frame pull. Returns:
  //   findSources() → [{ name, url }, ...]
  //   createReceiver(name) → { ok, error? }
  //   destroyReceiver(name) → { ok }
  //   receiveFrame(name) → { width, height, frame, data } | null
  findSources: () => ipcRenderer.invoke('ndi_find_sources'),
  createReceiver: (sourceName) => ipcRenderer.invoke('ndi_create_receiver', { sourceName }),
  destroyReceiver: (sourceName) => ipcRenderer.invoke('ndi_destroy_receiver', { sourceName }),
  receiveFrame: (sourceName) => ipcRenderer.invoke('ndi_receive_frame', { sourceName }),
});

// OSC (Open Sound Control) UDP listener bridge.
//   start({ port }) → boots a dgram socket in main, listens for OSC
//     packets, parses them, sends each parsed message via the
//     'osc-msg' channel.
//   stop() → closes the socket.
//   status() → { listening, port, error }.
//   onMessage(cb) → cb(messages[]) on every received batch.
//   onStatus(cb) → cb({ listening, port, error }) on socket state change.
contextBridge.exposeInMainWorld('ghostOSC', {
  start: ({ port } = {}) => ipcRenderer.invoke('osc_start', { port }),
  stop: () => ipcRenderer.invoke('osc_stop'),
  status: () => ipcRenderer.invoke('osc_status'),
  onMessage: (cb) => {
    const handler = (_e, msgs) => { try { cb(msgs); } catch (err) { console.warn('[OSC] renderer handler', err); } };
    ipcRenderer.on('osc-msg', handler);
    return () => ipcRenderer.removeListener('osc-msg', handler);
  },
  onStatus: (cb) => {
    const handler = (_e, s) => { try { cb(s); } catch (err) { console.warn('[OSC] renderer status handler', err); } };
    ipcRenderer.on('osc-status', handler);
    return () => ipcRenderer.removeListener('osc-status', handler);
  },
});

// OSR zero-copy status events from main process
contextBridge.exposeInMainWorld('electronOSR', {
  /**
   * Listen for OSR status changes from main process.
   * Called when OSR zero-copy becomes active or falls back to CPU path.
   */
  onOsrStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('spout-osr-status', handler);
    return () => ipcRenderer.removeListener('spout-osr-status', handler);
  },
});

// (Cross-process MessagePort forwarder removed — proven not zero-copy
// in Electron 42 / Chromium 130. Cross-process VideoFrame transfer
// silently drops frames; only same-renderer-process MessageChannel
// preserves the GpuMemoryBufferHandle. The output window now opens
// via window.open() from the editor, putting both windows in the
// same renderer process where transferable VideoFrames work as
// designed. Main process configures the resulting BrowserWindow via
// setWindowOpenHandler. See outputSharedTexturePresenter.ts and
// OutputSharedTextureDisplayApp.svelte for the renderer-side glue.)

// Also set a detection flag (replaces __TAURI_INTERNALS__)
contextBridge.exposeInMainWorld('__ELECTRON__', true);

// Detect OSR mode from URL query param (?mode=spout-output)
const isOsrMode = typeof window !== 'undefined' && window.location.search.includes('mode=spout-output');
if (isOsrMode) {
  contextBridge.exposeInMainWorld('__SPOUT_OSR_MODE__', true);
}

// Detect output window mode (?mode=output)
const isOutputMode = typeof window !== 'undefined' && window.location.search.includes('mode=output');
if (isOutputMode) {
  contextBridge.exposeInMainWorld('__OUTPUT_MODE__', true);
}

console.log('[Preload] Bridge exposed: electronAPI + electronOSR + __ELECTRON__' +
  (isOsrMode ? ' + __SPOUT_OSR_MODE__' : '') +
  (isOutputMode ? ' + __OUTPUT_MODE__' : ''));
