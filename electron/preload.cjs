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
  'spout_send_frame', 'spout_send_image',
  'spout_start_receiver', 'spout_stop_receiver', 'spout_receive_frame',
  'spout_start_osr', 'spout_stop_osr', 'spout_send_shared_texture',
  // Display/window
  'get_displays', 'create_output_window', 'close_output_window', 'move_output_window',
  'resize_output_window', 'show_main_window',
  // Pre-stage placement config for the next WebGPU zero-copy output
  // window opened via window.open() — see setWindowOpenHandler in
  // electron/main.js.
  'configure_next_output_window',
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
  'pick_directory', 'save_file_binary', 'save_file_text', 'save_project_dialog',
  'download_demo_zip', 'read_project_file',
  // Update installer download + launch
  'download_update_installer', 'launch_update_installer',
  // Texture sharing info (Spout/Syphon)
  'texture_share_info',
  // Output window controls
  'output_toggle_fullscreen',
  'output_fullscreen_external',
  'output_set_cursor',
  // Ping
  'ping',
  // Error reporting
  'report_error',
  // Debug log forwarding to main-process log file
  'debug_log',
  // Director AI agent streaming
  'http_fetch_stream',
  // License machine ID
  'license_get_machine_id',
  // Native renderer stubs
  'native_renderer_start', 'native_renderer_stop', 'native_renderer_submit_batch',
  'native_renderer_submit_commands', 'native_renderer_upload_source_gpu_shared_texture',
  'native_renderer_prefetch_media', 'native_renderer_set_decode_policy',
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
    const allowed = ['director-stream-chunk', 'director-stream-end', 'demo-download-progress', 'update-download-progress', 'spout-osr-status'];
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

// OSR zero-copy status events from main process
contextBridge.exposeInMainWorld('electronOSR', {
  /**
   * Listen for OSR status changes from main process.
   * Called when OSR zero-copy becomes active or falls back to CPU path.
   */
  onOsrStatus: (callback) => {
    ipcRenderer.on('spout-osr-status', (_event, data) => callback(data));
  },
});

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
