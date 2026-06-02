/**
 * Ghost Arcade — Electron Main Process
 *
 * Manages windows, IPC, plugin subprocesses, and zero-copy Spout output.
 *
 * Spout SEND pipeline (zero-copy, GPU-to-GPU):
 *   OSR BrowserWindow (hidden, useSharedTexture: true)
 *   → 'paint' event delivers OffscreenSharedTexture with DXGI handle
 *   → C++ N-API addon: OpenSharedResource1(handle) → ID3D11Texture2D
 *   → spoutDX::SendTexture(texture) → Spout shared texture (GPU VRAM)
 *   → Other apps receive (OBS, Resolume, MadMapper, etc.)
 *
 * No pixels touch CPU memory in the send path.
 */

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net as electronNet, protocol, screen, session, utilityProcess } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, fork, execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import dgram from 'dgram';
// License system removed in OSS build — see src/lib/stores/license.ts.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { parseOSCPacket } = require('./osc-parser.cjs');

// Force Chromium to use the discrete GPU (NVIDIA/AMD) on Optimus laptops.
// Must be set before app.whenReady() — affects the GPU process.
// GPU / DPI / autoplay tuning. Projection-safe mode avoids forcing Chromium
// presentation paths that can flicker or band on some Windows projector stacks.
const PROJECTION_SAFE_MODE = process.argv.includes('--projection-safe-mode') || process.env.GA_PROJECTION_SAFE_MODE === '1';
const EXPERIMENTAL_GPU_PRESENT = process.argv.includes('--experimental-gpu-present') || process.env.GA_EXPERIMENTAL_GPU_PRESENT === '1';
app.commandLine.appendSwitch('force_high_performance_gpu');
if (PROJECTION_SAFE_MODE) {
  app.commandLine.appendSwitch('disable-zero-copy');
  app.commandLine.appendSwitch('disable-features', 'HardwareOverlays');
} else {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  if (EXPERIMENTAL_GPU_PRESENT) {
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('enable-hardware-overlays');
  }
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Disable pinch-to-zoom at the browser level (we handle zoom ourselves)
app.commandLine.appendSwitch('disable-pinch');
// Force high DPI support — ensures CSS pixels match layout pixels
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Debug log to file (stdout doesn't always flush from background Electron)
// In production, __dirname is inside the asar (read-only), so write to %LOCALAPPDATA%
const _isAsar = __dirname.includes('app.asar');
const _logDir = _isAsar
  ? (process.platform === 'darwin'
      ? path.join(process.env.HOME || '/tmp', 'Library', 'Logs')
      : (process.env.LOCALAPPDATA || process.env.TEMP || '.'))
  : path.join(__dirname, '..');
const _logFile = path.join(_logDir, _isAsar ? 'ghost-arcade-debug.log' : 'electron-debug.log');
fs.writeFileSync(_logFile, `=== Electron started ${new Date().toISOString()} ===\n`);
const _origLog = console.log.bind(console);
console.log = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { fs.appendFileSync(_logFile, `${msg}\n`); } catch {}
  try { _origLog(...args); } catch {}
};
const _origErr = console.error.bind(console);
console.error = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { fs.appendFileSync(_logFile, `[ERR] ${msg}\n`); } catch {}
  try { _origErr(...args); } catch {}
};
console.log(`[Main] Projection safe mode=${PROJECTION_SAFE_MODE} experimentalGpuPresent=${EXPERIMENTAL_GPU_PRESENT}`);

// Prevent EPIPE crashes from killing the process
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
process.on('uncaughtException', (err) => {
  console.error('[Main] uncaughtException:', err?.stack || err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Main] unhandledRejection:', reason);
});

// App-level crash telemetry for GPU + utility child processes. Without these
// handlers a GPU-process crash (TDR, driver fault during HDMI swap, Chromium
// GPU sandbox fault) is logged by Chromium internally but never surfaces to
// our main log, so we never know why an exec crashed after the fact.
// Also: on some machines Chromium auto-disables GPU after repeated GPU-process
// crashes — logging lets us spot that state instead of blaming shaders.
app.on('gpu-process-crashed', (_ev, killed) => {
  console.error(`[Main] GPU process crashed (killed=${killed}). Chromium will attempt recovery; main window may reload.`);
});
app.on('child-process-gone', (_ev, details) => {
  if (!details) return;
  console.error(`[Main] child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name || ''}`);
});

// ============================================================
// Custom protocol: ghost-asset://
// ============================================================
//
// Why this exists:
//   The renderer (Chromium) blocks all `file://` URLs by default —
//   "Not allowed to load local resource". That ban applies to <video>,
//   <img>, fetch(), and Three.js loaders alike. Without a custom scheme
//   our AssetRef resolver could only produce URLs the loader couldn't
//   actually open, which is what showed up in the user's console as
//   "Not allowed to load local resource: file:///C:/Users/.../video.mp4".
//
//   We register `ghost-asset://` as a privileged scheme that is treated
//   like https for all the things <video> + <img> need (CORS, range
//   requests for video seek, supportFetchAPI, stream). The handler
//   resolves the URL back to a disk path and streams the bytes.
//
//   URL shape: `ghost-asset:///C:/Users/justi/Videos/clip.mp4`
//   The third slash after the scheme makes the rest look like a path
//   to net.fetch + Web Standards URL parsing. Spaces and other special
//   characters are percent-encoded by pathToGhostAssetUrl in the
//   renderer's assetRegistry.ts.
//
// privileged + standard:    Required so the URL parser treats it as
//                           hierarchical (`scheme://host/path`) rather
//                           than opaque (`scheme:opaque-data`).
// secure:                   Treated as https-equivalent — no mixed
//                           content warnings, allowed in service
//                           workers, etc.
// supportFetchAPI:          fetch() and Three.js loaders work.
// stream:                   <video> can issue Range requests for seeks
//                           without buffering the entire file first.
// corsEnabled:              Let renderer code read response bytes for
//                           thumbnails / canvas drawing without taint.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ghost-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

// ============================================================
// State
// ============================================================

let mainWindow = null;
let outputWindow = null;
let spoutOsrWindow = null;  // Hidden OSR window for zero-copy Spout output
// Per-slice multi-output windows. Keyed by sliceId; each entry is a
// borderless fullscreen BrowserWindow opened on a specific physical
// display. Phase 2 multi-output system — see SliceOutputApp.svelte
// for the renderer side and the `output_open_slice_window` /
// `output_close_slice_window` IPC handlers below.
const sliceWindows = new Map();
// Placement config staged by `configure_next_output_window` IPC and
// consumed by the next setWindowOpenHandler call for the WebGPU
// zero-copy output window. Cleared after consumption (or after a 5s
// timeout to avoid cross-call leakage).
let pendingOutputWindowConfig = null;
let pendingOutputWindowConfigTimer = null;
let sidecarProcess = null;

// Platform flags (used elsewhere in this file)
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Spout native addon
let spoutAddon = null;
let spoutOutput = null;     // SpoutOutput instance (sender)
let spoutReceiver = null;   // SpoutReceiver instance
let spoutSendActive = false;
let spoutSendCreating = false; // Prevent concurrent creation
let spoutSendName = 'ghostArcade';
let spoutFrameCount = 0;
let spoutLastLogTime = 0;

// OSR zero-copy state
let osrActive = false;       // True when OSR paint handler is forwarding to Spout
let osrCreating = false;     // Prevent concurrent OSR creation
let osrFrameCount = 0;
let osrLastLogTime = 0;
let osrWatchdog = null;
let spoutSendW = 1920;      // Output resolution for OSR window
let spoutSendH = 1080;

// ============================================================
// Sidecar: Rust WS/HTTP/Spout backend
// ============================================================

async function startNodeServer() {
  // Start the Node.js WS/HTTP server (server/ws-server.js)
  const serverPath = path.join(__dirname, '..', 'server', 'ws-server.js');
  if (!fs.existsSync(serverPath)) {
    console.warn('[Main] Node.js server not found at:', serverPath);
    return;
  }

  // Kill any stale process on port 9001 before starting
  try {
    if (process.platform === 'win32') {
      execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :9001 ^| findstr LISTENING\') do taskkill /F /PID %a', {
        shell: 'cmd.exe', stdio: 'ignore', timeout: 5000
      });
    } else {
      // macOS / Linux: use lsof to find and kill process on port 9001
      execSync("lsof -ti:9001 | xargs kill -9 2>/dev/null || true", {
        stdio: 'ignore', timeout: 5000
      });
    }
    // Small delay to let the port release
    await new Promise(r => setTimeout(r, 500));
  } catch {
    // No process on the port — good
  }

  console.log('[Main] Starting Node.js server:', serverPath);

  // Set env vars the server expects
  process.env.WS_PORT = '9001';
  process.env.HTTP_PORT = '9002';

  // Import the server module in-process — it auto-starts on import.
  // On Windows, dynamic import() needs a file:// URL, not a raw path.
  try {
    const serverUrl = new URL(`file:///${serverPath.replace(/\\/g, '/')}`).href;
    console.log('[Main] Importing server from:', serverUrl);
    await import(serverUrl);
    console.log('[Main] Server module loaded in-process');
  } catch (e) {
    console.error('[Main] Failed to load server in-process:', e.message);
    // Fallback: spawn with ELECTRON_RUN_AS_NODE
    console.log('[Main] Trying ELECTRON_RUN_AS_NODE spawn fallback...');
    try {
      sidecarProcess = spawn(process.execPath, [serverPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, WS_PORT: '9001', HTTP_PORT: '9002', ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        shell: false,
      });
      sidecarProcess.stdout?.on('data', (d) => console.log(`[Server] ${d.toString().trim()}`));
      sidecarProcess.stderr?.on('data', (d) => console.error(`[Server] ${d.toString().trim()}`));
      sidecarProcess.on('exit', (code) => { console.log(`[Main] Server exited ${code}`); sidecarProcess = null; });
      sidecarProcess.on('error', (err) => { console.error(`[Main] Server spawn error: ${err.message}`); });
    } catch (e2) {
      console.error('[Main] Server spawn fallback also failed:', e2.message);
    }
  }
}

function stopServer() {
  if (sidecarProcess) {
    try { sidecarProcess.kill(); } catch {}
    sidecarProcess = null;
  }
}

// ============================================================
// Texture Share Native Addon — Spout (Windows) / Syphon (macOS)
// ============================================================

// Texture-sharing platform: Spout on Windows (DXGI shared handles), Syphon on
// macOS (IOSurface). The two systems are unrelated; main.js dispatches per
// platform and the two native addons expose intentionally similar but not
// identical N-APIs. Platform name is used in IPC payloads so the renderer can
// label the UI accordingly.
const textureSharePlatform = process.platform === 'darwin' ? 'syphon' : 'spout';
const textureShareLabel = process.platform === 'darwin' ? 'Syphon' : 'Spout';

// Platform-specific class lookups. Exported as SpoutOutput/SpoutReceiver on
// Windows and SyphonOutput/SyphonReceiver on macOS — do not expect the other.
function getOutputClass(addon) {
  return isMac ? addon.SyphonOutput : addon.SpoutOutput;
}
function getReceiverClass(addon) {
  return isMac ? addon.SyphonReceiver : addon.SpoutReceiver;
}

function loadSpoutAddon() {
  if (spoutAddon) return spoutAddon;

  const addonName = isMac ? 'syphon_addon.node' : 'spout_addon.node';

  try {
    const addonPath = path.join(__dirname, 'native', 'build', 'Release', addonName);
    if (!fs.existsSync(addonPath)) {
      console.warn(`[${textureShareLabel}] Addon not found at:`, addonPath);
      return null;
    }
    spoutAddon = require(addonPath);
    console.log(`[${textureShareLabel}] Native addon loaded successfully`);
    try {
      const gpuInfo = spoutAddon.getGpuInfo();
      console.log(`[${textureShareLabel}] GPU adapters:`, JSON.stringify(gpuInfo.adapters));
      console.log(`[${textureShareLabel}] Selected adapter index:`, gpuInfo.selectedAdapter);
    } catch (e) {
      console.log(`[${textureShareLabel}] Could not get GPU info:`, e.message);
    }
    return spoutAddon;
  } catch (err) {
    console.error(`[${textureShareLabel}] Failed to load native addon:`, err.message);
    return null;
  }
}

// NDI native addon — cross-platform sender via NewTek's NDI SDK.
// Built by electron/native/CMakeLists.txt when the NDI SDK is detected
// at install time; missing addon = graceful degradation (UI shows
// "NDI not available" in the slice output-type picker, sends are
// silently dropped). See electron/native/ndi_addon.cpp.
let ndiAddon = null;
let ndiAddonLoadAttempted = false;
function loadNdiAddon() {
  if (ndiAddon) return ndiAddon;
  if (ndiAddonLoadAttempted) return null;
  ndiAddonLoadAttempted = true;
  try {
    const addonPath = path.join(__dirname, 'native', 'build', 'Release', 'ndi_addon.node');
    if (!fs.existsSync(addonPath)) {
      console.log('[NDI] Addon not built (SDK was missing at compile time). Install the NDI Advanced SDK from https://ndi.video/sdk then rebuild electron/native.');
      return null;
    }
    ndiAddon = require(addonPath);
    if (!ndiAddon.available()) {
      console.warn('[NDI] Addon loaded but NDIlib_initialize failed — runtime not available on this machine.');
      ndiAddon = null;
      return null;
    }
    console.log('[NDI] Addon loaded successfully');
    return ndiAddon;
  } catch (err) {
    console.error('[NDI] Failed to load addon:', err.message);
    return null;
  }
}
const ndiSenders = new Set();    // tracks live sender names so we can destroy on quit
const ndiReceivers = new Set();  // tracks live receiver source names

/**
 * Create a texture-sharing sender (platform-dispatched).
 *
 * Windows: new addon.SpoutOutput() → DXGI shared handle via SpoutDX. The
 * paired OSR BrowserWindow with useSharedTexture=true gives us DXGI handles
 * from Chromium's compositor, forwarded via sendTexture().
 *
 * macOS: new addon.SyphonOutput() → IOSurface-backed texture via Syphon.
 * Zero-copy is live on darwin too: the OSR paint handler hands the 4-byte
 * io_surface_id_t off to SyphonOutput.sendTexture, which CGLTexImageIOSurface2D-
 * wraps it into a GL_TEXTURE_RECTANGLE_ARB and publishFrameTexture()s it — no
 * pixel data ever crosses the CPU boundary. The legacy CPU path (renderer
 * getImageData → spout_send_image IPC → addon sendImage → glTexSubImage2D →
 * publishFrameTexture) is now compatibility fallback only, triggered if OSR
 * fails to start or the watchdog drops it after 3s of no frames.
 */
function createSpoutSender(name, width, height) {
  const addon = loadSpoutAddon();
  if (!addon) {
    console.error(`[${textureShareLabel}] Cannot create sender — addon not loaded`);
    return false;
  }

  if (spoutOutput) {
    try { spoutOutput.release(); } catch {}
    spoutOutput = null;
  }

  try {
    const OutputClass = getOutputClass(addon);
    if (!OutputClass) {
      console.error(`[${textureShareLabel}] addon missing ${isMac ? 'SyphonOutput' : 'SpoutOutput'} class`);
      return false;
    }
    spoutOutput = new OutputClass();

    // Windows Spout constructor synchronously initializes D3D11. Fail-fast if
    // it didn't (driver missing / adapter problem). macOS Syphon creates its
    // GL context lazily inside setSenderName; the check is meaningless before
    // then, so skip.
    if (!isMac) {
      const initialized = spoutOutput.isInitialized();
      console.log(`[Spout] SpoutOutput created, initialized=${initialized}`);
      if (!initialized) {
        console.error('[Spout] SpoutOutput D3D11 device failed to initialize! Spout OUT will not work.');
      }
    }
    spoutOutput.setSenderName(name);
    spoutSendActive = true;
    spoutSendName = name;
    spoutSendW = width;
    spoutSendH = height;
    spoutLastLogTime = Date.now();
    spoutFrameCount = 0;
    console.log(`[${textureShareLabel}] Sender "${name}" created`);

    // Zero-copy OSR path — works on both Windows (DXGI shared handle) and
    // macOS (IOSurface). The OSR BrowserWindow code below is platform-agnostic;
    // the addons diverge in what they do with the handle: SpoutOutput opens a
    // shared D3D11 resource, SyphonOutput looks up an IOSurface. If OSR fails
    // to start (e.g. Chromium didn't grant a shared texture), the watchdog
    // falls back to the CPU send pump transparently.
    try {
      createSpoutOsrWindow(width, height);
    } catch (err) {
      console.error(`[${textureShareLabel}] OSR window creation failed, using CPU path:`, err.message);
    }

    return true;
  } catch (err) {
    console.error(`[${textureShareLabel}] Failed to create sender:`, err.message);
    return false;
  }
}

function stopSpoutSender() {
  spoutSendActive = false;

  // Tear down OSR window first
  destroySpoutOsrWindow();

  if (spoutOutput) {
    try {
      spoutOutput.release();
    } catch {}
    spoutOutput = null;
  }

  console.log(`[${textureShareLabel}] Sender stopped`);
}

// ============================================================
// OSR Window — Zero-Copy Spout via useSharedTexture
// ============================================================

/**
 * Create a hidden offscreen BrowserWindow with GPU shared texture output.
 *
 * The paint event delivers DXGI shared texture handles from Chromium's
 * compositor. We pass these directly to SpoutDX::SendTexture — pure
 * GPU VRAM, no CPU involvement, <1ms per frame.
 */
function createSpoutOsrWindow(width, height) {
  if (spoutOsrWindow || osrCreating) {
    console.log(`[${textureShareLabel} OSR] Window already exists or creating`);
    return;
  }

  osrCreating = true;
  console.log(`[${textureShareLabel} OSR] Creating ${width}x${height} window`);

  try {
    spoutOsrWindow = new BrowserWindow({
      width: width,
      height: height,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: {
          useSharedTexture: true,
        },
        webgl: true,
      },
    });

    // Max frame rate for shared texture mode
    spoutOsrWindow.webContents.setFrameRate(240);

    // Paint event handler — the core zero-copy path.
    //
    // Handle format by platform:
    //   Windows: sharedTextureHandle is an 8-byte HANDLE (DXGI shared handle).
    //            SpoutOutput.sendTexture(handle) opens it via OpenSharedResource1
    //            and derives width/height from the D3D texture descriptor.
    //   macOS:   sharedTextureHandle is a 4-byte io_surface_id_t little-endian.
    //            SyphonOutput.sendTexture(handle, width, height) looks it up via
    //            IOSurfaceLookup and passes through publishFrameTexture.
    // The Windows addon ignores the extra width/height args, so we can call
    // with the same arg list on both platforms.
    const minHandleLen = isMac ? 4 : 8;
    spoutOsrWindow.webContents.on('paint', (event) => {
      if (!osrActive || !spoutOutput || !event.texture) {
        if (event.texture) event.texture.release();
        return;
      }

      try {
        const info = event.texture.textureInfo;
        const handle = info.sharedTextureHandle;
        const tw = info.codedSize?.width || width;
        const th = info.codedSize?.height || height;
        if (handle && handle.length >= minHandleLen) {
          spoutOutput.sendTexture(handle, tw, th);
          osrFrameCount++;

          const now = Date.now();
          if (now - osrLastLogTime > 5000) {
            const elapsed = (now - osrLastLogTime) / 1000;
            const fps = osrFrameCount / elapsed;
            console.log(`[${textureShareLabel} OSR] sendTexture ${tw}x${th} @ ${fps.toFixed(1)} fps`);
            osrFrameCount = 0;
            osrLastLogTime = now;
          }
        }
      } catch (err) {
        console.error(`[${textureShareLabel} OSR] paint handler error:`, err.message);
      } finally {
        // CRITICAL: Always release to avoid shared texture pool exhaustion
        event.texture.release();
      }
    });

    // Verify which GPU Chromium is using after the page loads
    spoutOsrWindow.webContents.on('did-finish-load', async () => {
      console.log(`[${textureShareLabel} OSR] Page loaded`);
      try {
        const gpuRenderer = await spoutOsrWindow.webContents.executeJavaScript(`
          (() => {
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl2') || c.getContext('webgl');
            if (!gl) return 'unknown';
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no ext';
          })()
        `);
        console.log(`[${textureShareLabel} OSR] Chromium GPU renderer:`, gpuRenderer);

        // The discrete-GPU check is Windows-specific: on Windows the DXGI
        // shared handle only cross-opens cleanly on the same adapter SpoutDX
        // uses, so Chromium landing on Intel iGPU while SpoutDX is on NVIDIA
        // breaks zero-copy. macOS has no equivalent failure mode — IOSurface
        // is cross-GPU by design, and Mac systems with dual GPUs arbitrate
        // via the OS automatic-graphics-switching policy.
        if (!isMac) {
          const isDiscreteGpu = gpuRenderer.includes('NVIDIA') || gpuRenderer.includes('AMD') || gpuRenderer.includes('Radeon');
          if (!isDiscreteGpu) {
            console.warn('[Spout OSR] WARNING: Chromium is NOT on discrete GPU! SharedTexture handles may fail.');
            console.warn('[Spout OSR] Expected NVIDIA/AMD, got:', gpuRenderer);
          }
        }
      } catch (err) {
        console.error(`[${textureShareLabel} OSR] GPU check failed:`, err.message);
      }
    });

    // Handle crashes — fall back to CPU path
    spoutOsrWindow.webContents.on('render-process-gone', (event, details) => {
      console.error(`[${textureShareLabel} OSR] Renderer process gone:`, details.reason);
      osrActive = false;
      notifyMainWindowOsrStatus(false, 'renderer-gone');
    });

    spoutOsrWindow.on('closed', () => {
      console.log(`[${textureShareLabel} OSR] Window closed`);
      spoutOsrWindow = null;
      osrActive = false;
      stopOsrWatchdog();
    });

    // Load the same Vite app URL with ?mode=spout-output
    // Load the same Vite app URL with ?mode=spout-output. `webgpu-disable=1`
    // is the belt-and-suspenders guard against the S4 WebGPU pilot ever
    // running in this OSR renderer. The primary defense is the
    // `!isOutputMode && !isOsrMode` gate on the pilot lifecycle/handoff
    // in Canvas.svelte; this URL override hard-stops the capability
    // probe so even a future bypass can't activate the pilot in the
    // OSR window.
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
    const isDev = !app.isPackaged;
    if (isDev) {
      spoutOsrWindow.loadURL(`${devUrl}?mode=spout-output&webgpu-disable=1`);
    } else {
      const filePath = path.join(__dirname, '..', 'dist', 'index.html');
      spoutOsrWindow.loadFile(filePath, { query: { mode: 'spout-output', 'webgpu-disable': '1' } });
    }

    console.log(`[${textureShareLabel} OSR] Window created`);
  } catch (err) {
    console.error(`[${textureShareLabel} OSR] Failed to create window:`, err.message);
    spoutOsrWindow = null;
  } finally {
    osrCreating = false;
  }
}

function destroySpoutOsrWindow() {
  osrActive = false;
  stopOsrWatchdog();

  if (spoutOsrWindow) {
    try {
      spoutOsrWindow.close();
    } catch {}
    spoutOsrWindow = null;
    console.log(`[${textureShareLabel} OSR] Window destroyed`);
  }

  // Notify main window to re-enable CPU readPixels path
  notifyMainWindowOsrStatus(false, 'stopped');
}

function notifyMainWindowOsrStatus(active, reason) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('spout-osr-status', { active, reason });
    } catch {}
  }
}

function startOsrWatchdog() {
  stopOsrWatchdog();
  let lastFrameCount = osrFrameCount;

  osrWatchdog = setInterval(() => {
    if (!osrActive) return;

    if (osrFrameCount === lastFrameCount) {
      // No new frames in 3 seconds — zero-copy is dead, switch to compatibility
      // CPU path. This is a degraded mode: the renderer will resume the
      // getImageData → spout_send_image readback pump, which is ~8 MB/frame at
      // 1080p. Logged as warn so the operator notices it in `tail -f` of the
      // main-process log.
      console.warn(`[${textureShareLabel} OSR] Watchdog: no frames for 3s — zero-copy DEAD, falling back to CPU compatibility path`);
      osrActive = false;
      notifyMainWindowOsrStatus(false, 'stale');
    }
    lastFrameCount = osrFrameCount;
  }, 3000);
}

function stopOsrWatchdog() {
  if (osrWatchdog) {
    clearInterval(osrWatchdog);
    osrWatchdog = null;
  }
}

let spoutReceiverName = null; // Track which sender we're connected to

function startSpoutReceiver(senderName) {
  const addon = loadSpoutAddon();
  if (!addon) throw new Error(`${textureShareLabel} addon not loaded`);

  if (spoutReceiver && spoutReceiverName === senderName) {
    console.log(`[${textureShareLabel}] Already receiving from: ${senderName}`);
    return {
      connected: true,
      senderName,
      width: spoutReceiver.getWidth() || 1920,
      height: spoutReceiver.getHeight() || 1080,
    };
  }

  if (spoutReceiver) {
    try { spoutReceiver.release(); } catch {}
  }

  const ReceiverClass = getReceiverClass(addon);
  if (!ReceiverClass) throw new Error(`${textureShareLabel} addon missing receiver class`);
  spoutReceiver = new ReceiverClass();
  const connected = spoutReceiver.connect(senderName);
  if (!connected) {
    console.warn(`[${textureShareLabel}] connect() returned false for "${senderName}" — sender not in directory yet`);
  }
  spoutReceiverName = senderName;
  console.log(`[${textureShareLabel}] Receiver connecting to: ${senderName}`);

  // Kick off one synchronous connect attempt so many senders give us dims
  // immediately; otherwise return placeholder dims and let the renderer's
  // poll loop pick them up when the native side hands them over. Previously
  // this function synchronously busy-waited up to 1s (10×100ms) on the main
  // process thread — during that second, every other IPC call queued and the
  // UI froze. Converting to a single try + placeholder dims keeps the main
  // thread responsive and trusts the receiver's existing poll-per-frame path
  // to provide real dims on the next update.
  let width = 0, height = 0;
  try {
    const frame = spoutReceiver.receiveImage();
    width = spoutReceiver.getWidth();
    height = spoutReceiver.getHeight();
    if (frame && width > 0 && height > 0) {
      console.log(`[${textureShareLabel}] Receiver connected to ${senderName}: ${width}x${height}`);
    }
  } catch {}

  if (width === 0) width = 1920;
  if (height === 0) height = 1080;
  console.log(`[${textureShareLabel}] Receiver result for ${senderName}: ${width}x${height} (may be placeholder until next frame)`);

  return {
    connected: true,
    senderName,
    width,
    height,
  };
}

function stopSpoutReceiver() {
  if (spoutReceiver) {
    try { spoutReceiver.release(); } catch {}
    spoutReceiver = null;
    spoutReceiverName = null;
  }
  console.log(`[${textureShareLabel}] Receiver stopped`);
}

function listSpoutSenders() {
  const addon = loadSpoutAddon();
  if (!addon) return [];

  try {
    return addon.listSenders();
  } catch (err) {
    console.error(`[${textureShareLabel}] listSenders error:`, err.message);
    return [];
  }
}

// ============================================================
// IPC Handlers
// ============================================================

// ─── OSC (Open Sound Control) UDP listener ──────────────────
// Pure dgram socket; the parser lives in osc-parser.cjs. State is
// module-scoped so handlers can start/stop/query it. Parsed messages
// stream to the renderer via webContents.send('osc-msg', ...) — the
// renderer-side router (src/lib/osc/oscRouter.ts) looks up bindings
// and dispatches through midiRouter.dispatchPath.
let oscSocket = null;
let oscPort = 8000;
let oscLastError = null;
function stopOSC() {
  if (oscSocket) {
    try { oscSocket.close(); } catch (e) { /* socket already gone */ }
    oscSocket = null;
  }
}
function startOSC(port, win) {
  stopOSC();
  oscPort = port;
  oscLastError = null;
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', (err) => {
      oscLastError = String(err.message || err);
      console.error('[OSC] socket error:', err);
      try { sock.close(); } catch (e) {}
      if (oscSocket === sock) oscSocket = null;
      // Notify renderer so the Settings UI can flip its listening dot
      // off + show the error string.
      if (win && !win.isDestroyed()) {
        win.webContents.send('osc-status', { listening: false, port, error: oscLastError });
      }
      resolve({ ok: false, error: oscLastError });
    });
    sock.on('message', (buf, rinfo) => {
      try {
        const msgs = parseOSCPacket(buf);
        if (msgs.length === 0) return;
        if (win && !win.isDestroyed()) {
          // Strip BigInt timetags (not structured-clone-friendly via
          // IPC) — renderer doesn't schedule on them anyway.
          const serializable = msgs.map(m => ({
            address: m.address,
            args: m.args.map(a => (typeof a === 'bigint' ? Number(a) : a)),
            tags: m.tags,
            from: rinfo.address + ':' + rinfo.port,
          }));
          win.webContents.send('osc-msg', serializable);
        }
      } catch (e) {
        console.warn('[OSC] parse error:', e);
      }
    });
    sock.bind(port, () => {
      oscSocket = sock;
      console.log('[OSC] listening on UDP port', port);
      if (win && !win.isDestroyed()) {
        win.webContents.send('osc-status', { listening: true, port, error: null });
      }
      resolve({ ok: true, port });
    });
  });
}

function registerIpcHandlers() {
  // --- Diagnostics ---
  ipcMain.handle('ping', () => {
    console.log('[IPC] ping received from renderer!');
    return 'pong';
  });

  // --- WLED ---
  // Realtime DRGB packets sent over UDP to WLED controllers on the
  // local network. Sockets are cached per-controller-id so we don't
  // recreate one per frame; the renderer holds the lifecycle by
  // calling wled_close_socket when a controller is removed.
  //
  // DRGB packet format (WLED protocol 2):
  //   [0]    = 2          (protocol id)
  //   [1]    = 255        (timeout in seconds; 255 ~= "stay live, don't fall back to effect")
  //   [2..]  = R,G,B,R,G,B,...  for each LED (max ~490 LEDs per packet)
  //
  // For >490 LEDs we'd need DNRGB (protocol 4) with a 16-bit start
  // index — v1 doesn't bother since most installs are under that.
  const wledSockets = new Map();  // controllerId -> dgram.Socket

  ipcMain.handle('wled_send_frame', async (_, { controllerId, ip, port, pixels }) => {
    if (!ip || !pixels || pixels.length === 0) return { ok: false, error: 'missing ip or pixels' };
    let sock = wledSockets.get(controllerId);
    if (!sock) {
      sock = dgram.createSocket('udp4');
      sock.on('error', (err) => {
        console.warn('[WLED] socket error for', controllerId, err.message);
      });
      wledSockets.set(controllerId, sock);
    }
    // pixels arrives as a Buffer (Node serializes Uint8Array → Buffer
    // across IPC). Either way the bytes are R,G,B triples already
    // packed by the renderer.
    const payload = Buffer.isBuffer(pixels) ? pixels : Buffer.from(pixels);
    const packet = Buffer.alloc(2 + payload.length);
    packet[0] = 2;     // DRGB
    packet[1] = 255;   // timeout
    payload.copy(packet, 2);
    return new Promise((resolve) => {
      sock.send(packet, 0, packet.length, port || 21324, ip, (err) => {
        resolve({ ok: !err, error: err?.message });
      });
    });
  });

  ipcMain.handle('wled_close_socket', async (_, { controllerId }) => {
    const sock = wledSockets.get(controllerId);
    if (sock) {
      try { sock.close(); } catch {}
      wledSockets.delete(controllerId);
    }
    return { ok: true };
  });

  // --- OSC ---
  ipcMain.handle('osc_start', async (_, { port }) => {
    return startOSC(port || 8000, mainWindow);
  });
  ipcMain.handle('osc_stop', () => {
    stopOSC();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('osc-status', { listening: false, port: oscPort, error: null });
    }
    return { ok: true };
  });
  ipcMain.handle('osc_status', () => ({
    listening: oscSocket !== null,
    port: oscPort,
    error: oscLastError,
  }));

  // --- NDI ---
  // available() reflects WHETHER WE CAN SEND: addon built + NDI runtime
  // initialized. Renderer uses this to disable the NDI option in the
  // slice output-type picker on machines where NDI isn't ready.
  ipcMain.handle('ndi_available', () => {
    const a = loadNdiAddon();
    return { available: !!a };
  });
  ipcMain.handle('ndi_create_sender', (_, { name }) => {
    const a = loadNdiAddon();
    if (!a) return { ok: false, error: 'NDI not available' };
    try {
      a.createSender({ name });
      ndiSenders.add(name);
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('ndi_destroy_sender', (_, { name }) => {
    const a = loadNdiAddon();
    if (!a) return { ok: false };
    try {
      a.destroySender({ name });
      ndiSenders.delete(name);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('ndi_send_image', (_, { name, data, width, height }) => {
    const a = loadNdiAddon();
    if (!a) return { ok: false };
    try {
      // data arrives as Buffer (Node automatically deserializes
      // structured-cloned Uint8Array). Addon expects Buffer<uint8_t>.
      a.sendImage({ name, data, width, height });
      return { ok: true };
    } catch (err) {
      // Log only periodically — a broken sender can spam at frame
      // rate. The renderer handles its own back-pressure via the
      // per-slice in-flight guard.
      return { ok: false, error: String(err.message || err) };
    }
  });
  // Receiver side — discovery + per-source frame pulls. The renderer
  // calls ndi_find_sources on an interval (1-2s) to update the UI
  // list; ndi_receive_frame is polled per-frame for any source the
  // user has bound to a clip.
  ipcMain.handle('ndi_find_sources', () => {
    const a = loadNdiAddon();
    if (!a) return [];
    try { return a.findSources(); }
    catch (err) { console.error('[NDI] findSources:', err.message); return []; }
  });
  ipcMain.handle('ndi_create_receiver', (_, { sourceName }) => {
    const a = loadNdiAddon();
    if (!a) return { ok: false, error: 'NDI not available' };
    try {
      a.createReceiver({ sourceName });
      ndiReceivers.add(sourceName);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
  ipcMain.handle('ndi_destroy_receiver', (_, { sourceName }) => {
    const a = loadNdiAddon();
    if (!a) return { ok: false };
    try {
      a.destroyReceiver({ sourceName });
      ndiReceivers.delete(sourceName);
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.handle('ndi_receive_frame', (_, { sourceName }) => {
    const a = loadNdiAddon();
    if (!a) return null;
    try { return a.receiveFrame({ sourceName }) || null; }
    catch (err) { return null; }
  });

  // Restart the app. Used when toggling experimental flags
  // (editorWebGPU, etc.) that change which renderer path the
  // process boots into — those decisions are made at startup so
  // changing them mid-run leaves the UI in a half-broken state.
  // app.relaunch schedules a fresh process for after exit;
  // app.exit(0) kills the current one without running quit handlers
  // (avoids "are you sure?" dialogs / save prompts hanging the relaunch).
  ipcMain.handle('app_relaunch', () => {
    console.log('[IPC] app_relaunch — restarting');
    app.relaunch();
    app.exit(0);
  });

  // --- Spout (native addon — zero-copy GPU) ---
  ipcMain.handle('spout_is_available', () => {
    const addon = loadSpoutAddon();
    const available = addon !== null;
    const label = process.platform === 'darwin' ? 'Syphon' : 'Spout';
    console.log(`[IPC] spout_is_available (${label}):`, available);
    return available;
  });

  // Return which texture sharing system is in use
  ipcMain.handle('texture_share_info', () => ({
    platform: textureSharePlatform,
    label: process.platform === 'darwin' ? 'Syphon' : 'Spout',
    available: loadSpoutAddon() !== null,
  }));

  ipcMain.handle('spout_list_senders', () => {
    return listSpoutSenders();
  });

  ipcMain.handle('spout_start_sender', (_, { name, width, height }) => {
    const requestedName = name || 'ghostArcade';

    // If sender is already active or being created, return existing state
    if ((spoutSendActive && spoutOutput) || spoutSendCreating) {
      console.log('[IPC] spout_start_sender: already active/creating, skipping');
      return {
        success: true,
        name: spoutSendName,
        width: width || 1920,
        height: height || 1080,
        mode: osrActive ? 'zero-copy' : 'cpu-sendimage',
      };
    }

    console.log('[IPC] spout_start_sender:', { name: requestedName, width, height });
    spoutSendCreating = true;
    const ok = createSpoutSender(requestedName, width || 1920, height || 1080);
    spoutSendCreating = false;
    const result = {
      success: ok,
      name: spoutSendName,
      width: width || 1920,
      height: height || 1080,
      mode: osrActive ? 'zero-copy' : 'cpu-sendimage',
    };
    console.log('[IPC] spout_start_sender result:', JSON.stringify(result));
    return result;
  });

  ipcMain.handle('spout_stop_sender', () => {
    console.log('[IPC] spout_stop_sender');
    stopSpoutSender();
    return { success: true };
  });

  // CPU path: renderer sends pixel data via IPC for SpoutDX to share
  let spoutDiagCount = 0;
  let spoutSendCallCount = 0;
  ipcMain.handle('spout_send_image', (_, args) => {
    // Unconditional first-call log so we can tell whether the renderer is
    // actually invoking this IPC at all. If this never prints while the
    // sender is supposedly active, the renderer's send-gate isn't firing
    // the invoke() call (store/flag issue, not a native issue).
    if (spoutSendCallCount < 3) {
      console.log(`[IPC] spout_send_image call #${spoutSendCallCount} — spoutSendActive=${spoutSendActive} spoutOutput=${!!spoutOutput} osrActive=${osrActive}`);
      spoutSendCallCount++;
    }

    if (!spoutSendActive || !spoutOutput) return false;

    // When OSR zero-copy is active, reject CPU readPixels frames —
    // they would stomp on the Spout sender with different resolution/timing
    if (osrActive) return true;

    // Validate argument shape before passing to the N-API addon. Malformed
    // args (e.g., a bug in the renderer sending a number instead of a
    // TypedArray) can crash the native binding. Return false on bad input
    // so the renderer's frame-drop counter increments instead of the main
    // process dying.
    if (!args || typeof args !== 'object') return false;
    const { data, width, height } = args;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return false;
    if (!data || typeof data.length !== 'number' || data.length === 0) return false;

    try {
      // Diagnostic: first 3 frames only
      if (spoutDiagCount < 3) {
        let nonZero = 0;
        const checkLen = Math.min(data.length || 0, 400);
        for (let i = 0; i < checkLen; i++) {
          if (data[i] !== 0) nonZero++;
        }
        console.log(`[${textureShareLabel}] DIAG frame ${spoutDiagCount}: ${width}x${height}, ${data.length} bytes, nonZero=${nonZero}/${checkLen}`);
        spoutDiagCount++;
      }

      // Pass data directly to addon — N-API accepts both Buffer and Uint8Array
      const ok = spoutOutput.sendImage(data, width, height);

      spoutFrameCount++;
      const now = Date.now();
      if (now - spoutLastLogTime > 5000) {
        const elapsed = (now - spoutLastLogTime) / 1000;
        const fps = spoutFrameCount / elapsed;
        console.log(`[${textureShareLabel}] SendImage ${width}x${height} @ ${fps.toFixed(1)} fps`);
        spoutFrameCount = 0;
        spoutLastLogTime = now;
      }

      return ok;
    } catch (err) {
      console.error(`[${textureShareLabel}] send_image error:`, err.message);
      return false;
    }
  });

  ipcMain.handle('spout_start_receiver', (_, { senderName }) => {
    console.log('[IPC] spout_start_receiver:', senderName);
    try {
      const result = startSpoutReceiver(senderName);
      console.log('[IPC] spout_start_receiver result:', JSON.stringify(result));
      return result;
    } catch (err) {
      console.error('[IPC] spout_start_receiver error:', err.message);
      return { connected: false, error: err.message };
    }
  });

  ipcMain.handle('spout_stop_receiver', (_, { senderName }) => {
    stopSpoutReceiver();
    return { success: true };
  });

  let recvFrameLogCount = 0;
  let recvFrameTotal = 0;
  let recvFrameSuccess = 0;
  let recvFrameNull = 0;
  let recvLastLogTime = Date.now();

  ipcMain.handle('spout_receive_frame', () => {
    recvFrameTotal++;

    if (!spoutReceiver) {
      if (recvFrameLogCount < 3) {
        console.log('[IPC] spout_receive_frame: no receiver');
        recvFrameLogCount++;
      }
      return null;
    }
    try {
      const frame = spoutReceiver.receiveImage();
      if (!frame) {
        recvFrameNull++;
        const now = Date.now();
        if (now - recvLastLogTime > 5000) {
          const elapsed = (now - recvLastLogTime) / 1000;
          const fps = recvFrameSuccess / elapsed;
          console.log(`[${textureShareLabel} Recv] ${fps.toFixed(1)} fps (${recvFrameSuccess} ok / ${recvFrameNull} null)`);
          recvLastLogTime = now;
          recvFrameNull = 0;
          recvFrameTotal = 0;
          recvFrameSuccess = 0;
        }
        return null;
      }
      const w = spoutReceiver.getWidth();
      const h = spoutReceiver.getHeight();
      recvFrameSuccess++;

      // Log FPS every 5 seconds for successful frames too
      const now = Date.now();
      if (now - recvLastLogTime > 5000) {
        const elapsed = (now - recvLastLogTime) / 1000;
        const fps = recvFrameSuccess / elapsed;
        console.log(`[${textureShareLabel} Recv] ${w}x${h} @ ${fps.toFixed(1)} fps`);
        recvLastLogTime = now;
        recvFrameNull = 0;
        recvFrameTotal = 0;
        recvFrameSuccess = 0;
      }

      return {
        data: frame,
        width: w,
        height: h,
      };
    } catch (err) {
      console.error('[IPC] spout_receive_frame error:', err.message);
      return null;
    }
  });

  ipcMain.handle('spout_get_status', () => {
    return {
      sender_active: spoutSendActive,
      sender_name: spoutSendName,
      sender_mode: osrActive ? 'zero-copy' : 'cpu-sendimage',
      osr_active: osrActive,
      receiver_active: spoutReceiver !== null,
      receivers: [],
    };
  });

  // --- OSR zero-copy lifecycle ---
  ipcMain.handle('spout_osr_ready', () => {
    console.log(`[${textureShareLabel} OSR] Renderer reports ready`);
    osrActive = true;
    osrLastLogTime = Date.now();
    osrFrameCount = 0;
    startOsrWatchdog();
    // Notify main window to disable readPixels
    notifyMainWindowOsrStatus(true, 'ready');
    return true;
  });

  ipcMain.handle('spout_osr_resize', (_, args) => {
    if (!args || typeof args !== 'object') return;
    const { width, height } = args;
    // Clamp to sane bounds — negative values or absurd sizes would throw or
    // hose the GPU-process's framebuffer allocator. Mirror the clamping
    // createOutputWindow applies (320..8192).
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = Math.max(320, Math.min(8192, Math.round(width)));
    const h = Math.max(180, Math.min(8192, Math.round(height)));
    if (spoutOsrWindow && !spoutOsrWindow.isDestroyed()) {
      try {
        spoutOsrWindow.setSize(w, h);
        spoutSendW = w;
        spoutSendH = h;
        console.log(`[${textureShareLabel} OSR] Resized to ${w}x${h}`);
      } catch (err) {
        console.error(`[${textureShareLabel} OSR] resize failed:`, err?.message || err);
      }
    }
  });

  // --- Output window ---
  // Two experimental flags control output transport:
  //   - `experimentalZeroCopy` → mounts OutputSharedTextureDisplayApp
  //     (WebGPU + GPUExternalTexture, the production target). Main
  //     process pairs the editor and output windows via a
  //     MessageChannelMain so the editor's MediaStreamTrackProcessor
  //     can ship VideoFrames directly into the output's WebGPU
  //     compositor with zero copies.
  //   - `experimentalWebRTC` → mounts OutputDisplayApp (legacy
  //     same-process WebRTC peer). Kept as escape hatch.
  // Selection precedence: zero-copy beats WebRTC beats legacy. The
  // renderer reads both settings flags and passes them through.
  ipcMain.handle('create_output_window', (_, { width, height, x, y, fullscreen, displayId, experimentalWebRTC, experimentalZeroCopy }) => {
    createOutputWindow(width, height, x, y, fullscreen, displayId, !!experimentalWebRTC, !!experimentalZeroCopy);
  });

  // Pre-stage placement config for the next WebGPU zero-copy output
  // window opening. Called by the editor renderer immediately before
  // `window.open('?mode=webgpu-display', ...)`. The setWindowOpenHandler
  // (in createMainWindow) reads + clears this on the next matching open.
  // Auto-clears after 5s if no open follows — prevents accidental
  // staleness across user clicks.
  ipcMain.handle('configure_next_output_window', (_, config) => {
    pendingOutputWindowConfig = config && typeof config === 'object' ? { ...config } : null;
    if (pendingOutputWindowConfigTimer) {
      clearTimeout(pendingOutputWindowConfigTimer);
      pendingOutputWindowConfigTimer = null;
    }
    if (pendingOutputWindowConfig) {
      pendingOutputWindowConfigTimer = setTimeout(() => {
        pendingOutputWindowConfig = null;
        pendingOutputWindowConfigTimer = null;
        console.log('[Output] pending config cleared (5s timeout)');
      }, 5000);
    }
    return true;
  });

  // Returns the NATIVE pixel resolution of the display the output window is
  // currently on (or the would-be target if no output window is open yet).
  // Used by the "Match Resolution" button — sets the project canvas to the
  // exact pixel dimensions of the projector / external monitor so there's
  // zero scaling between source and final output.
  ipcMain.handle('get_output_display_info', () => {
    const primary = screen.getPrimaryDisplay();
    let target;
    let isExternal = false;
    if (outputWindow && !outputWindow.isDestroyed()) {
      const bounds = outputWindow.getBounds();
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      target = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
    } else {
      target = screen.getAllDisplays().find(d => d.id !== primary.id) || primary;
    }
    isExternal = target.id !== primary.id;
    const nativeW = Math.round(target.bounds.width * target.scaleFactor);
    const nativeH = Math.round(target.bounds.height * target.scaleFactor);
    return {
      displayId: target.id,
      label: target.label || (isExternal ? 'External display' : 'Primary display'),
      isExternal,
      logicalWidth: target.bounds.width,
      logicalHeight: target.bounds.height,
      scaleFactor: target.scaleFactor,
      nativeWidth: nativeW,
      nativeHeight: nativeH,
    };
  });

  ipcMain.handle('close_output_window', () => {
    if (outputWindow) {
      outputWindow.close();
      outputWindow = null;
    }
  });

  // --- Display enumeration ---
  ipcMain.handle('get_displays', () => {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays();
    return all.map(d => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      width: d.bounds.width,
      height: d.bounds.height,
      x: d.bounds.x,
      y: d.bounds.y,
      isPrimary: d.id === primary.id,
      scaleFactor: d.scaleFactor,
    }));
  });

  // ── screen_sources_list ─────────────────────────────────────────────
  // Enumerate every capturable surface on this machine — physical
  // displays AND open application windows — for the SRC tab's "Capture"
  // chooser modal. Returns a thumbnail (data URL, ~320×180) + display
  // name + the desktopCapturer source id, which the renderer then feeds
  // into navigator.mediaDevices.getUserMedia({
  //   video: { mandatory: { chromeMediaSource: 'desktop',
  //                          chromeMediaSourceId: <id> } } })
  // to start the actual capture stream.
  //
  // Why we don't go through getDisplayMedia() for this: the platform
  // picker on Windows shows nothing (no native picker pre-Win11 24H2),
  // and on macOS pre-15 Electron's setDisplayMediaRequestHandler doesn't
  // forward source choice from the renderer. Building our own picker on
  // top of desktopCapturer.getSources() is the only way to give Windows
  // users the "pick a Chrome window" UX that Zoom/Slack/OBS provide.
  //
  // The thumbnails are PNG-encoded data URLs; ~30-50 KB each. With a
  // typical 5-15 capturable surfaces this is a few hundred KB total —
  // fine to send across IPC once when the modal opens.
  ipcMain.handle('screen_sources_list', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        display_id: s.display_id || null,
        // s.thumbnail is a NativeImage; serialize as a PNG data URL so
        // the renderer can drop it straight into an <img src=...>.
        thumbnailDataUrl: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        // Window icons (only present for window sources, may be null).
        appIconDataUrl: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
        // Coarse type hint so the UI can show a Display badge vs Window badge.
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      }));
    } catch (err) {
      console.error('[screen_sources_list] failed:', err);
      return [];
    }
  });

  // --- Output fullscreen on external monitor ---
  // Same `experimentalZeroCopy` / `experimentalWebRTC` opt-in as
  // create_output_window so fullscreen-direct mode also lands on the
  // new transport when the flag is on.
  ipcMain.handle('output_fullscreen_external', (_, args) => {
    const allDisplays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const external = allDisplays.find(d => d.id !== primary.id);
    const target = external || primary;
    const experimentalWebRTC = !!(args && args.experimentalWebRTC);
    const experimentalZeroCopy = !!(args && args.experimentalZeroCopy);

    createOutputWindow(target.bounds.width, target.bounds.height, target.bounds.x, target.bounds.y, true, target.id, experimentalWebRTC, experimentalZeroCopy);
    return { displayId: target.id, isExternal: !!external };
  });

  // --- Toggle output fullscreen ---
  ipcMain.handle('output_toggle_fullscreen', () => {
    if (outputWindow) {
      const isFs = outputWindow.isFullScreen();
      outputWindow.setFullScreen(!isFs);
      outputWindow.setMenuBarVisibility(isFs);
      return !isFs;
    }
    return false;
  });

  // --- Set cursor visibility on output window ---
  ipcMain.handle('output_set_cursor', (_e, show) => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.webContents.insertCSS(
        show ? 'html, body { cursor: default !important; }' : 'html, body { cursor: none !important; }'
      );
      return true;
    }
    return false;
  });

  // --- Per-slice multi-output windows (Phase 2) -------------------------
  //
  // Opens a borderless fullscreen BrowserWindow on a specific physical
  // display for one OutputSlice. Each window mounts SliceOutputApp via
  // `?mode=slice-display&sliceId=X`; that component mirrors the editor
  // via BroadcastChannel state-sync and CSS-clips to the slice's crop.
  //
  // Multiple slice windows can be open simultaneously — one per slice
  // assigned `targetType: 'display'`. The `sliceWindows` Map keeps the
  // references so we can close/move them later without re-opening.
  ipcMain.handle('output_open_slice_window', (_e, args) => {
    const { sliceId, displayId } = args || {};
    if (!sliceId || typeof sliceId !== 'string') {
      return { ok: false, error: 'sliceId required' };
    }

    // Resolve the target display. Falls back to the primary display if
    // the requested id is gone (operator unplugged a projector between
    // configuration and open).
    let target = null;
    if (typeof displayId === 'number') {
      target = screen.getAllDisplays().find(d => d.id === displayId) || null;
    }
    if (!target) target = screen.getPrimaryDisplay();

    // Close any existing window for this slice — re-opening should
    // always present a fresh state to the operator.
    const existing = sliceWindows.get(sliceId);
    if (existing && !existing.isDestroyed()) {
      try { existing.close(); } catch {}
      sliceWindows.delete(sliceId);
    }

    const bounds = target.bounds;
    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      title: `Ghost Arcade Output — slice ${sliceId}`,
      frame: false,
      fullscreen: true,
      simpleFullscreen: process.platform === 'darwin',
      autoHideMenuBar: true,
      skipTaskbar: false,
      backgroundColor: '#000000',
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        webgl: true,
        backgroundThrottling: false,
      },
    });
    win.setMenuBarVisibility(false);

    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
    const isDev = !app.isPackaged;
    // The slice window doesn't use the S4 WebGPU pilot (it runs the
    // legacy Three.js Canvas via state-sync). The webgpu-disable URL
    // flag keeps the capability probe from spinning up GPU resources
    // we don't need.
    const queryParts = [`mode=slice-display`, `sliceId=${encodeURIComponent(sliceId)}`, 'webgpu-disable=1'];
    if (isDev) {
      win.loadURL(`${devUrl}?${queryParts.join('&')}`);
    } else {
      const filePath = path.join(__dirname, '..', 'dist', 'index.html');
      win.loadFile(filePath, { query: { mode: 'slice-display', sliceId, 'webgpu-disable': '1' } });
    }

    sliceWindows.set(sliceId, win);
    win.on('closed', () => {
      if (sliceWindows.get(sliceId) === win) sliceWindows.delete(sliceId);
    });

    return { ok: true, sliceId, displayId: target.id };
  });

  ipcMain.handle('output_close_slice_window', (_e, args) => {
    const { sliceId } = args || {};
    if (!sliceId) return { ok: false, error: 'sliceId required' };
    const win = sliceWindows.get(sliceId);
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch {}
    }
    sliceWindows.delete(sliceId);
    return { ok: true };
  });

  ipcMain.handle('output_list_slice_windows', () => {
    // Returns the currently-open slice window IDs. The renderer uses
    // this to render an "Open / Close" toggle state per slice without
    // having to track window state locally.
    return Array.from(sliceWindows.entries())
      .filter(([, win]) => !win.isDestroyed())
      .map(([id]) => id);
  });


  // --- Show and focus main window ---
  ipcMain.handle('show_main_window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // --- Update installer download + launch ---
  // Downloads the installer for a new version into userData/updates/, sends
  // progress events to the renderer, and returns the local path. Renderer
  // can then call `launch_update_installer` to spawn the installer and quit.
  ipcMain.handle('download_update_installer', async (_, args) => {
    try {
      const { url } = args || {};
      if (typeof url !== 'string' || !url) throw new Error('url required');

      // Sanitize filename from URL (last path segment, alphanumeric + dot/dash)
      const tail = url.split('/').pop() || 'installer.bin';
      const safeName = tail.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const targetDir = path.join(app.getPath('userData'), 'updates');
      fs.mkdirSync(targetDir, { recursive: true });
      const targetPath = path.join(targetDir, safeName);

      console.log('[Update] Downloading', url, '->', targetPath);
      const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', {
            received,
            total: contentLength,
            percent: contentLength > 0 ? Math.round((received / contentLength) * 100) : -1,
          });
        }
      }

      fs.writeFileSync(targetPath, Buffer.concat(chunks));
      console.log('[Update] Saved installer:', targetPath);
      return { success: true, path: targetPath };
    } catch (err) {
      console.error('[Update] Download error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('launch_update_installer', async (_, args) => {
    try {
      const { path: installerPath } = args || {};
      if (typeof installerPath !== 'string' || !installerPath) throw new Error('path required');
      if (!fs.existsSync(installerPath)) throw new Error('installer not found');
      // Restrict to our updates directory to prevent running arbitrary files
      const updatesDir = path.join(app.getPath('userData'), 'updates');
      const normalized = path.normalize(installerPath);
      if (!normalized.startsWith(updatesDir)) {
        throw new Error('installer path outside updates directory');
      }
      console.log('[Update] Launching installer:', normalized);

      // Per-platform install flow.
      //
      // Windows: the file is an NSIS .exe — running it actually
      // installs over the current app. Quit ourselves shortly after
      // so the installer's "remove existing" step doesn't get
      // blocked by a running process.
      //
      // macOS: the file is a .dmg. There is NO auto-install — the
      // DMG mounts in Finder and the user drags the new app into
      // /Applications. Previous behavior was shell.openPath(dmg) +
      // app.quit() after 500ms, which:
      //   (a) raced the DMG mount with our process exiting, so on
      //       slow machines the user saw "Ghost Arcade quit while
      //       opening" with no DMG visible.
      //   (b) gave no clear handoff explaining that they need to
      //       drag the app over. Just looked broken.
      // Now we showItemInFolder + leave the app running. The
      // renderer's success state shows a clear "drag the new
      // version to Applications, then relaunch" message.
      if (process.platform === 'darwin') {
        shell.showItemInFolder(normalized);
        return { success: true, manualInstall: true };
      }

      // Windows (and any other future auto-install platform):
      // shell.openPath returns "" on success, error string on failure.
      const result = await shell.openPath(normalized);
      if (result) throw new Error(result);
      // Give the installer a moment to spawn before quitting ourselves.
      setTimeout(() => app.quit(), 500);
      return { success: true, manualInstall: false };
    } catch (err) {
      console.error('[Update] Launch error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // --- Project save dialog ---
  // Returns the user-chosen file path (absolute) or null if cancelled.
  // Renderer uses this to save .gha files to a known directory so we can
  // materialize blob URLs alongside as portable sibling files.
  ipcMain.handle('save_project_dialog', async (_, args) => {
    const { defaultPath, title, filters } = args || {};
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true, filePath: null };
    const result = await dialog.showSaveDialog(win, {
      title: title || 'Save Project As',
      defaultPath: defaultPath || 'project.gha',
      // Caller can override filters. Default keeps the .gha / All Files
      // combo for project saves.
      filters: Array.isArray(filters) && filters.length > 0
        ? filters
        : [
            { name: 'Ghost Arcade Project', extensions: ['gha'] },
            { name: 'All Files', extensions: ['*'] },
          ],
    });
    return { canceled: result.canceled, filePath: result.filePath || null };
  });

  // --- Open file picker for projects ---
  // Returns the chosen absolute path so the renderer can call
  // read_project_file separately. Reusable for any "open .gha" need.
  ipcMain.handle('open_project_dialog', async (_, args) => {
    const { title, filters } = args || {};
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return { canceled: true, filePath: null };
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Open Project',
      properties: ['openFile'],
      filters: Array.isArray(filters) && filters.length > 0
        ? filters
        : [
            { name: 'Ghost Arcade Project', extensions: ['gha'] },
            { name: 'All Files', extensions: ['*'] },
          ],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, filePath: null };
    return { canceled: false, filePath: result.filePaths[0] };
  });

  // --- Save raw text content to a file path (for the .gha JSON itself).
  // Same security model as save_file_binary but for UTF-8 text.
  ipcMain.handle('save_file_text', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { path: filePath, content } = args;
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'Invalid file path' };
      if (typeof content !== 'string') return { success: false, error: 'Content must be a string' };
      const normalized = path.normalize(filePath);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return { success: false, error: 'Invalid file path' };
      }
      fs.writeFileSync(normalized, content, 'utf8');
      return { success: true };
    } catch (err) {
      console.error('[Main] save_file_text error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  function extensionFromMime(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('mp4')) return '.mp4';
    if (m.includes('webm')) return '.webm';
    if (m.includes('quicktime')) return '.mov';
    if (m.includes('png')) return '.png';
    if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
    if (m.includes('gif')) return '.gif';
    if (m.includes('svg')) return '.svg';
    return '.bin';
  }

  function safeGeneratedAssetFilename(filename, mime) {
    const parsed = path.parse(String(filename || 'asset'));
    const base = (parsed.name || 'asset')
      .replace(/[^a-zA-Z0-9._ -]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'asset';
    const ext = (parsed.ext && parsed.ext.length <= 12)
      ? parsed.ext.replace(/[^a-zA-Z0-9.]/g, '')
      : extensionFromMime(mime);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    return `${base}_${stamp}_${rand}${ext || extensionFromMime(mime)}`;
  }

  // --- Persist generated/session blobs to app-managed disk storage ---
  // AI videos, looped clips, and recordings do not have an original filesystem
  // path. The renderer sends their bytes here once, then project saves can keep
  // a normal disk-backed AssetRef instead of a dead blob: URL.
  ipcMain.handle('save_generated_asset', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { filename, mime, bytes } = args;
      let buffer;
      if (Buffer.isBuffer(bytes)) {
        buffer = bytes;
      } else if (bytes instanceof ArrayBuffer) {
        buffer = Buffer.from(bytes);
      } else if (ArrayBuffer.isView(bytes)) {
        buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } else if (Array.isArray(bytes)) {
        buffer = Buffer.from(bytes);
      } else {
        return { success: false, error: 'Invalid bytes payload' };
      }
      if (!buffer.length) return { success: false, error: 'Generated asset is empty' };

      const dir = path.join(app.getPath('userData'), 'project-assets');
      fs.mkdirSync(dir, { recursive: true });
      const safeName = safeGeneratedAssetFilename(filename, mime);
      const dest = path.join(dir, safeName);
      fs.writeFileSync(dest, buffer);
      return { success: true, path: dest };
    } catch (err) {
      console.error('[Main] save_generated_asset error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // --- Cloud shader persistence to disk ---
  // Synced shaders from the public catalog are written to {userData}/shaders/<id>.fs
  // so they survive localStorage clears + reinstalls. localStorage stays as the
  // hot cache; disk is the source of truth on cold start.
  const SHADER_ID_RE = /^[a-zA-Z0-9._-]+$/;
  function shadersDir() {
    return path.join(app.getPath('userData'), 'shaders');
  }
  function safeShaderId(id) {
    const s = String(id || '');
    if (!s || !SHADER_ID_RE.test(s) || s.length > 128) {
      throw new Error('Invalid shader id');
    }
    return s;
  }

  ipcMain.handle('save_shader_source', (_, args) => {
    try {
      const { id, code } = args || {};
      const safeId = safeShaderId(id);
      if (typeof code !== 'string' || !code.length) throw new Error('Invalid code');
      if (code.length > 5 * 1024 * 1024) throw new Error('Shader too large (5MB max)');
      const dir = shadersDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${safeId}.fs`), code, 'utf8');
      return { success: true };
    } catch (e) {
      console.error('[IPC] save_shader_source error:', e.message);
      throw new Error(`Failed to save shader source: ${e.message}`);
    }
  });

  ipcMain.handle('list_shader_sources', () => {
    try {
      const dir = shadersDir();
      if (!fs.existsSync(dir)) return [];
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.fs'));
      return files
        .filter(f => SHADER_ID_RE.test(f.replace(/\.fs$/, '')))
        .map(f => {
          const id = f.replace(/\.fs$/, '');
          try {
            const code = fs.readFileSync(path.join(dir, f), 'utf8');
            return { id, code };
          } catch (e) {
            console.warn('[IPC] list_shader_sources skipped', f, e.message);
            return null;
          }
        })
        .filter(Boolean);
    } catch (e) {
      console.error('[IPC] list_shader_sources error:', e.message);
      return [];
    }
  });

  ipcMain.handle('delete_shader_source', (_, args) => {
    try {
      const safeId = safeShaderId(args && args.id);
      const fp = path.join(shadersDir(), `${safeId}.fs`);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return { success: true };
    } catch (e) {
      console.error('[IPC] delete_shader_source error:', e.message);
      throw new Error(`Failed to delete shader source: ${e.message}`);
    }
  });

  // --- Save shader thumbnail to disk ---
  ipcMain.handle('save_shader_thumbnail', (_, args) => {
    try {
      const { dir_path, filename, data } = args;
      // Security: validate filename has no path traversal
      const safeFilename = path.basename(String(filename || ''));
      if (!safeFilename || safeFilename !== filename) {
        throw new Error('Invalid filename');
      }
      // Security: restrict to userData directory
      const userDataDir = app.getPath('userData');
      const dir = path.resolve(dir_path);
      if (!dir.startsWith(userDataDir) && !dir.startsWith(app.getPath('temp'))) {
        throw new Error('Path outside allowed directory');
      }
      fs.mkdirSync(dir, { recursive: true });
      // data is a base64 string or Uint8Array
      const buf = typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data);
      if (buf.length > 10 * 1024 * 1024) throw new Error('File too large (10MB max)');
      fs.writeFileSync(path.join(dir, safeFilename), buf);
      return { success: true };
    } catch (e) {
      console.error('[IPC] save_shader_thumbnail error:', e.message);
      throw new Error('Failed to save thumbnail');
    }
  });

  // --- CORS-free HTTP proxy (Electron 33 has native fetch) ---
  // Security: validate URLs to prevent SSRF attacks
  function validateProxyUrl(urlStr) {
    let parsed;
    try { parsed = new URL(urlStr); } catch { throw new Error('Invalid URL'); }
    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP/HTTPS URLs allowed');
    }
    // Block private/internal IPs (except localhost for local services)
    const host = parsed.hostname;
    if (host === '0.0.0.0' || host === '::') throw new Error('Invalid host');
    // Allow known API hosts + localhost for Spout/local services
    const allowedHosts = [
      'api.anthropic.com', 'generativelanguage.googleapis.com',
      'api.lumalabs.ai', 'lumalabs.ai', 'luma.ai',
      'replicate.com', 'api.replicate.com', 'replicate.delivery',
      'storage.googleapis.com', 'pbxt.replicate.delivery',
      'ghostarcade.live', 'ghostarcade.live', 'ghostarcade.app',
      '127.0.0.1', 'localhost',
    ];
    const isAllowed = allowedHosts.some(h => host === h || host.endsWith('.' + h));
    if (!isAllowed) {
      console.warn('[Proxy] Blocked host:', host, 'from URL:', urlStr);
      // Block RFC1918 private ranges
      const parts = host.split('.').map(Number);
      if (parts.length === 4 && !isNaN(parts[0])) {
        if (parts[0] === 10) throw new Error('Private IP blocked');
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) throw new Error('Private IP blocked');
        if (parts[0] === 192 && parts[1] === 168) throw new Error('Private IP blocked');
        if (parts[0] === 169 && parts[1] === 254) throw new Error('Link-local blocked');
      }
    }
    return parsed;
  }

  ipcMain.handle('http_fetch', async (_, args) => {
    try {
      const { method, url, headers, body } = args;
      console.log('[http_fetch]', method, url);
      validateProxyUrl(url);
      const opts = { method: method || 'GET', headers: headers || {}, signal: AbortSignal.timeout(30000) };
      if (body && method !== 'GET') opts.body = body;
      const resp = await fetch(url, opts);
      const respBody = await resp.text();
      console.log('[http_fetch] Response:', resp.status, respBody.slice(0, 100));
      return {
        status: resp.status,
        body: respBody,
        headers: Object.fromEntries(resp.headers.entries()),
      };
    } catch (e) {
      console.error('[http_fetch] Error:', e.message);
      throw new Error(e.message || 'HTTP fetch failed');
    }
  });

  // --- SSE streaming fetch (for Director AI agent) ---
  // Returns a stream ID immediately, then sends chunks via webContents.send()
  let streamCounter = 0;
  ipcMain.handle('http_fetch_stream', async (event, args) => {
    const { url, headers, body } = args;
    const streamId = `stream_${++streamCounter}`;
    const sender = event.sender;

    try {
      validateProxyUrl(url);
      console.log('[http_fetch_stream]', url, 'streamId:', streamId);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...(headers || {}), 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(120000), // 2 min timeout for long AI responses
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        sender.send('director-stream-chunk', { streamId, type: 'error', error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}` });
        sender.send('director-stream-end', { streamId });
        return { streamId, status: resp.status };
      }

      // Read SSE stream line by line
      const reader = resp.body?.getReader();
      if (!reader) {
        sender.send('director-stream-chunk', { streamId, type: 'error', error: 'No response body' });
        sender.send('director-stream-end', { streamId });
        return { streamId, status: 200 };
      }

      const decoder = new TextDecoder();
      let buffer = '';

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === ':' || trimmed.startsWith(': ')) continue;
              if (trimmed.startsWith('data: ')) {
                const data = trimmed.slice(6);
                if (data === '[DONE]') continue;
                try {
                  if (!sender.isDestroyed()) {
                    sender.send('director-stream-chunk', { streamId, ...JSON.parse(data) });
                  }
                } catch (parseErr) {
                  // Non-JSON SSE line — forward as raw text
                  if (!sender.isDestroyed()) {
                    sender.send('director-stream-chunk', { streamId, type: 'raw', text: data });
                  }
                }
              }
            }
          }
        } catch (streamErr) {
          if (!sender.isDestroyed()) {
            sender.send('director-stream-chunk', { streamId, type: 'error', error: streamErr.message });
          }
        } finally {
          if (!sender.isDestroyed()) {
            sender.send('director-stream-end', { streamId });
          }
        }
      })();

      return { streamId, status: resp.status };
    } catch (e) {
      console.error('[http_fetch_stream] Error:', e.message);
      if (!sender.isDestroyed()) {
        sender.send('director-stream-chunk', { streamId, type: 'error', error: e.message });
        sender.send('director-stream-end', { streamId });
      }
      return { streamId, status: 0 };
    }
  });

  // --- Binary download returning base64 ---
  ipcMain.handle('http_fetch_binary', async (_, args) => {
    try {
      const { url, headers } = args;
      validateProxyUrl(url);
      const resp = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(60000) });
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 100 * 1024 * 1024) throw new Error('Response too large (100MB max)');
      return {
        status: resp.status,
        data: Buffer.from(buf).toString('base64'),
        headers: Object.fromEntries(resp.headers.entries()),
      };
    } catch (e) {
      throw new Error(e.message || 'Binary fetch failed');
    }
  });

  // --- Binary PUT from base64 ---
  ipcMain.handle('http_put_binary', async (_, args) => {
    try {
      const { url, headers, data } = args;
      validateProxyUrl(url);
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 100 * 1024 * 1024) throw new Error('Payload too large (100MB max)');
      const resp = await fetch(url, {
        method: 'PUT',
        headers: { ...(headers || {}), 'Content-Type': 'application/octet-stream' },
        body: buf,
        signal: AbortSignal.timeout(60000),
      });
      return { status: resp.status };
    } catch (e) {
      throw new Error(e.message || 'Binary PUT failed');
    }
  });

  // --- Directory picker (native dialog) ---
  ipcMain.handle('pick_directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose Save Location',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const dirPath = result.filePaths[0];
    const dirName = path.basename(dirPath);
    return { path: dirPath, name: dirName };
  });

  // --- Save binary file from base64 ---
  // Previously: zero validation + zero error handling. A locked/read-only path,
  // disk-full condition, OneDrive sync contention, or `base64Data === undefined`
  // would throw uncaught and the renderer's bare `await invoke(...)` would
  // reject as an unhandled promise rejection. Now: validate shape, wrap
  // everything, and return a structured error object the renderer can display.
  ipcMain.handle('save_file_binary', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { path: filePath, base64Data } = args;
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'Invalid file path' };
      if (typeof base64Data !== 'string') return { success: false, error: 'Invalid base64 data' };
      // Prevent writes to parent directories via path traversal in the filename
      // (the renderer gets its path from a dialog, so absolute is expected —
      // we just ensure the path is absolute and doesn't contain `..` segments
      // sneaking through user-constructed filenames).
      const normalized = path.normalize(filePath);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return { success: false, error: 'Invalid file path (must be absolute, no traversal)' };
      }
      const buf = Buffer.from(base64Data, 'base64');
      if (buf.length === 0 && base64Data.length > 0) {
        return { success: false, error: 'base64 decode produced empty buffer (invalid encoding)' };
      }
      fs.writeFileSync(normalized, buf);
      return { success: true };
    } catch (err) {
      console.error('[Main] save_file_binary error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // --- Copy an on-disk file to a project sibling path ---
  // Used by materializeBlobsInProject when saving — copies the user's original
  // picked-from-disk file (captured via webUtils.getPathForFile at import time)
  // alongside the .gha. Skips the base64 IPC round-trip that save_file_binary
  // requires for blob: URLs, which adds seconds per gigabyte for large videos.
  ipcMain.handle('copy_file_to_project', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { sourcePath, destPath } = args;
      if (typeof sourcePath !== 'string' || !sourcePath) {
        return { success: false, error: 'Invalid sourcePath' };
      }
      if (typeof destPath !== 'string' || !destPath) {
        return { success: false, error: 'Invalid destPath' };
      }
      const normSrc = path.normalize(sourcePath);
      const normDest = path.normalize(destPath);
      if (!path.isAbsolute(normSrc) || normSrc.includes('..')) {
        return { success: false, error: 'sourcePath must be absolute (no traversal)' };
      }
      if (!path.isAbsolute(normDest) || normDest.includes('..')) {
        return { success: false, error: 'destPath must be absolute (no traversal)' };
      }
      // Same-file no-op — common when the project sits in the same dir as the
      // original media (Save in place to a project folder of curated assets).
      try {
        const srcStat = fs.statSync(normSrc);
        if (fs.existsSync(normDest)) {
          const dstStat = fs.statSync(normDest);
          if (srcStat.ino === dstStat.ino && srcStat.dev === dstStat.dev) {
            return { success: true, skipped: 'same-file' };
          }
        }
      } catch { /* fall through to the actual copy */ }
      fs.copyFileSync(normSrc, normDest);
      return { success: true };
    } catch (err) {
      console.error('[Main] copy_file_to_project error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // --- Read a project file by absolute path (used by Recent Files reopen) ---
  // Returns { content, dir } on success. Restricted to .gha / .json / .shrnk files
  // to limit surface area from the renderer.
  ipcMain.handle('read_project_file', async (_, { path: filePath }) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Invalid file path');
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.gha' && ext !== '.json' && ext !== '.shrnk') {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, dir: path.dirname(filePath) };
  });

  // --- Download and extract demo project zip ---
  ipcMain.handle('download_demo_zip', async (_, { url }) => {
    const extractZip = (await import('extract-zip')).default;
    const targetDir = path.join(app.getPath('documents'), 'Ghost Arcade', 'Demo Project');

    // Check if already extracted
    const demoFile = path.join(targetDir, 'demo.gha');
    if (fs.existsSync(demoFile)) {
      // Read and return the existing project
      const content = fs.readFileSync(demoFile, 'utf-8');
      return { projectDir: targetDir, projectJSON: content, alreadyExists: true };
    }

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true });

    // Download the zip
    // Default URL: GitHub Releases asset (over Vercel/repo size limits, so
    // we host the demo bundle on the releases repo). Override by passing
    // `url` from the renderer if you need a different source.
    const downloadUrl = url || 'https://github.com/riskcapital/ghost-arcade-releases/releases/download/demo-assets/ghost-arcade-demo.zip';
    console.log('[Demo] Downloading from:', downloadUrl);

    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      // Report progress to renderer
      if (contentLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('demo-download-progress', {
          received,
          total: contentLength,
          percent: Math.round((received / contentLength) * 100),
        });
      }
    }

    // Write zip to temp file
    const zipBuffer = Buffer.concat(chunks);
    const tempZip = path.join(app.getPath('temp'), 'ghost-arcade-demo.zip');
    fs.writeFileSync(tempZip, zipBuffer);

    // Extract
    console.log('[Demo] Extracting to:', targetDir);
    await extractZip(tempZip, { dir: targetDir });

    // Cleanup temp zip
    try { fs.unlinkSync(tempZip); } catch {}

    // Find the .gha file (could be at root or in a subfolder)
    let illFile = demoFile;
    if (!fs.existsSync(illFile)) {
      // Search one level deep
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.gha')) {
          illFile = path.join(targetDir, entry.name);
          break;
        }
        if (entry.isDirectory()) {
          const subEntries = fs.readdirSync(path.join(targetDir, entry.name));
          const found = subEntries.find(f => f.endsWith('.gha'));
          if (found) {
            // Move contents up to targetDir
            const subDir = path.join(targetDir, entry.name);
            for (const f of subEntries) {
              fs.renameSync(path.join(subDir, f), path.join(targetDir, f));
            }
            try { fs.rmdirSync(subDir); } catch {}
            illFile = path.join(targetDir, found);
            break;
          }
        }
      }
    }

    if (!fs.existsSync(illFile)) {
      throw new Error('No .gha project file found in the demo zip');
    }

    const content = fs.readFileSync(illFile, 'utf-8');
    console.log('[Demo] Project loaded:', illFile);
    return { projectDir: targetDir, projectJSON: content, alreadyExists: false };
  });

  // Native renderer commands — stub as not available in Electron mode
  // (these are only used by the Tauri D3D11 native renderer)
  const nativeRendererStubs = [
    'native_renderer_start', 'native_renderer_stop', 'native_renderer_submit_batch',
    'native_renderer_submit_commands', 'native_renderer_upload_source_gpu_shared_texture',
    'native_renderer_prefetch_media', 'native_renderer_set_decode_policy',
    'native_renderer_set_present_policy', 'native_renderer_set_prefetch_policy',
    'native_renderer_get_stats', 'native_renderer_reset_stats',
    'native_renderer_get_decode_capabilities', 'native_renderer_set_output_window',
  ];
  for (const cmd of nativeRendererStubs) {
    ipcMain.handle(cmd, () => { throw new Error('Native renderer not available in Electron mode'); });
  }

  // License IPC removed in OSS build — every install is unlocked, no
  // activation, no machine fingerprinting, no online validation.

  // --- Error reporting to ghostarcade.live ---
  const ERROR_REPORT_URL = 'https://ghostarcade.live/api/error-report';
  const ERROR_REPORT_QUEUE = [];
  let errorReportInFlight = false;

  async function flushErrorReports() {
    if (errorReportInFlight || ERROR_REPORT_QUEUE.length === 0) return;
    errorReportInFlight = true;
    const report = ERROR_REPORT_QUEUE.shift();
    try {
      await fetch(ERROR_REPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      // Silently drop — don't let error reporting break the app
      console.warn('[ErrorReport] Failed to send:', e.message);
    }
    errorReportInFlight = false;
    if (ERROR_REPORT_QUEUE.length > 0) setTimeout(flushErrorReports, 1000);
  }

  // Renderer → main log forwarding. Appends a line to the same
  // ghost-arcade-debug.log file the main process writes to, so debug
  // messages from renderer code end up in one place.
  ipcMain.handle('debug_log', (_e, msg) => {
    try {
      const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
      fs.appendFileSync(_logFile, `[RENDERER] ${new Date().toISOString()} ${line}\n`);
    } catch {}
    return true;
  });

  ipcMain.handle('report_error', async (_, args) => {
    try {
      const { error, stack, context, severity } = args || {};
      if (!error) return { queued: false };

      // OSS build has no license / machine ID — leave both null in the
      // crash report so any self-hosted error endpoint can still parse the
      // payload shape but won't get user-identifying data.
      const licenseKey = null;
      const machineId = null;

      const report = {
        licenseKey,
        machineId,
        appVersion: app.getVersion(),
        platform: process.platform,
        error: String(error).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 10000) : undefined,
        context: context ? String(context).slice(0, 200) : undefined,
        severity: ['crash', 'error', 'warning'].includes(severity) ? severity : 'error',
        timestamp: new Date().toISOString(),
        metadata: {
          electron: process.versions.electron,
          node: process.versions.node,
          chrome: process.versions.chrome,
          arch: process.arch,
        },
      };

      // Queue up to 50 reports max
      if (ERROR_REPORT_QUEUE.length < 50) {
        ERROR_REPORT_QUEUE.push(report);
        flushErrorReports();
      }
      return { queued: true };
    } catch {
      return { queued: false };
    }
  });
}

// ============================================================
// Permissions — auto-grant webcam/media for fluid camera feed
// ============================================================
function setupPermissions() {
  // Whitelist of permissions the app legitimately needs.
  // 'midi' / 'midiSysex' added in v0.3.7 — without them, navigator.requestMIDIAccess()
  // was silently rejected on macOS (Chromium's macOS MIDI backend hard-requires the
  // granted permission), which is why MIDI controllers never appeared in Settings on
  // Mac. Windows happened to grant it via a different code path in older Electron
  // builds, masking the bug. Both platforms now go through this allowlist.
  const SAFE_PERMISSIONS = new Set([
    'media',
    'display-capture',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'local-fonts',
    'midi',
    'midiSysex',
  ]);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (SAFE_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    console.warn(`[Permissions] Denying '${permission}' request`);
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return SAFE_PERMISSIONS.has(permission);
  });

  // System audio capture: getDisplayMedia() needs an explicit handler in
  // Electron or it throws "Not supported". We now expose BOTH screens and
  // windows via the IPC `screen_sources_list` (used by the SRC tab's
  // capture chooser modal) and also keep this fallback handler for any
  // code path that still uses navigator.mediaDevices.getDisplayMedia()
  // directly — namely the audio analyzer's system-audio capture.
  //
  // The audio analyzer doesn't care which video source it gets back (it
  // uses the audio track and discards the video). It DOES care that the
  // returned stream has a loopback audio track.
  //
  // useSystemPicker is set to FALSE here on purpose. When true on macOS
  // 15+ Electron defers to the OS native picker; the OS picker may
  // return a stream WITHOUT an audio track unless the user explicitly
  // toggles "Share audio" in the picker. Result: the analyzer throws
  // "No audio track available" and the user has no idea what to do.
  // Setting useSystemPicker:false makes Electron invoke our callback
  // directly and honor our `audio: 'loopback'` request unconditionally
  // — system audio capture "just works" with no extra prompt. Screen
  // SELECTION (different feature) goes through the IPC path in
  // MediaTray.svelte's startScreenCapture(), unaffected by this.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const primaryScreen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (primaryScreen) {
        console.log(`[DisplayMedia] Granting loopback audio + auto-pick screen: ${primaryScreen.name}`);
        callback({ video: primaryScreen, audio: 'loopback' });
      } else {
        console.warn('[DisplayMedia] No screen sources available');
        callback({});
      }
    } catch (err) {
      console.error('[DisplayMedia] Error getting sources:', err);
      callback({});
    }
  }, { useSystemPicker: false });
}

// ============================================================
// Windows
// ============================================================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'Ghost Arcade',
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    // Window icon — single source-of-truth lives in build-resources/icons.
    // Was previously pointing at src-tauri/icons/icon.png (legacy from a
    // Tauri prototype that no longer exists in this repo); Electron logged
    // "Failed to load image" on every launch and fell back to its default
    // icon. Switched to .png on all platforms here because BrowserWindow
    // accepts PNG everywhere; .icns/.ico are only needed for the packaged
    // bundles which electron-builder pulls automatically.
    icon: path.join(__dirname, '..', 'build-resources', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      zoomFactor: 1.0,
    },
  });

  // Force zoom factor to 1.0 to prevent DPI scaling from misaligning overlays
  mainWindow.webContents.setZoomFactor(1.0);

  // Platform-specific menu handling
  if (process.platform === 'darwin') {
    // macOS: native app menu required for Copy/Paste/Undo to work in text fields
    const { Menu } = require('electron');
    const template = [
      {
        label: 'Ghost Arcade',
        submenu: [
          { label: 'About Ghost Arcade', role: 'about' },
          { type: 'separator' },
          { label: 'Settings', accelerator: 'Cmd+,', click: () => mainWindow.webContents.send('open-settings') },
          { type: 'separator' },
          { label: 'Hide Ghost Arcade', accelerator: 'Cmd+H', role: 'hide' },
          { label: 'Hide Others', accelerator: 'Cmd+Alt+H', role: 'hideOthers' },
          { label: 'Show All', role: 'unhide' },
          { type: 'separator' },
          { label: 'Quit Ghost Arcade', accelerator: 'Cmd+Q', role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', accelerator: 'Cmd+Z', role: 'undo' },
          { label: 'Redo', accelerator: 'Shift+Cmd+Z', role: 'redo' },
          { type: 'separator' },
          { label: 'Cut', accelerator: 'Cmd+X', role: 'cut' },
          { label: 'Copy', accelerator: 'Cmd+C', role: 'copy' },
          { label: 'Paste', accelerator: 'Cmd+V', role: 'paste' },
          { label: 'Select All', accelerator: 'Cmd+A', role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Toggle Full Screen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' },
          { type: 'separator' },
          { label: 'Reload', accelerator: 'Cmd+R', role: 'reload' },
          { label: 'Developer Tools', accelerator: 'Alt+Cmd+I', role: 'toggleDevTools' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', accelerator: 'Cmd+M', role: 'minimize' },
          { label: 'Close', accelerator: 'Cmd+W', role: 'close' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    // Windows/Linux: remove menu bar for clean UI
    mainWindow.setMenu(null);
  }

  // In development, load from Vite dev server
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // ── window.open() handler for the WebGPU zero-copy output window ──
  // The editor renderer opens the output window via window.open() with
  // `?mode=webgpu-display`. Same-origin window.open from a renderer
  // creates the new BrowserWindow in the SAME renderer process, which
  // is the only way to get true zero-copy VideoFrame transfer through
  // a MessageChannel (cross-process MessageChannelMain silently drops
  // GpuMemoryBuffer-backed VideoFrames in Chromium 130).
  //
  // Editor-side flow (see OutputWindow.svelte / outputSharedTexture-
  // Presenter.ts):
  //   1. invoke('configure_next_output_window', { displayId, width,
  //      height, fullscreen, x, y }) — pre-stages the placement config
  //      that setWindowOpenHandler will read on the next open call
  //   2. window.open(url, 'ga-output', '...') — synchronous; returns
  //      the Window object proxy
  //   3. await output's 'output-ready' message via window message
  //   4. Create local MessageChannel; post port2 to the new window;
  //      use port1 for the editor's pump
  //
  // The new BrowserWindow is captured into the existing `outputWindow`
  // global via `did-create-window` so all the existing placement IPCs
  // (output_toggle_fullscreen, output_set_cursor, move_output_window,
  // close_output_window) continue to operate on it transparently —
  // they see a normal BrowserWindow reference and don't care how it
  // was opened.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const isWebgpuOutput = details.url.includes('mode=webgpu-display');
    const isSliceDisplay = details.url.includes('mode=slice-display');
    if (!isWebgpuOutput && !isSliceDisplay) {
      // Block any other window.open from the renderer — the editor
      // shouldn't be opening arbitrary windows for any other reason.
      // The legacy output modes still go through the IPC create_output_window
      // path, which doesn't trigger this handler.
      return { action: 'deny' };
    }

    // Resolve placement from the pre-staged config (or sensible
    // defaults if the editor opened without configuring). Both the
    // webgpu-display output and the slice-display per-screen window
    // share the same staging IPC + handler so the slice window inherits
    // the same same-process / DOM-accessible properties that let it
    // read the editor's already-warped presentCanvas via window.opener.
    const cfg = pendingOutputWindowConfig || {};
    pendingOutputWindowConfig = null;
    const allDisplays = screen.getAllDisplays();
    let target = screen.getPrimaryDisplay();
    if (cfg.displayId) {
      const found = allDisplays.find(d => d.id === cfg.displayId);
      if (found) target = found;
    }
    const bounds = target.bounds;
    const fullscreen = !!cfg.fullscreen;
    const winW = fullscreen ? bounds.width : Math.max(320, Math.min(8192, Math.round(cfg.width || 1280)));
    const winH = fullscreen ? bounds.height : Math.max(240, Math.min(8192, Math.round(cfg.height || 720)));
    const winX = fullscreen ? bounds.x : Math.round(cfg.x ?? bounds.x + (bounds.width - winW) / 2);
    const winY = fullscreen ? bounds.y : Math.round(cfg.y ?? bounds.y + (bounds.height - winH) / 2);

    // Slice windows are projector-targeted: borderless + always fullscreen
    // matches the legacy `output_open_slice_window` behaviour. Output
    // windows keep the framed, resizable chrome for in-app preview.
    const isSliceWin = isSliceDisplay;
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: winW,
        height: winH,
        x: winX,
        y: winY,
        title: isSliceWin ? 'Ghost Arcade Output — slice' : 'Ghost Arcade Output',
        resizable: !isSliceWin,
        frame: !isSliceWin,
        fullscreen: isSliceWin ? true : fullscreen,
        simpleFullscreen: process.platform === 'darwin',
        autoHideMenuBar: true,
        skipTaskbar: false,
        backgroundColor: '#000000',
        hasShadow: !isSliceWin,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          webgl: true,
          backgroundThrottling: false,
          // Critical: the new window MUST share the main window's
          // session/partition for window.open same-process semantics
          // to apply. Electron's default behaviour does this, but
          // setting it explicitly removes any future surprise.
          session: mainWindow.webContents.session,
        },
      },
    };
  });

  // Capture the BrowserWindow created via window.open into the
  // `outputWindow` global so existing placement IPCs continue to work
  // against it. Also wire the close handler so we clear the global
  // when the user closes the output window.
  mainWindow.webContents.on('did-create-window', (newWindow, details) => {
    const url = details.url || '';
    const isWebgpuOutput = url.includes('mode=webgpu-display');
    const isSliceDisplay = url.includes('mode=slice-display');
    if (!isWebgpuOutput && !isSliceDisplay) return;
    if (isSliceDisplay) {
      // Per-screen slice window opened via window.open from the editor.
      // Lives in the SAME renderer process as the editor (Electron groups
      // same-origin window.open targets), so SliceOutputApp can read the
      // editor's already-warped presentCanvas via window.opener.document
      // — that's the whole point of routing slice display through window.open
      // instead of the legacy `output_open_slice_window` IPC (which spawns
      // a separate process whose blendRenderer black-frames on hidden
      // texture upload).
      try {
        const m = url.match(/sliceId=([^&]+)/);
        const sliceId = m ? decodeURIComponent(m[1]) : null;
        if (sliceId) {
          const existing = sliceWindows.get(sliceId);
          if (existing && existing !== newWindow && !existing.isDestroyed()) {
            try { existing.close(); } catch { /* */ }
          }
          sliceWindows.set(sliceId, newWindow);
          newWindow.on('closed', () => {
            if (sliceWindows.get(sliceId) === newWindow) sliceWindows.delete(sliceId);
          });
          console.log(`[Output] slice display window captured (zero-copy) for slice ${sliceId}`);
        }
      } catch (err) {
        console.warn('[Output] slice display capture failed:', err);
      }
      try { newWindow.setMenuBarVisibility(false); } catch { /* */ }
      if (process.env.GHOSTARCADE_SLICE_DEVTOOLS === '1') {
        try { newWindow.webContents.openDevTools({ mode: 'detach' }); } catch { /* */ }
      }
      return;
    }
    outputWindow = newWindow;
    try { newWindow.setMenuBarVisibility(false); } catch { /* */ }
    console.log('[Output] zero-copy output window captured into outputWindow global');
    // DevTools opt-in via env var to match the perf baseline of the
    // legacy output path (devtools allocates extra GPU surfaces +
    // renderer threads). Set GHOSTARCADE_OUTPUT_DEVTOOLS=1 in the
    // shell that runs `npm run desktop` to enable.
    if (process.env.GHOSTARCADE_OUTPUT_DEVTOOLS === '1') {
      try { newWindow.webContents.openDevTools({ mode: 'detach' }); } catch { /* */ }
    }
    newWindow.on('closed', () => {
      if (outputWindow === newWindow) outputWindow = null;
    });
  });

  // Main-window renderer-process crash recovery.
  //
  // Before this, an unrecoverable renderer crash (out-of-memory, D3D device
  // lost from an HDMI yank, driver TDR that Chromium can't recover from, etc.)
  // would leave the main window frozen with a sad-tab icon and no telemetry.
  // The hidden OSR window already has a crash handler — extending it to the
  // main window so a live VJ set isn't dead-in-the-water after a single
  // render-process fault. We auto-reload once; if it crashes again within a
  // short window we give up (prevents a reload-loop eating CPU).
  let _rendererCrashReloads = 0;
  let _lastRendererCrashAt = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now();
    const wasRecent = (now - _lastRendererCrashAt) < 30_000;
    _lastRendererCrashAt = now;
    if (wasRecent) _rendererCrashReloads++; else _rendererCrashReloads = 1;
    console.error(`[Main] MAIN renderer process gone (reason=${details.reason}, exitCode=${details.exitCode}). Reload attempt #${_rendererCrashReloads}`);
    if (_rendererCrashReloads > 3) {
      console.error('[Main] Too many renderer crashes in a row — not reloading to avoid a crash loop.');
      return;
    }
    try { mainWindow.reload(); } catch (e) { console.error('[Main] reload() threw:', e); }
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] MAIN renderer unresponsive (>30s). Giving it another 10s before we reload...');
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading() === false) {
        try { mainWindow.reload(); } catch {}
      }
    }, 10_000);
  });
  mainWindow.webContents.on('responsive', () => {
    console.log('[Main] MAIN renderer responsive again.');
  });

  // Forward renderer console messages to main process log
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (
      message.includes('[Luma]') ||
      message.includes('[lumaFetch]') ||
      message.includes('[http_fetch]') ||
      message.includes('[AutoMap]') ||
      message.includes('AutoMap') ||
      message.includes('[KF') ||
      message.includes('[GPU]') ||       // surface WebGL renderer info from Canvas.svelte
      message.includes('[animate-') ||   // animate-tick / animate-dbg diagnostics
      message.includes('[syphon-') ||    // syphon-gate / syphon-path send-flow diagnostics
      message.includes('[Syphon')        // any Syphon-tagged renderer log
    ) {
      console.log(`[Renderer] ${message}`);
    }
    // Also log all errors from renderer
    if (level >= 2) {
      console.log(`[Renderer:err] ${message}`);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Main window loaded');

    // Hot-reload: recreate OSR window when main window reloads (Vite HMR)
    if (spoutOsrWindow && spoutSendActive) {
      console.log(`[${textureShareLabel} OSR] Main window reloaded — recreating OSR window`);
      destroySpoutOsrWindow();
      setTimeout(() => {
        if (spoutSendActive) {
          createSpoutOsrWindow(spoutSendW, spoutSendH);
        }
      }, 3000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close output window if open — cleanup handled by cleanupAndQuit via window-all-closed
    if (outputWindow) {
      try { outputWindow.close(); } catch {}
      outputWindow = null;
    }
  });
}

function createOutputWindow(width, height, x, y, fullscreen = false, displayId = null, experimentalWebRTC = false, experimentalZeroCopy = false) {
  // Validate dimensions
  width = Math.max(320, Math.min(8192, Number(width) || 1920));
  height = Math.max(240, Math.min(8192, Number(height) || 1080));
  x = Number(x) || 0;
  y = Number(y) || 0;

  if (outputWindow) {
    outputWindow.close();
  }

  // Find the target display
  let targetDisplay = null;
  if (displayId) {
    targetDisplay = screen.getAllDisplays().find(d => d.id === displayId);
  }
  if (!targetDisplay) {
    // Default: pick external display if available, otherwise primary
    const allDisplays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    targetDisplay = allDisplays.find(d => d.id !== primary.id) || primary;
  }

  const bounds = targetDisplay.bounds;

  // If fullscreen, use the display bounds
  const winX = fullscreen ? bounds.x : Math.round(x ?? bounds.x);
  const winY = fullscreen ? bounds.y : Math.round(y ?? bounds.y);
  const winW = fullscreen ? bounds.width : Math.round(width || 1280);
  const winH = fullscreen ? bounds.height : Math.round(height || 720);

  outputWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    title: 'Ghost Arcade Output',
    resizable: true,
    frame: true,
    fullscreen: fullscreen,
    simpleFullscreen: process.platform === 'darwin',  // macOS: use simple fullscreen for VJ output (no Mission Control space)
    autoHideMenuBar: true,
    skipTaskbar: false,
    backgroundColor: '#000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      backgroundThrottling: false,
    },
  });

  // Hide menu bar for clean look
  outputWindow.setMenuBarVisibility(false);

  // Load the same Svelte app but in output mode (canvas only, no UI).
  //
  // `webgpu-disable=1` is a belt-and-suspenders guard against the S4
  // WebGPU pilot ever spinning up in this renderer process. The
  // primary defense is the `!isOutputMode && !isOsrMode` gate on the
  // pilot lifecycle/handoff in Canvas.svelte, but the settings store
  // is shared via state-sync — if a future code path bypasses the
  // mode-flag check, this URL override forces the capability probe
  // (webgpuCapability.ts) to report unsupported, which the lifecycle
  // gate also honors. Two independent failsafes, neither of which
  // requires the other to work.
  // Output mode selection. Three transports, in precedence order:
  //
  //   webgpu-display → mounts OutputSharedTextureDisplayApp. Editor
  //                    side runs MediaStreamTrackProcessor on
  //                    canvas.captureStream(60), reads GPU-backed
  //                    VideoFrames, and ships them via a cross-process
  //                    MessagePort (paired below via MessageChannelMain).
  //                    Output side calls
  //                    `device.importExternalTexture({source: frame})`
  //                    and renders a fullscreen quad in WebGPU. True
  //                    zero-copy GPU pipeline — the production target.
  //                    NOTE: `webgpu-disable=1` is NOT appended on this
  //                    path because we *need* WebGPU here. The output
  //                    process is still safe from the S4 pilot because
  //                    OutputSharedTextureDisplayApp doesn't import any
  //                    pilot code; the gate that mattered was the
  //                    legacy `output` mode.
  //
  //   webrtc-display → mounts OutputDisplayApp (legacy WebRTC peer).
  //                    Kept as fallback when WebGPU is unavailable.
  //
  //   output         → mounts SpoutOutputApp (the original full
  //                    renderer with state-sync + per-layer rendering).
  //                    Production default before zero-copy.
  //
  // Auto-DevTools detached so the OutputDisplayApp logs (signaling
  // state, getStats() values when ?stats=1) are visible without
  // hunting for the window's hidden DevTools shortcut.
  let outputMode;
  if (experimentalZeroCopy) outputMode = 'webgpu-display';
  else if (experimentalWebRTC) outputMode = 'webrtc-display';
  else outputMode = 'output';
  console.log(`[Output] Selected mode "${outputMode}" (zeroCopy=${experimentalZeroCopy} webRTC=${experimentalWebRTC})`);
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  const isDev = !app.isPackaged;
  // The webgpu-disable URL flag is a belt-and-suspenders guard for
  // legacy / WebRTC display modes where we don't want the S4 pilot
  // capability probe to trip. The new webgpu-display mode requires
  // WebGPU so we omit the flag there.
  const wantWebgpuDisable = outputMode !== 'webgpu-display';
  const queryParts = [`mode=${outputMode}`];
  if (wantWebgpuDisable) queryParts.push('webgpu-disable=1');
  if (isDev) {
    outputWindow.loadURL(`${devUrl}?${queryParts.join('&')}`);
    // Auto-DevTools on output is a debugging convenience but it changes
    // the perf profile measurably (devtools allocates extra GPU surfaces
    // + renderer threads). Opt in via env or a launch arg so smoothness
    // benchmarks match the Pro folder's no-devtools baseline. Set
    // GHOSTARCADE_OUTPUT_DEVTOOLS=1 in the shell that runs `npm run
    // desktop` to enable.
    if (process.env.GHOSTARCADE_OUTPUT_DEVTOOLS === '1') {
      try { outputWindow.webContents.openDevTools({ mode: 'detach' }); } catch {}
    }
  } else {
    const filePath = path.join(__dirname, '..', 'dist', 'index.html');
    const fileQuery = { mode: outputMode };
    if (wantWebgpuDisable) fileQuery['webgpu-disable'] = '1';
    outputWindow.loadFile(filePath, { query: fileQuery });
  }

  // (MessageChannelMain pairing removed for webgpu-display mode.
  // Cross-process VideoFrame transfer is silently dropped by Chromium
  // 130's Mojo IPC — only specific Mojo interfaces (RTCRtpSender,
  // MediaStreamTrack) preserve GpuMemoryBuffer handles cross-process,
  // not generic MessagePort. The webgpu-display path is now opened
  // via window.open() from the editor renderer (see
  // setWindowOpenHandler in createMainWindow), putting the output
  // window in the SAME renderer process where MessageChannel
  // transferables work as designed. This IPC path remains for the
  // legacy `output` and `webrtc-display` modes which are unaffected.)

  outputWindow.on('closed', () => {
    outputWindow = null;
  });

  console.log(`[Output] Window created on display "${targetDisplay.label || targetDisplay.id}" at ${winX},${winY} ${winW}x${winH} fullscreen=${fullscreen}`);
}

// ============================================================
// App Lifecycle
// ============================================================

// Ensure only one instance runs at a time
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[Main] Another instance is running — quitting');
  app.quit();
}

app.on('second-instance', () => {
  // Focus existing window when user tries to launch a second instance
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  setupPermissions();
  registerIpcHandlers();

  // Wire up the ghost-asset:// protocol handler. The scheme was registered
  // as privileged at module top so the renderer treats URLs as standard
  // hierarchical (scheme://host/path); the actual byte-streaming happens
  // here. We map `ghost-asset:///<absPath>` → file at <absPath>.
  //
  // Path resolution is intentionally strict: only absolute paths, no
  // traversal, and we do NOT confine to a project directory. Reason:
  // users routinely save .gha files into project folders that reference
  // media scattered across `C:\Users\*\Videos`, network drives, external
  // SSDs, etc. Confining would block the very use case AssetRef is for.
  // The URL is constructed by our own assetRegistry from getPathForFile
  // and never from untrusted page content, so traversal isn't a vector
  // unless an attacker can also forge a project file — at which point
  // they already control the disk.
  // Wrap a Response to add CORS headers. WebGL refuses to sample a video
  // texture loaded cross-origin unless the response advertises
  // Access-Control-Allow-Origin AND the <video crossOrigin="anonymous">
  // attribute was set before src. Without these headers Three.js throws
  // "SecurityError: Failed to execute 'texImage2D' ... contains
  // cross-origin data" on every frame.
  const addCorsHeaders = (resp) => {
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', '*');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    });
  };

  protocol.handle('ghost-asset', async (request) => {
    try {
      // CORS preflight — answer immediately, no file read needed.
      if (request.method === 'OPTIONS') {
        return addCorsHeaders(new Response(null, { status: 204 }));
      }
      const url = new URL(request.url);
      // For URL "ghost-asset:///C:/Users/x/v.mp4":
      //   url.pathname = "/C:/Users/x/v.mp4"
      // Strip the leading slash and decode percent-encoding back to a
      // raw filesystem path. On Windows we get back drive-letter form
      // (`C:/Users/x/v.mp4`); on POSIX we get an absolute path.
      let p = decodeURIComponent(url.pathname);
      if (p.startsWith('/') && /^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1); // strip leading slash on Windows drive paths
      }
      const normalized = path.normalize(p);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return addCorsHeaders(new Response('Bad path', { status: 400 }));
      }
      if (!fs.existsSync(normalized)) {
        return addCorsHeaders(new Response('Not found', { status: 404 }));
      }
      // Re-emit as file:// for net.fetch — it handles range requests +
      // streaming for us, which <video> needs to seek without buffering
      // the whole file. We can't expose file:// to the renderer directly
      // (that's the bug we're fixing), but main-process net.fetch can.
      // Forward the Range header so <video> seek + decoder buffering work
      // correctly — without it net.fetch returns the whole file for every
      // request and the browser can't issue partial reads.
      const fileUrl = 'file:///' + normalized.replace(/\\/g, '/').replace(/^\//, '');
      const fetchHeaders = new Headers();
      const range = request.headers.get('range');
      if (range) fetchHeaders.set('range', range);
      const resp = await electronNet.fetch(fileUrl, {
        method: request.method,
        headers: fetchHeaders,
        bypassCustomProtocolHandlers: true,
      });
      return addCorsHeaders(resp);
    } catch (err) {
      console.error('[ghost-asset] handler error:', err?.message || err);
      return addCorsHeaders(new Response('Internal error', { status: 500 }));
    }
  });

  // Eagerly load Spout addon so we see errors immediately
  const addon = loadSpoutAddon();
  if (addon) {
    const senders = addon.listSenders();
    console.log('[Main] Spout addon loaded. Current senders:', JSON.stringify(senders));
  } else {
    console.error('[Main] Spout addon failed to load!');
  }

  await startNodeServer();

  // Create window after server is ready
  createMainWindow();

  // Display hotplug. On stage the performer can pull an HDMI cable at any
  // moment. Previously: if the output window was on the removed display, the
  // window either stayed at coords that are now off-screen (user can't find
  // it) or snapped somewhere unpredictable. Now: snap the output window
  // onto a still-present display so the performer can at least see it to
  // reposition.
  screen.on('display-removed', (_ev, removedDisplay) => {
    try {
      if (!outputWindow || outputWindow.isDestroyed()) return;
      const bounds = outputWindow.getBounds();
      // If the output window's top-left is inside any remaining display,
      // leave it alone — moving it could be more disruptive than helpful.
      const remaining = screen.getAllDisplays();
      const onSomewhere = remaining.some(d => {
        const b = d.bounds;
        return bounds.x >= b.x && bounds.x < b.x + b.width
            && bounds.y >= b.y && bounds.y < b.y + b.height;
      });
      if (onSomewhere) return;
      // Move to the primary display's top-left.
      const primary = screen.getPrimaryDisplay();
      console.warn(`[Main] Display removed (id=${removedDisplay?.id}); snapping output window to primary display.`);
      outputWindow.setBounds({
        x: primary.bounds.x + 40,
        y: primary.bounds.y + 40,
        width: Math.min(1280, primary.bounds.width - 80),
        height: Math.min(720, primary.bounds.height - 80),
      });
      outputWindow.setFullScreen(false);
    } catch (err) {
      console.error('[Main] display-removed handler failed:', err?.message || err);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanupAndQuit();
});

app.on('before-quit', (event) => {
  // Cleanup already handled by window-all-closed → cleanupAndQuit()
});

let isQuitting = false;
function cleanupAndQuit() {
  if (isQuitting) return;
  isQuitting = true;
  console.log('[Main] Cleaning up before quit...');

  // Synchronous cleanup — fast, non-blocking
  try { stopSpoutSender(); } catch (e) { console.error('[Cleanup] stopSpoutSender:', e.message); }
  try { stopSpoutReceiver(); } catch (e) { console.error('[Cleanup] stopSpoutReceiver:', e.message); }
  try { stopServer(); } catch (e) { console.error('[Cleanup] stopServer:', e.message); }
  // Destroy any live NDI senders so the network names go offline on exit.
  if (ndiAddon && ndiSenders.size > 0) {
    for (const name of ndiSenders) {
      try { ndiAddon.destroySender({ name }); } catch (e) { /* best-effort */ }
    }
    ndiSenders.clear();
  }
  if (ndiAddon && ndiReceivers.size > 0) {
    for (const sourceName of ndiReceivers) {
      try { ndiAddon.destroyReceiver({ sourceName }); } catch (e) { /* best-effort */ }
    }
    ndiReceivers.clear();
  }
  try { stopOSC(); } catch (e) { console.error('[Cleanup] stopOSC:', e.message); }

  // Kill any plugin child processes immediately
  for (const [name, plugin] of Object.entries(plugins)) {
    if (plugin.process) {
      console.log(`[Cleanup] Killing plugin: ${name}`);
      try { plugin.process.kill(); } catch {}
      plugin.process = null;
    }
  }

  // Hard quit — don't let anything block exit
  // Give 500ms for cleanup IO to flush, then force quit
  setTimeout(() => {
    console.log('[Main] Force quitting');
    app.exit(0);
  }, 500);

  // Also try normal quit immediately
  app.quit();
}
