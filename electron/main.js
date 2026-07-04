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

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, net as electronNet, protocol, screen, session, shell, utilityProcess } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, fork, execSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import dgram from 'dgram';
import { createNativeRendererBroker, nativeRendererCommandNames } from './native-renderer-broker.js';
// License system removed in OSS build — see src/lib/stores/license.ts.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const { parseOSCPacket } = require('./osc-parser.cjs');
const nativeRendererBroker = createNativeRendererBroker({
  appRoot: path.join(__dirname, '..'),
  resourcesPath: process.resourcesPath,
  isPackaged: app.isPackaged,
  platform: process.platform,
  env: process.env,
  textureShareStatusProvider: () => {
    loadSpoutAddon();
    return {
      ...getTextureShareLoadStatus(),
      senderMode: getTextureShareSenderMode(),
      osrActive,
      osrFailureReason,
    };
  },
});

// Force Chromium to use the discrete GPU (NVIDIA/AMD) on Optimus laptops.
// Must be set before app.whenReady() — affects the GPU process.
// GPU / DPI / autoplay tuning. Projection-safe mode avoids forcing Chromium
// presentation paths that can flicker or band on some Windows projector stacks.
const PROJECTION_SAFE_MODE = process.argv.includes('--projection-safe-mode') || process.env.GA_PROJECTION_SAFE_MODE === '1';
const EXPERIMENTAL_GPU_PRESENT = process.argv.includes('--experimental-gpu-present') || process.env.GA_EXPERIMENTAL_GPU_PRESENT === '1';
const ALLOW_CPU_TEXTURE_SHARE_FALLBACK =
  process.argv.includes('--allow-cpu-texture-share') ||
  process.env.GA_ALLOW_CPU_TEXTURE_SHARE_FALLBACK === '1';
const OSR_PAINT_FPS = Math.max(1, Math.min(240, Number(process.env.GA_OSR_PAINT_FPS || 60) || 60));
app.commandLine.appendSwitch('force_high_performance_gpu');
// Keep rendering when a window is fully covered by another window.
// Chromium's native-occlusion tracker pauses BeginFrames for occluded
// windows EVEN WITH backgroundThrottling:false — which froze rAF in the
// Stage 3D window whenever the editor covered it (killing live LED
// previews and hanging the Demo Reel offline render mid-sequence). VJs
// stack windows constantly; never let occlusion stop a render loop.
// NOTE: appendSwitch('disable-features') REPLACES on repeat calls — the
// safe-mode branch below must merge its flag into one list.
if (PROJECTION_SAFE_MODE) {
  app.commandLine.appendSwitch('disable-zero-copy');
  app.commandLine.appendSwitch('disable-features', 'HardwareOverlays,CalculateNativeWinOcclusion');
} else {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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
// Buffered async log writes. The old appendFileSync-per-line blocked the
// main thread 1-5ms per console call — IPC handling, window management,
// and native sends all jank when logging gets busy mid-show. Lines queue
// in memory and flush every 250ms (or at 200 queued lines) via a single
// async append; flushed synchronously on exit so crashes still leave a
// complete log.
let _logBuffer = [];
let _logFlushTimer = null;
let _logFlushInFlight = false;
function _flushLogBuffer(sync = false) {
  if (_logBuffer.length === 0) return;
  const chunk = _logBuffer.join('');
  _logBuffer = [];
  if (sync) {
    try { fs.appendFileSync(_logFile, chunk); } catch {}
    return;
  }
  if (_logFlushInFlight) {
    // A flush is mid-write; re-queue and let the next timer pick it up.
    _logBuffer.unshift(chunk);
    return;
  }
  _logFlushInFlight = true;
  fs.appendFile(_logFile, chunk, () => { _logFlushInFlight = false; });
}
function _queueLogLine(line) {
  _logBuffer.push(line);
  if (_logBuffer.length >= 200) {
    _flushLogBuffer();
    return;
  }
  if (!_logFlushTimer) {
    _logFlushTimer = setTimeout(() => {
      _logFlushTimer = null;
      _flushLogBuffer();
    }, 250);
    // Don't let a pending log flush keep the process alive on quit.
    _logFlushTimer.unref?.();
  }
}
process.on('exit', () => _flushLogBuffer(true));
const _origLog = console.log.bind(console);
console.log = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _queueLogLine(`${msg}\n`);
  try { _origLog(...args); } catch {}
};
const _origErr = console.error.bind(console);
console.error = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _queueLogLine(`[ERR] ${msg}\n`);
  try { _origErr(...args); } catch {}
};
const _origWarn = console.warn.bind(console);
console.warn = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  _queueLogLine(`[WARN] ${msg}\n`);
  try { _origWarn(...args); } catch {}
};
console.log(`[Main] Projection safe mode=${PROJECTION_SAFE_MODE} experimentalGpuPresent=${EXPERIMENTAL_GPU_PRESENT} cpuTextureShareFallback=${ALLOW_CPU_TEXTURE_SHARE_FALLBACK} osrPaintFps=${OSR_PAINT_FPS}`);

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
let stage3dWindow = null;   // 3D Stage Designer pop-out (?mode=stage-3d)
let projectionSimWindow = null; // Projection Simulator pop-out (?mode=projection-sim)
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
let embeddedServerModule = null;
const wledSockets = new Map();  // controllerId -> dgram.Socket
let activeVideoConverterJob = null;
const activeJpegSequenceJobs = new Map();
const activeVideoLoopJobs = new Map();

// Platform flags (used elsewhere in this file)
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeOutputBase(name, fallback = 'converted-video') {
  const base = String(name || fallback)
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w .-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return base || fallback;
}

function resolveFfmpegPath() {
  const envPath = process.env.GA_FFMPEG_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  try {
    const staticPath = require('ffmpeg-static');
    if (typeof staticPath === 'string' && staticPath) {
      const unpackedPath = staticPath.replace('app.asar', 'app.asar.unpacked');
      const candidate = fs.existsSync(unpackedPath) ? unpackedPath : staticPath;
      if (fs.existsSync(candidate)) {
        if (process.platform !== 'win32') {
          try { fs.chmodSync(candidate, 0o755); } catch { /* signed app resources may be read-only */ }
        }
        return candidate;
      }
    }
  } catch (err) {
    console.warn('[VideoConverter] ffmpeg-static unavailable, falling back to PATH:', err?.message || err);
  }

  return isWin ? 'ffmpeg.exe' : 'ffmpeg';
}

function assertAbsolutePath(filePath, label = 'file path') {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(`Invalid ${label}.`);
  }
  const normalized = path.normalize(filePath);
  if (!path.isAbsolute(normalized)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return normalized;
}

function parseFfmpegClock(value) {
  const match = String(value || '').match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const total = h * 3600 + m * 60 + s;
  return Number.isFinite(total) ? total : null;
}

function parseDurationLine(line) {
  const match = String(line || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const total = h * 3600 + m * 60 + s;
  return Number.isFinite(total) ? total : null;
}

function naturalCompare(a, b) {
  const ax = String(a).match(/\d+|\D+/g) || [];
  const bx = String(b).match(/\d+|\D+/g) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ap = ax[i] ?? '';
    const bp = bx[i] ?? '';
    const an = /^\d+$/.test(ap) ? Number(ap) : NaN;
    const bn = /^\d+$/.test(bp) ? Number(bp) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    const cmp = ap.localeCompare(bp, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function listImageSequenceFrames(folderPath) {
  const folder = assertAbsolutePath(folderPath, 'sequence folder');
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error('Choose a folder that contains JPG frames.');
  }

  const exts = new Set(['.jpg', '.jpeg', '.png']);
  const frames = fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && exts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      path: path.join(folder, entry.name),
      ext: path.extname(entry.name).toLowerCase(),
    }))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (!frames.length) {
    throw new Error('No .jpg, .jpeg, or .png frames were found in that folder.');
  }

  return {
    folder,
    frames,
    frameCount: frames.length,
    firstFrame: frames[0].name,
    lastFrame: frames[frames.length - 1].name,
  };
}

function bytesToBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Buffer.from(bytes);
  throw new Error('Invalid bytes payload');
}

function safeJpegSequenceBaseName(name) {
  return String(name || 'render')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'render';
}

function startJpegSequenceJob(args = {}) {
  const jobId = String(args.jobId || '').trim();
  if (!jobId) throw new Error('Missing JPEG sequence job id.');
  if (activeJpegSequenceJobs.has(jobId)) throw new Error('JPEG sequence job already exists.');

  const folderPath = assertAbsolutePath(args.folderPath, 'JPEG sequence folder');
  fs.mkdirSync(folderPath, { recursive: true });
  if (!fs.statSync(folderPath).isDirectory()) throw new Error('JPEG sequence target is not a folder.');

  const width = Math.round(clampNumber(args.width, 1, 16384, 0));
  const height = Math.round(clampNumber(args.height, 1, 16384, 0));
  const fps = clampNumber(args.fps, 1, 240, 30);
  const totalFrames = Math.round(clampNumber(args.totalFrames, 1, 10_000_000, 1));
  if (!width || !height) throw new Error('Invalid JPEG sequence dimensions.');

  const baseName = safeJpegSequenceBaseName(args.baseName);
  const outputPattern = path.join(folderPath, `${baseName}_%06d.jpg`);
  const ffmpegPath = resolveFfmpegPath();
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s:v', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-frames:v', String(totalFrames),
    '-c:v', 'mjpeg',
    '-q:v', '2',
    '-pix_fmt', 'yuvj444p',
    '-f', 'image2',
    '-start_number', '0',
    outputPattern,
  ];

  const child = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const job = {
    id: jobId,
    process: child,
    folderPath,
    baseName,
    width,
    height,
    totalFrames,
    frameBytes: width * height * 4,
    writtenFrames: 0,
    stderr: '',
    settled: false,
    cancelled: false,
    exitCode: null,
    exitSignal: null,
    exitPromise: null,
  };

  job.exitPromise = new Promise((resolve) => {
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      job.stderr += String(chunk);
      if (job.stderr.length > 12_000) job.stderr = job.stderr.slice(-12_000);
    });
    child.on('error', (err) => {
      job.stderr += `\n${err?.message || err}`;
    });
    child.on('close', (code, signal) => {
      job.settled = true;
      job.exitCode = code;
      job.exitSignal = signal;
      resolve({ code, signal });
    });
  });

  activeJpegSequenceJobs.set(jobId, job);
  return {
    jobId,
    outputPattern,
    ffmpegPath,
  };
}

async function writeJpegSequenceFrame(args = {}) {
  const jobId = String(args.jobId || '').trim();
  const job = activeJpegSequenceJobs.get(jobId);
  if (!job) throw new Error('JPEG sequence job is not active.');
  if (job.settled) {
    throw new Error(`JPEG sequence encoder exited early.${job.stderr ? ` ${job.stderr.trim()}` : ''}`);
  }
  const buffer = bytesToBuffer(args.bytes);
  if (buffer.byteLength !== job.frameBytes) {
    throw new Error(`JPEG sequence frame has ${buffer.byteLength} bytes; expected ${job.frameBytes}.`);
  }

  const frameIndex = Math.round(clampNumber(args.frameIndex, 0, Number.MAX_SAFE_INTEGER, job.writtenFrames));
  if (frameIndex !== job.writtenFrames) {
    throw new Error(`JPEG sequence frame order mismatch: got ${frameIndex}, expected ${job.writtenFrames}.`);
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      job.process.stdin?.off?.('error', onError);
      job.process.off?.('close', onClose);
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const onError = (err) => finish(err);
    const onClose = () => finish(new Error(`JPEG sequence encoder closed while writing frame ${frameIndex}.`));
    job.process.stdin?.once?.('error', onError);
    job.process.once?.('close', onClose);
    job.process.stdin.write(buffer, (err) => finish(err));
  });

  job.writtenFrames++;
  return { success: true, writtenFrames: job.writtenFrames };
}

async function finishJpegSequenceJob(jobIdInput) {
  const jobId = String(jobIdInput || '').trim();
  const job = activeJpegSequenceJobs.get(jobId);
  if (!job) return { success: true, alreadyFinished: true };

  try {
    if (!job.process.stdin.destroyed && !job.process.stdin.writableEnded) {
      job.process.stdin.end();
    }
  } catch { /* ignore */ }

  const { code, signal } = await job.exitPromise;
  activeJpegSequenceJobs.delete(jobId);

  if (job.cancelled) return { success: false, cancelled: true };
  if (code !== 0) {
    const detail = job.stderr.trim() || `exit code ${code}${signal ? ` (${signal})` : ''}`;
    throw new Error(`JPEG sequence encoder failed: ${detail}`);
  }
  if (job.writtenFrames !== job.totalFrames) {
    throw new Error(`JPEG sequence ended after ${job.writtenFrames} frames; expected ${job.totalFrames}.`);
  }
  return {
    success: true,
    path: job.folderPath,
    baseName: job.baseName,
    frames: job.writtenFrames,
  };
}

async function cancelJpegSequenceJob(jobIdInput) {
  const jobId = String(jobIdInput || '').trim();
  const job = activeJpegSequenceJobs.get(jobId);
  if (!job) return { success: true };
  job.cancelled = true;
  try {
    job.process.stdin?.destroy?.();
  } catch { /* ignore */ }
  try {
    job.process.kill('SIGTERM');
  } catch { /* ignore */ }
  setTimeout(() => {
    if (activeJpegSequenceJobs.get(jobId) === job) {
      try { job.process.kill('SIGKILL'); } catch { /* ignore */ }
      activeJpegSequenceJobs.delete(jobId);
    }
  }, 1500).unref?.();
  return { success: true };
}

function quoteFfconcatPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `'${normalized.replace(/'/g, "'\\''")}'`;
}

function makeConcatList(frames, fps) {
  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'ghost-arcade-seq-'));
  const listPath = path.join(tmpDir, 'frames.ffconcat');
  const duration = (1 / Math.max(1, fps)).toFixed(8);
  const lines = ['ffconcat version 1.0'];
  for (const frame of frames) {
    lines.push(`file ${quoteFfconcatPath(frame.path)}`);
    lines.push(`duration ${duration}`);
  }
  // ffconcat uses the last file's duration only when the file appears twice.
  lines.push(`file ${quoteFfconcatPath(frames[frames.length - 1].path)}`);
  fs.writeFileSync(listPath, `${lines.join('\n')}\n`, 'utf8');
  return { tmpDir, listPath };
}

const LOOP_TRANSITIONS = new Set([
  'fade', 'dissolve', 'pixelize',
  'rectcrop', 'distance',
  'fadeblack', 'fadewhite', 'fadegrays', 'fadefast', 'fadeslow',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'wipetl', 'wipetr', 'wipebl', 'wipebr',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circlecrop', 'circleclose', 'circleopen',
  'radial', 'horzclose', 'horzopen', 'vertclose', 'vertopen',
  'diagtl', 'diagtr', 'diagbl', 'diagbr',
  'hlslice', 'hrslice', 'vuslice', 'vdslice',
  'hblur', 'squeezeh', 'squeezev', 'zoomin',
  'hlwind', 'hrwind', 'vuwind', 'vdwind',
  'coverleft', 'coverright', 'coverup', 'coverdown',
  'revealleft', 'revealright', 'revealup', 'revealdown',
  'ghost-scanline-glitch',
  'ghost-block-glitch',
  'ghost-chroma-stagger',
  'ghost-tape-tear',
  'ghost-signal-pulse',
]);

const LOOP_CUSTOM_TRANSITION_EXPRESSIONS = new Map([
  ['ghost-scanline-glitch', 'if(gt(P+0.08*PLANE,0.18+0.64*mod(floor(Y/6),7)/6),B,A)'],
  ['ghost-block-glitch', 'if(gt(P,0.12+0.76*mod(floor(X/64)*13+floor(Y/48)*7,19)/18),B,A)'],
  ['ghost-chroma-stagger', 'if(gt(P+0.13*(PLANE-1),0.15+0.7*mod(floor(Y/20)+floor(X/80),5)/4),B,A)'],
  ['ghost-tape-tear', 'if(gt(P+0.25*sin(Y*0.12+P*12),0.48),B,A)'],
  ['ghost-signal-pulse', 'if(gt(P+0.18*sin((floor(Y/18)+floor(X/90))*2+P*18),0.58),B,A)'],
]);

function safeLoopTransition(value) {
  const name = String(value || 'fade').trim();
  return LOOP_TRANSITIONS.has(name) ? name : 'fade';
}

function loopXfadeOptions(value, fadeDuration, xfadeOffset) {
  const transition = safeLoopTransition(value);
  const expr = LOOP_CUSTOM_TRANSITION_EXPRESSIONS.get(transition);
  if (expr) {
    return `transition=custom:duration=${fadeDuration.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}:expr='${expr}'`;
  }
  return `transition=${transition}:duration=${fadeDuration.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}`;
}

function evenDimension(value, fallback) {
  const n = Math.round(clampNumber(value, 2, 8192, fallback));
  return Math.max(2, n % 2 === 0 ? n : n - 1);
}

function extensionFromVideoMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webm')) return '.webm';
  if (m.includes('quicktime')) return '.mov';
  return '.mp4';
}

function safeGeneratedVideoFilename(filename, mime = 'video/mp4') {
  const parsed = path.parse(String(filename || 'asset'));
  const base = (parsed.name || 'asset')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'asset';
  const ext = (parsed.ext && parsed.ext.length <= 12)
    ? parsed.ext.replace(/[^a-zA-Z0-9.]/g, '')
    : extensionFromVideoMime(mime);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}_${stamp}_${rand}${ext || extensionFromVideoMime(mime)}`;
}

function safeGeneratedVideoPath(filename) {
  const dir = path.join(app.getPath('userData'), 'project-assets');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, safeGeneratedVideoFilename(filename || 'Loop.mp4', 'video/mp4'));
}

function videoBitrateForSize(width, height) {
  const pixels = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
  if (pixels >= 7_000_000) return '65000k'; // 4K-ish
  if (pixels >= 3_000_000) return '42000k';
  if (pixels >= 1_800_000) return '26000k'; // 1080p-ish
  if (pixels >= 900_000) return '16000k';
  return '10000k';
}

function videoLoopEncoderArgs(outputPath, meta = {}, preferHardware = true) {
  const common = [
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '1024',
    '-an',
    outputPath,
  ];

  if (preferHardware && process.platform === 'darwin') {
    return [
      '-map', '[outv]',
      '-c:v', 'h264_videotoolbox',
      '-b:v', videoBitrateForSize(meta.width, meta.height),
      '-profile:v', 'high',
      '-allow_sw', '1',
      ...common,
    ];
  }

  return [
    '-map', '[outv]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    ...common,
  ];
}

function writeTempVideoFile(prefix, filename, bytes) {
  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), prefix));
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, bytesToBuffer(bytes));
  return { tmpDir, filePath };
}

function resolveLoopInput(args = {}, fieldPrefix = 'input') {
  const pathKey = `${fieldPrefix}Path`;
  const bytesKey = `${fieldPrefix}Bytes`;
  if (typeof args[pathKey] === 'string' && args[pathKey]) {
    const filePath = assertAbsolutePath(args[pathKey], `${fieldPrefix} path`);
    if (!fs.existsSync(filePath)) throw new Error(`${fieldPrefix} video not found.`);
    return { filePath, cleanup: () => {} };
  }

  if (args[bytesKey]) {
    const staged = writeTempVideoFile(`ghost-arcade-${fieldPrefix}-`, `${fieldPrefix}.mp4`, args[bytesKey]);
    return {
      filePath: staged.filePath,
      cleanup: () => {
        try { fs.rmSync(staged.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      },
    };
  }

  throw new Error(`Missing ${fieldPrefix} video.`);
}

function probeVideoMetadata(inputPath) {
  return new Promise((resolve) => {
    const ffmpegPath = resolveFfmpegPath();
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], { windowsHide: true });
    const meta = { duration: 0, width: 0, height: 0 };
    let settled = false;
    let timeout = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try { child.kill('SIGKILL'); } catch { /* ffmpeg usually exits by itself */ }
      resolve(meta);
    };

    timeout = setTimeout(settle, 15000);
    timeout.unref?.();

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        const line = rawLine.trim();
        const duration = parseDurationLine(line);
        if (duration && duration > 0) meta.duration = duration;

        if (line.includes('Video:')) {
          const dim = line.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
          if (dim) {
            const w = Number(dim[1]);
            const h = Number(dim[2]);
            if (Number.isFinite(w) && Number.isFinite(h)) {
              meta.width = w;
              meta.height = h;
            }
          }
        }

        if (meta.duration > 0 && meta.width > 0 && meta.height > 0) {
          settle();
        }
      }
    });
    child.on('error', settle);
    child.on('close', () => {
      settle();
    });
  });
}

function probeVideoDurationByDecode(inputPath) {
  return new Promise((resolve) => {
    const ffmpegPath = resolveFfmpegPath();
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-nostdin',
      '-i', inputPath,
      '-map', '0:v:0',
      '-f', 'null',
      '-',
    ], { windowsHide: true });

    let bestDuration = 0;
    let settled = false;
    let timeout = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try { child.kill('SIGKILL'); } catch { /* ffmpeg usually exits by itself */ }
      resolve(bestDuration);
    };

    timeout = setTimeout(settle, 5 * 60 * 1000);
    timeout.unref?.();

    const ingestLine = (line) => {
      const duration = parseDurationLine(line);
      if (duration && duration > 0) bestDuration = Math.max(bestDuration, duration);

      const timeMatch = String(line || '').match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/);
      if (timeMatch) {
        const seconds = parseFfmpegClock(timeMatch[1]);
        if (seconds !== null && seconds > 0) bestDuration = Math.max(bestDuration, seconds);
      }
    };

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        ingestLine(rawLine.trim());
      }
    });
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      for (const rawLine of String(chunk).split(/\r?\n/)) {
        ingestLine(rawLine.trim());
      }
    });
    child.on('error', settle);
    child.on('close', settle);
  });
}

function publishVideoLoopProgress(sender, payload) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send('video-loop-progress', {
    ...payload,
    progress: clampNumber(payload.progress ?? 0, 0, 1, 0),
  });
}

function spawnFfmpegVideoLoop({
  sender,
  jobId,
  args,
  durationSec,
  outputPath,
  startMessage,
  completeMessage,
}) {
  if (!jobId) throw new Error('Missing video loop job id.');
  if (activeVideoLoopJobs.has(jobId)) throw new Error('A video loop job with this id is already running.');

  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const job = { id: jobId, process: child, cancelled: false };
    activeVideoLoopJobs.set(jobId, job);

    let stderr = '';
    let settled = false;
    let bestProgress = 0;
    let detectedDuration = durationSec > 0 ? durationSec : 0;
    const startedAt = Date.now();

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      activeVideoLoopJobs.delete(jobId);
      fn(value);
    };

    const send = (progress, message, stage = 'rendering') => {
      const bounded = stage === 'rendering'
        ? clampNumber(progress, 0, 0.99, 0)
        : clampNumber(progress, 0, 1, 0);
      if (bounded >= bestProgress || stage !== 'rendering') {
        bestProgress = stage === 'rendering'
          ? Math.max(bestProgress, bounded)
          : bounded;
        publishVideoLoopProgress(sender, { jobId, stage, progress: bestProgress, message, outputPath });
      }
    };

    const sendPercent = (rawProgress) => {
      const bounded = clampNumber(rawProgress, 0, 0.99, 0);
      const pct = Math.max(1, Math.min(99, Math.floor(bounded * 100)));
      send(bounded, `Encoding loop (${pct}%)...`);
    };

    publishVideoLoopProgress(sender, {
      jobId,
      stage: 'rendering',
      progress: 0.01,
      message: startMessage,
      outputPath,
    });

    const heartbeat = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const drift = detectedDuration > 0
        ? Math.min(0.96, elapsed / Math.max(1, detectedDuration))
        : Math.min(0.88, 0.04 + (1 - Math.exp(-elapsed / 90)) * 0.84);
      send(drift, `Encoding loop (${Math.floor(elapsed)}s elapsed)...`);
    }, 1000);
    heartbeat.unref?.();

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const duration = parseDurationLine(line);
        if (duration && duration > 0) detectedDuration = duration;

        const kv = line.match(/^([A-Za-z_]+)=(.*)$/);
        if (kv) {
          const key = kv[1];
          const value = kv[2];
          if (key === 'progress' && value === 'end') {
            send(0.99, 'Finalizing loop...');
          } else if (key === 'out_time_ms' || key === 'out_time_us') {
            const raw = Number(value);
            if (Number.isFinite(raw) && detectedDuration > 0) {
              const seconds = raw > 10_000 ? raw / 1_000_000 : raw / 1000;
              sendPercent(seconds / detectedDuration);
            }
          } else if (key === 'out_time') {
            const seconds = parseFfmpegClock(value);
            if (seconds !== null && detectedDuration > 0) sendPercent(seconds / detectedDuration);
          }
          continue;
        }

        const timeMatch = line.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/);
        if (timeMatch && detectedDuration > 0) {
          const seconds = parseFfmpegClock(timeMatch[1]);
          if (seconds !== null) sendPercent(seconds / detectedDuration);
        }
      }
    });

    child.on('error', (err) => {
      clearInterval(heartbeat);
      settle(reject, new Error(`FFmpeg failed to start. ${err?.message || err}`));
    });

    child.on('close', (code, signal) => {
      clearInterval(heartbeat);
      if (job.cancelled) {
        publishVideoLoopProgress(sender, {
          jobId,
          stage: 'error',
          progress: bestProgress,
          message: 'Loop creation cancelled.',
          outputPath,
        });
        settle(reject, new Error('Loop creation cancelled.'));
        return;
      }
      if (code !== 0) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
        settle(reject, new Error(`FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}.${tail ? `\n${tail}` : ''}`));
        return;
      }
      publishVideoLoopProgress(sender, {
        jobId,
        stage: 'complete',
        progress: 1,
        message: completeMessage,
        outputPath,
      });
      settle(resolve, { success: true, outputPath, ffmpegPath });
    });
  });
}

function publishVideoConverterProgress(sender, payload) {
  if (!sender || sender.isDestroyed?.()) return;
  const progress = clampNumber(payload.progress ?? 0, 0, 1, 0);
  sender.send('video-converter-progress', {
    ...payload,
    progress,
  });
}

function spawnFfmpegConversion({
  sender,
  jobId,
  args,
  durationSec,
  outputPath,
  startMessage,
  completeMessage,
  cleanup,
  progressMode = 'time',
  totalFrames = 0,
}) {
  if (activeVideoConverterJob) {
    throw new Error('A video conversion is already running.');
  }

  return new Promise((resolve, reject) => {
    const ffmpegPath = resolveFfmpegPath();
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const job = { id: jobId, process: child, cancelled: false, cleanup };
    activeVideoConverterJob = job;

    let stderr = '';
    let settled = false;
    let bestProgress = 0;
    let detectedDuration = durationSec > 0 ? durationSec : 0;
    const startedAt = Date.now();

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (activeVideoConverterJob === job) activeVideoConverterJob = null;
      try { cleanup?.(); } catch (err) { console.warn('[VideoConverter] cleanup failed:', err?.message || err); }
      fn(value);
    };

    const send = (progress, message, stage = 'converting') => {
      const bounded = stage === 'converting'
        ? clampNumber(progress, 0, 0.99, 0)
        : clampNumber(progress, 0, 1, 0);
      if (bounded >= bestProgress || stage !== 'converting') {
        bestProgress = stage === 'converting'
          ? Math.max(bestProgress, bounded)
          : bounded;
        publishVideoConverterProgress(sender, { jobId, stage, progress: bestProgress, message, outputPath });
      }
    };

    const sendPercent = (rawProgress) => {
      const bounded = clampNumber(rawProgress, 0, 0.99, 0);
      const pct = Math.max(1, Math.min(99, Math.floor(bounded * 100)));
      send(bounded, `Encoding MP4 (${pct}%)...`);
    };

    publishVideoConverterProgress(sender, { jobId, stage: 'converting', progress: 0.01, message: startMessage, outputPath });

    const heartbeat = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const drift = detectedDuration > 0
        ? Math.min(0.96, elapsed / Math.max(1, detectedDuration))
        : Math.min(0.88, 0.04 + (1 - Math.exp(-elapsed / 90)) * 0.84);
      send(drift, `Encoding MP4 (${Math.floor(elapsed)}s elapsed)...`);
    }, 1000);
    heartbeat.unref?.();

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (stderr.length > 12_000) stderr = stderr.slice(-12_000);

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const duration = parseDurationLine(line);
        if (duration && duration > 0) detectedDuration = duration;

        const kv = line.match(/^([A-Za-z_]+)=(.*)$/);
        if (kv) {
          const key = kv[1];
          const value = kv[2];
          if (progressMode === 'frames' && key === 'frame') {
            const frame = Number(value);
            if (Number.isFinite(frame) && totalFrames > 0) {
              sendPercent(frame / totalFrames);
            }
          } else if (key === 'progress' && value === 'end') {
            send(0.99, 'Finalizing MP4...');
          } else if (progressMode !== 'frames' && (key === 'out_time_ms' || key === 'out_time_us')) {
            const raw = Number(value);
            if (Number.isFinite(raw) && detectedDuration > 0) {
              const seconds = raw > 10_000 ? raw / 1_000_000 : raw / 1000;
              sendPercent(seconds / detectedDuration);
            }
          } else if (progressMode !== 'frames' && key === 'out_time') {
            const seconds = parseFfmpegClock(value);
            if (seconds !== null && detectedDuration > 0) {
              sendPercent(seconds / detectedDuration);
            }
          }
          continue;
        }

        const frameMatch = progressMode === 'frames' ? line.match(/frame=\s*(\d+)/) : null;
        if (frameMatch && totalFrames > 0) {
          sendPercent(Number(frameMatch[1]) / totalFrames);
          continue;
        }

        const timeMatch = progressMode !== 'frames' ? line.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/) : null;
        if (timeMatch && detectedDuration > 0) {
          const seconds = parseFfmpegClock(timeMatch[1]);
          if (seconds !== null) sendPercent(seconds / detectedDuration);
        }
      }
    });

    child.on('error', (err) => {
      clearInterval(heartbeat);
      settle(reject, new Error(`FFmpeg failed to start. ${err?.message || err}`));
    });

    child.on('close', (code, signal) => {
      clearInterval(heartbeat);
      if (job.cancelled) {
        publishVideoConverterProgress(sender, { jobId, stage: 'cancelled', progress: bestProgress, message: 'Conversion cancelled.', outputPath });
        settle(reject, new Error('Conversion cancelled.'));
        return;
      }
      if (code !== 0) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
        settle(reject, new Error(`FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}.${tail ? `\n${tail}` : ''}`));
        return;
      }
      publishVideoConverterProgress(sender, { jobId, stage: 'complete', progress: 1, message: completeMessage, outputPath });
      settle(resolve, { success: true, outputPath, ffmpegPath });
    });
  });
}

function closeAuxiliaryWindows() {
  if (stage3dWindow && !stage3dWindow.isDestroyed()) {
    const win = stage3dWindow;
    stage3dWindow = null;
    try { win.close(); } catch {}
  } else {
    stage3dWindow = null;
  }

  if (projectionSimWindow && !projectionSimWindow.isDestroyed()) {
    const win = projectionSimWindow;
    projectionSimWindow = null;
    try { win.close(); } catch {}
  } else {
    projectionSimWindow = null;
  }

  if (outputWindow && !outputWindow.isDestroyed()) {
    const win = outputWindow;
    outputWindow = null;
    try { win.close(); } catch {}
  } else {
    outputWindow = null;
  }

  for (const [sliceId, win] of sliceWindows.entries()) {
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch {}
    }
    sliceWindows.delete(sliceId);
  }

  if (spoutOsrWindow && !spoutOsrWindow.isDestroyed()) {
    try { destroySpoutOsrWindow(); } catch {}
  } else {
    spoutOsrWindow = null;
  }

  try { stopAtlasOutput('shutdown'); } catch {}
}

function closeAllWledSockets() {
  for (const [controllerId, sock] of wledSockets.entries()) {
    try { sock.close(); } catch {}
    wledSockets.delete(controllerId);
  }
}

function publishStage3DFullscreenState(fullScreen) {
  if (!stage3dWindow || stage3dWindow.isDestroyed()) return;
  try {
    stage3dWindow.webContents.send('stage3d-fullscreen-changed', { fullScreen: !!fullScreen });
  } catch {}
}

function publishProjectionSimFullscreenState(fullScreen) {
  if (!projectionSimWindow || projectionSimWindow.isDestroyed()) return;
  try {
    projectionSimWindow.webContents.send('projection-sim-fullscreen-changed', { fullScreen: !!fullScreen });
  } catch {}
}

// Spout native addon
let spoutAddon = null;
let spoutAddonLoadAttempted = false;
let spoutAddonLoadError = null;
let spoutAddonLoadPath = null;
let spoutAddonLoadCandidates = [];
let textureShareSenderListLogKey = null;
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
let osrPaintPump = null;
let osrFailureReason = null;
let osrPaintDiagCount = 0;
let osrSendTextureFailCount = 0;
let spoutSendW = 1920;      // Output resolution for OSR window
let spoutSendH = 1080;
let spoutCpuFallbackWarned = false;

// Multi-slice zero-copy atlas state. The slice-atlas OSR window renders
// every Spout/Syphon sender slice into one atlas texture and publishes
// its packed layout; SpoutAtlasOutput sub-copies each tile into a
// per-name native sender from the single captured atlas handle.
const atlasState = {
  active: false,            // true once the atlas OSR window is forwarding
  layout: null,             // last { atlasW, atlasH, tiles, overflow }
  lastLoggedCount: -1,
};
let atlasOutput = null;       // SpoutAtlasOutput (Windows) or SyphonAtlasOutput (macOS)
let atlasOsrWindow = null;    // hidden OSR window running ?mode=slice-atlas
let atlasOsrCreating = false;
let atlasPaintPump = null;
let atlasFrameCount = 0;
let atlasLastLogTime = 0;
let atlasPaintDiagCount = 0;
let atlasSendFailCount = 0;

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
    embeddedServerModule = await import(serverUrl);
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
  if (embeddedServerModule?.shutdownServer) {
    try {
      embeddedServerModule.shutdownServer({ force: true });
    } catch (err) {
      console.error('[Main] Embedded server shutdown failed:', err?.message || err);
    }
  }
  embeddedServerModule = null;

  if (sidecarProcess) {
    killChildProcess(sidecarProcess, 'server sidecar');
    sidecarProcess = null;
  }
}

function cleanupError(label, err) {
  console.error(`[Cleanup] ${label}:`, err?.message || err);
}

function runCleanupStep(label, fn) {
  try {
    fn();
  } catch (err) {
    cleanupError(label, err);
  }
}

function killChildProcess(child, label = 'child process') {
  if (!child) return;

  const pid = child.pid;
  try {
    if (!child.killed) child.kill('SIGKILL');
  } catch (err) {
    cleanupError(`${label} kill`, err);
  }

  // On Windows, killing the parent handle is not always enough when helpers
  // inherit file locks. taskkill /T /F clears the whole process tree.
  if (isWin && pid) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, {
        shell: 'cmd.exe',
        stdio: 'ignore',
        timeout: 3000,
      });
    } catch {}
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

function getTextureShareAddonCandidates(addonName) {
  const devPath = path.join(__dirname, 'native', 'build', 'Release', addonName);
  const candidates = [];

  // electron-builder unpacks native modules out of app.asar. Loading a .node
  // from inside the archive fails, so packaged builds must prefer the sibling
  // app.asar.unpacked path.
  if (__dirname.includes('app.asar')) {
    candidates.push(path.join(
      __dirname.replace('app.asar', 'app.asar.unpacked'),
      'native',
      'build',
      'Release',
      addonName
    ));
  }

  candidates.push(devPath);
  return [...new Set(candidates)];
}

function getTextureShareLoadStatus() {
  return {
    platform: textureSharePlatform,
    label: textureShareLabel,
    available: spoutAddon !== null,
    addonPath: spoutAddonLoadPath,
    candidates: spoutAddonLoadCandidates,
    error: spoutAddonLoadError,
    cpuFallbackAllowed: ALLOW_CPU_TEXTURE_SHARE_FALLBACK,
    receiverTextureInfoSupported: getReceiverTextureInfoSupport(spoutAddon),
  };
}

function getReceiverTextureInfoSupport(addon = spoutAddon) {
  if (!addon) return false;
  const ReceiverClass = getReceiverClass(addon);
  return !!(
    ReceiverClass &&
    ReceiverClass.prototype &&
    typeof ReceiverClass.prototype.receiveTextureInfo === 'function'
  );
}

function loadSpoutAddon() {
  if (spoutAddon) return spoutAddon;
  if (spoutAddonLoadAttempted) return null;
  spoutAddonLoadAttempted = true;
  spoutAddonLoadError = null;

  const addonName = isMac ? 'syphon_addon.node' : 'spout_addon.node';
  spoutAddonLoadCandidates = getTextureShareAddonCandidates(addonName);
  spoutAddonLoadPath = null;

  try {
    const addonPath = spoutAddonLoadCandidates.find(candidate => fs.existsSync(candidate));
    if (!addonPath) {
      spoutAddonLoadError = `native addon not found (${addonName})`;
      console.warn(`[${textureShareLabel}] ${spoutAddonLoadError}. Checked: ${spoutAddonLoadCandidates.join(', ')}`);
      return null;
    }
    spoutAddonLoadPath = addonPath;
    spoutAddon = require(addonPath);
    console.log(`[${textureShareLabel}] Native addon loaded successfully: ${addonPath}`);
    try {
      const gpuInfo = spoutAddon.getGpuInfo();
      console.log(`[${textureShareLabel}] GPU adapters:`, JSON.stringify(gpuInfo.adapters));
      console.log(`[${textureShareLabel}] Selected adapter index:`, gpuInfo.selectedAdapter);
    } catch (e) {
      console.log(`[${textureShareLabel}] Could not get GPU info:`, e.message);
    }
    return spoutAddon;
  } catch (err) {
    spoutAddonLoadError = err?.message || String(err);
    console.error(`[${textureShareLabel}] Failed to load native addon:`, spoutAddonLoadError);
    return null;
  }
}

// NDI native addon — cross-platform sender via NewTek's NDI SDK.
// Built by electron/native/CMakeLists.txt when the NDI SDK is detected
// at build time. Release installers do not bundle the SDK/runtime, so
// missing addon/runtime = graceful degradation. See docs/ndi-setup.md.
let ndiAddon = null;
let ndiAddonLoadAttempted = false;
let ndiAddonLoadPath = null;
let ndiAddonLoadError = null;
let ndiAddonLoadCandidates = [];

function getNdiAddonCandidates() {
  return getTextureShareAddonCandidates('ndi_addon.node');
}

function getNdiLoadStatus() {
  return {
    available: ndiAddon !== null,
    addonPath: ndiAddonLoadPath,
    candidates: ndiAddonLoadCandidates,
    error: ndiAddonLoadError,
  };
}

function loadNdiAddon() {
  if (ndiAddon) return ndiAddon;
  if (ndiAddonLoadAttempted) return null;
  ndiAddonLoadAttempted = true;
  ndiAddonLoadError = null;
  ndiAddonLoadCandidates = getNdiAddonCandidates();
  ndiAddonLoadPath = null;

  try {
    const addonPath = ndiAddonLoadCandidates.find(candidate => fs.existsSync(candidate));
    if (!addonPath) {
      ndiAddonLoadError = 'NDI native bridge is not bundled in this build';
      console.log(`[NDI] ${ndiAddonLoadError}. Checked: ${ndiAddonLoadCandidates.join(', ')}`);
      return null;
    }
    ndiAddonLoadPath = addonPath;
    ndiAddon = require(addonPath);
    if (!ndiAddon.available()) {
      ndiAddonLoadError = 'NDI runtime not available. Install NDI and restart Ghost Arcade.';
      console.warn(`[NDI] Addon loaded but ${ndiAddonLoadError}.`);
      ndiAddon = null;
      return null;
    }
    console.log(`[NDI] Addon loaded successfully: ${addonPath}`);
    return ndiAddon;
  } catch (err) {
    ndiAddonLoadError = err?.message || String(err);
    console.error('[NDI] Failed to load addon:', ndiAddonLoadError);
    return null;
  }
}
const ndiSenders = new Set();    // tracks live sender names so we can destroy on quit
const ndiReceivers = new Set();  // tracks live receiver source names

// Ableton Link — main-process singleton (Link spawns its own network
// threads; one session per app). Lazily created on first link_enable.
// GPLv2 vendor — commercial distribution needs Ableton's no-cost Link
// license; see docs/time-sync-review-2026-06.md.
let linkAddon = null;
let linkAddonLoadAttempted = false;
let linkAddonLoadError = null;
let linkSession = null;

function loadLinkAddon() {
  if (linkAddon) return linkAddon;
  if (linkAddonLoadAttempted) return null;
  linkAddonLoadAttempted = true;
  try {
    const candidates = getTextureShareAddonCandidates('link_addon.node');
    const addonPath = candidates.find(candidate => fs.existsSync(candidate));
    if (!addonPath) {
      linkAddonLoadError = 'link_addon.node not built';
      console.log(`[Link] ${linkAddonLoadError}. Checked: ${candidates.join(', ')}`);
      return null;
    }
    linkAddon = require(addonPath);
    console.log(`[Link] Addon loaded: ${addonPath}`);
    return linkAddon;
  } catch (err) {
    linkAddonLoadError = err?.message || String(err);
    console.error('[Link] Failed to load addon:', linkAddonLoadError);
    return null;
  }
}

function shutdownLink() {
  if (linkSession) {
    try { linkSession.enable(false); } catch {}
    linkSession = null;
    console.log('[Link] Session disabled');
  }
}

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
    osrFailureReason = null;
    osrPaintDiagCount = 0;
    osrSendTextureFailCount = 0;
    spoutCpuFallbackWarned = false;
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

function normalizeOsrHandleBuffer(handle) {
  if (!handle) return null;
  if (Buffer.isBuffer(handle)) return handle;
  if (ArrayBuffer.isView(handle)) {
    return Buffer.from(handle.buffer, handle.byteOffset, handle.byteLength);
  }
  if (handle instanceof ArrayBuffer) {
    return Buffer.from(handle);
  }
  return null;
}

function getBufferByteLength(buffer) {
  return buffer?.byteLength ?? buffer?.length ?? 0;
}

function getOsrSharedTextureHandle(textureInfo) {
  const currentHandle = isMac
    ? textureInfo?.handle?.ioSurface
    : textureInfo?.handle?.ntHandle;
  const currentBuffer = normalizeOsrHandleBuffer(currentHandle);
  if (currentBuffer) {
    return {
      handle: currentBuffer,
      source: isMac ? 'handle.ioSurface' : 'handle.ntHandle',
    };
  }

  const legacyBuffer = normalizeOsrHandleBuffer(textureInfo?.sharedTextureHandle);
  if (legacyBuffer) {
    return {
      handle: legacyBuffer,
      source: 'sharedTextureHandle',
    };
  }

  return {
    handle: null,
    source: 'none',
  };
}

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
  osrFailureReason = null;
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
        backgroundThrottling: false,
        offscreen: {
          useSharedTexture: true,
        },
        webgl: true,
      },
    });

    // Keep the hidden offscreen renderer on the same cadence as our explicit
    // invalidate pump. Without this, Electron can create the Syphon server but
    // never composite shared textures, which consumers display as black.
    spoutOsrWindow.webContents.setFrameRate(OSR_PAINT_FPS);

    // Paint event handler — the core zero-copy path.
    //
    // Handle format by platform:
    //   Windows: textureInfo.handle.ntHandle is an 8-byte HANDLE (DXGI shared
    //            handle). Older Electron builds exposed sharedTextureHandle.
    //   macOS:   textureInfo.handle.ioSurface is an 8-byte IOSurfaceRef pointer
    //            in current Electron. Older builds exposed a 4-byte
    //            sharedTextureHandle IOSurfaceID. The native addon accepts both.
    // The Windows addon ignores the extra width/height args, so we can call
    // with the same arg list on both platforms.
    const minHandleLen = isMac ? 4 : 8;
    spoutOsrWindow.webContents.on('paint', (event) => {
      if (!osrActive || !spoutOutput || !event.texture) {
        if (event.texture) event.texture.release();
        return;
      }

      try {
        const info = event.texture.textureInfo || {};
        const handleInfo = getOsrSharedTextureHandle(info);
        const handle = handleInfo.handle;
        const handleLen = getBufferByteLength(handle);
        const tw = info.codedSize?.width || width;
        const th = info.codedSize?.height || height;

        if (osrPaintDiagCount < 3) {
          console.log(`[${textureShareLabel} OSR] paint #${osrPaintDiagCount + 1}: handle=${handleInfo.source} bytes=${handleLen} coded=${tw}x${th}`);
          osrPaintDiagCount++;
        }

        if (!handle || handleLen < minHandleLen) {
          if (osrSendTextureFailCount < 5) {
            console.warn(`[${textureShareLabel} OSR] paint event missing shared texture handle (${handleLen} bytes, source=${handleInfo.source})`);
            osrSendTextureFailCount++;
          }
          return;
        }

        const ok = spoutOutput.sendTexture(handle, tw, th);
        if (!ok) {
          if (osrSendTextureFailCount < 5) {
            console.warn(`[${textureShareLabel} OSR] sendTexture returned false for ${tw}x${th}`);
            osrSendTextureFailCount++;
          }
          return;
        }

        osrFrameCount++;

        const now = Date.now();
        if (now - osrLastLogTime > 5000) {
          const elapsed = (now - osrLastLogTime) / 1000;
          const fps = osrFrameCount / elapsed;
          console.log(`[${textureShareLabel} OSR] sendTexture ${tw}x${th} @ ${fps.toFixed(1)} fps`);
          osrFrameCount = 0;
          osrLastLogTime = now;
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
        spoutOsrWindow?.webContents?.startPainting?.();
        spoutOsrWindow?.webContents?.invalidate?.();
      } catch (err) {
        console.warn(`[${textureShareLabel} OSR] initial paint kick failed:`, err?.message || err);
      }
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
      osrFailureReason = 'renderer-gone';
      stopOsrPaintPump();
      stopOsrWatchdog();
      notifyMainWindowOsrStatus(false, 'renderer-gone');
    });

    spoutOsrWindow.on('closed', () => {
      console.log(`[${textureShareLabel} OSR] Window closed`);
      spoutOsrWindow = null;
      osrActive = false;
      stopOsrPaintPump();
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
    osrFailureReason = 'create-failed';
    notifyMainWindowOsrStatus(false, 'create-failed');
  } finally {
    osrCreating = false;
  }
}

function destroySpoutOsrWindow() {
  osrActive = false;
  stopOsrPaintPump();
  stopOsrWatchdog();

  if (spoutOsrWindow) {
    try {
      spoutOsrWindow.close();
    } catch {}
    spoutOsrWindow = null;
    console.log(`[${textureShareLabel} OSR] Window destroyed`);
  }

  // Notify main window so it can clear OSR state and apply the current
  // fallback policy.
  notifyMainWindowOsrStatus(false, 'stopped');
}

function notifyMainWindowOsrStatus(active, reason) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('spout-osr-status', {
        active,
        reason,
        cpuFallbackAllowed: ALLOW_CPU_TEXTURE_SHARE_FALLBACK,
      });
    } catch {}
  }
}

function startOsrPaintPump() {
  stopOsrPaintPump();

  if (!spoutOsrWindow || spoutOsrWindow.isDestroyed()) return;

  const intervalMs = Math.max(4, Math.round(1000 / OSR_PAINT_FPS));
  const tick = () => {
    const win = spoutOsrWindow;
    if (!win || win.isDestroyed()) {
      stopOsrPaintPump();
      return;
    }

    try {
      const wc = win.webContents;
      if (!wc || wc.isDestroyed()) {
        stopOsrPaintPump();
        return;
      }

      if (typeof wc.startPainting === 'function' && (typeof wc.isPainting !== 'function' || !wc.isPainting())) {
        wc.startPainting();
      }
      if (typeof wc.invalidate === 'function') {
        wc.invalidate();
      }
    } catch (err) {
      console.warn(`[${textureShareLabel} OSR] paint pump failed:`, err?.message || err);
      stopOsrPaintPump();
    }
  };

  tick();
  osrPaintPump = setInterval(tick, intervalMs);
  console.log(`[${textureShareLabel} OSR] Paint pump started @ ${OSR_PAINT_FPS} fps`);
}

function stopOsrPaintPump() {
  if (osrPaintPump) {
    clearInterval(osrPaintPump);
    osrPaintPump = null;
  }

  const win = spoutOsrWindow;
  if (!win || win.isDestroyed()) return;

  try {
    const wc = win.webContents;
    if (wc && !wc.isDestroyed() && typeof wc.stopPainting === 'function') {
      wc.stopPainting();
    }
  } catch {}
}

function getTextureShareSenderMode() {
  if (osrActive) return 'zero-copy';
  if (ALLOW_CPU_TEXTURE_SHARE_FALLBACK) return 'cpu-sendimage';
  return osrFailureReason ? 'zero-copy-unavailable' : 'zero-copy-pending';
}

function startOsrWatchdog() {
  stopOsrWatchdog();
  let lastFrameCount = osrFrameCount;

  osrWatchdog = setInterval(() => {
    if (!osrActive) return;

    if (osrFrameCount === lastFrameCount) {
      osrFailureReason = 'stale';
      osrActive = false;
      stopOsrPaintPump();
      stopOsrWatchdog();
      if (ALLOW_CPU_TEXTURE_SHARE_FALLBACK) {
        // Compatibility/debug mode only. This is visibly slower because the
        // renderer resumes full-frame getImageData/readback traffic.
        console.warn(`[${textureShareLabel} OSR] Watchdog: no frames for 3s — zero-copy DEAD, falling back to CPU compatibility path`);
        notifyMainWindowOsrStatus(false, 'stale');
      } else {
        console.error(`[${textureShareLabel} OSR] Watchdog: no shared-texture frames for 3s — zero-copy unavailable. CPU fallback is disabled; launch with GA_ALLOW_CPU_TEXTURE_SHARE_FALLBACK=1 or --allow-cpu-texture-share only for compatibility testing.`);
        notifyMainWindowOsrStatus(false, 'stale');
      }
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

// ============================================================
// Atlas fan-out — multi-slice zero-copy senders
//
// One hidden OSR window (?mode=slice-atlas) composites EVERY sender
// slice into a single atlas texture. Each Chromium paint hands us one
// DXGI shared handle; SpoutAtlasOutput opens it once and sub-copies the
// configured regions into per-name senders on the GPU. Flat cost in
// slice count. See docs/multi-slice-zerocopy-plan.md.
// ============================================================

function notifyMainWindowAtlasStatus(active, reason) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('texshare-atlas-status', { active, reason });
    } catch {}
  }
}

function clampAtlasDim(v, fallback) {
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(64, Math.min(8192, Math.round(v)));
}

function configureAtlasSenders(layout) {
  if (!atlasOutput) return;
  const tiles = Array.isArray(layout?.tiles) ? layout.tiles : [];
  const regions = tiles
    .filter(t => t && t.senderName && t.w > 0 && t.h > 0)
    .map(t => ({
      name: String(t.senderName),
      x: Math.max(0, Math.round(t.x)),
      y: Math.max(0, Math.round(t.y)),
      w: Math.round(t.w),
      h: Math.round(t.h),
    }));
  try {
    atlasOutput.configure(regions);
  } catch (err) {
    console.error('[Atlas] configure failed:', err?.message || err);
  }
}

function startAtlasOutput() {
  if (atlasState.active) return true;
  if (atlasOsrCreating) return false;

  const addon = loadSpoutAddon();
  const AtlasCtor = isMac ? addon?.SyphonAtlasOutput : addon?.SpoutAtlasOutput;
  const ctorName = isMac ? 'SyphonAtlasOutput' : 'SpoutAtlasOutput';
  if (typeof AtlasCtor !== 'function') {
    console.error(`[Atlas] addon missing ${ctorName} — rebuild electron/native`);
    return false;
  }

  try {
    atlasOutput = new AtlasCtor();
  } catch (err) {
    console.error(`[Atlas] ${ctorName} construction failed:`, err?.message || err);
    atlasOutput = null;
    return false;
  }
  if (!atlasOutput.isInitialized()) {
    console.error(`[Atlas] ${ctorName} init failed — atlas unavailable`);
    try { atlasOutput.release(); } catch {}
    atlasOutput = null;
    return false;
  }

  // The slice-atlas window publishes its real layout once it boots; start
  // with the last known layout (editor may have sent one already) or a
  // placeholder size that the first texshare_atlas_layout corrects.
  const layout = atlasState.layout;
  createAtlasOsrWindow(
    clampAtlasDim(layout?.atlasW, 640),
    clampAtlasDim(layout?.atlasH, 360),
  );
  if (!atlasOsrWindow) {
    try { atlasOutput.release(); } catch {}
    atlasOutput = null;
    return false;
  }
  if (layout?.tiles?.length) configureAtlasSenders(layout);

  atlasState.active = true;
  atlasFrameCount = 0;
  atlasLastLogTime = Date.now();
  atlasPaintDiagCount = 0;
  atlasSendFailCount = 0;
  notifyMainWindowAtlasStatus(true, 'started');
  console.log('[Atlas] Fan-out started');
  return true;
}

function stopAtlasOutput(reason = 'stopped') {
  const wasActive = atlasState.active;
  atlasState.active = false;
  destroyAtlasOsrWindow();
  if (atlasOutput) {
    try { atlasOutput.release(); } catch {}
    atlasOutput = null;
  }
  if (wasActive) {
    console.log(`[Atlas] Fan-out stopped (${reason})`);
    notifyMainWindowAtlasStatus(false, reason);
  }
}

function createAtlasOsrWindow(width, height) {
  if (atlasOsrWindow || atlasOsrCreating) {
    console.log('[Atlas OSR] Window already exists or creating');
    return;
  }

  atlasOsrCreating = true;
  console.log(`[Atlas OSR] Creating ${width}x${height} window`);

  try {
    atlasOsrWindow = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: {
          useSharedTexture: true,
        },
        webgl: true,
      },
    });

    atlasOsrWindow.webContents.setFrameRate(OSR_PAINT_FPS);

    const minHandleLen = isMac ? 4 : 8;
    atlasOsrWindow.webContents.on('paint', (event) => {
      if (!atlasState.active || !atlasOutput || !event.texture) {
        if (event.texture) event.texture.release();
        return;
      }

      try {
        const info = event.texture.textureInfo || {};
        const handleInfo = getOsrSharedTextureHandle(info);
        const handle = handleInfo.handle;
        const handleLen = getBufferByteLength(handle);

        if (atlasPaintDiagCount < 3) {
          const tw = info.codedSize?.width || 0;
          const th = info.codedSize?.height || 0;
          console.log(`[Atlas OSR] paint #${atlasPaintDiagCount + 1}: handle=${handleInfo.source} bytes=${handleLen} coded=${tw}x${th}`);
          atlasPaintDiagCount++;
        }

        if (!handle || handleLen < minHandleLen) {
          if (atlasSendFailCount < 5) {
            console.warn(`[Atlas OSR] paint missing shared texture handle (${handleLen} bytes, source=${handleInfo.source})`);
            atlasSendFailCount++;
          }
          return;
        }

        const sent = atlasOutput.sendAtlas(handle);
        if (sent > 0) {
          atlasFrameCount++;
          const now = Date.now();
          if (now - atlasLastLogTime > 5000) {
            const fps = atlasFrameCount / ((now - atlasLastLogTime) / 1000);
            console.log(`[Atlas OSR] sendAtlas → ${sent} sender(s) @ ${fps.toFixed(1)} fps`);
            atlasFrameCount = 0;
            atlasLastLogTime = now;
          }
        } else if (atlasSendFailCount < 5 && (atlasState.layout?.tiles?.length ?? 0) > 0) {
          console.warn('[Atlas OSR] sendAtlas fed 0 senders');
          atlasSendFailCount++;
        }
      } catch (err) {
        console.error('[Atlas OSR] paint handler error:', err.message);
      } finally {
        // CRITICAL: Always release to avoid shared texture pool exhaustion
        event.texture.release();
      }
    });

    // SliceAtlasApp doesn't invoke spout_osr_ready (that's the single-output
    // app's contract) — start the paint pump as soon as the page loads.
    atlasOsrWindow.webContents.on('did-finish-load', () => {
      console.log('[Atlas OSR] Page loaded');
      try {
        atlasOsrWindow?.webContents?.startPainting?.();
        atlasOsrWindow?.webContents?.invalidate?.();
      } catch (err) {
        console.warn('[Atlas OSR] initial paint kick failed:', err?.message || err);
      }
      startAtlasPaintPump();
    });

    atlasOsrWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[Atlas OSR] Renderer process gone:', details.reason);
      stopAtlasOutput('renderer-gone');
    });

    atlasOsrWindow.on('closed', () => {
      atlasOsrWindow = null;
      stopAtlasPaintPump();
    });

    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
    if (!app.isPackaged) {
      atlasOsrWindow.loadURL(`${devUrl}?mode=slice-atlas&webgpu-disable=1`);
    } else {
      const filePath = path.join(__dirname, '..', 'dist', 'index.html');
      atlasOsrWindow.loadFile(filePath, { query: { mode: 'slice-atlas', 'webgpu-disable': '1' } });
    }

    console.log('[Atlas OSR] Window created');
  } catch (err) {
    console.error('[Atlas OSR] Failed to create window:', err.message);
    atlasOsrWindow = null;
  } finally {
    atlasOsrCreating = false;
  }
}

function destroyAtlasOsrWindow() {
  stopAtlasPaintPump();
  if (atlasOsrWindow) {
    try { atlasOsrWindow.close(); } catch {}
    atlasOsrWindow = null;
    console.log('[Atlas OSR] Window destroyed');
  }
}

function startAtlasPaintPump() {
  stopAtlasPaintPump();
  if (!atlasOsrWindow || atlasOsrWindow.isDestroyed()) return;

  const intervalMs = Math.max(4, Math.round(1000 / OSR_PAINT_FPS));
  const tick = () => {
    const win = atlasOsrWindow;
    if (!win || win.isDestroyed()) {
      stopAtlasPaintPump();
      return;
    }
    try {
      const wc = win.webContents;
      if (!wc || wc.isDestroyed()) {
        stopAtlasPaintPump();
        return;
      }
      if (typeof wc.startPainting === 'function' && (typeof wc.isPainting !== 'function' || !wc.isPainting())) {
        wc.startPainting();
      }
      if (typeof wc.invalidate === 'function') {
        wc.invalidate();
      }
    } catch (err) {
      console.warn('[Atlas OSR] paint pump failed:', err?.message || err);
      stopAtlasPaintPump();
    }
  };

  tick();
  atlasPaintPump = setInterval(tick, intervalMs);
  console.log(`[Atlas OSR] Paint pump started @ ${OSR_PAINT_FPS} fps`);
}

function stopAtlasPaintPump() {
  if (atlasPaintPump) {
    clearInterval(atlasPaintPump);
    atlasPaintPump = null;
  }
  const win = atlasOsrWindow;
  if (!win || win.isDestroyed()) return;
  try {
    const wc = win.webContents;
    if (wc && !wc.isDestroyed() && typeof wc.stopPainting === 'function') {
      wc.stopPainting();
    }
  } catch {}
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

function normalizeSharedTextureHandle(handle) {
  if (!handle) return null;
  if (Buffer.isBuffer(handle)) return handle;
  if (ArrayBuffer.isView(handle)) {
    return Buffer.from(handle.buffer, handle.byteOffset, handle.byteLength);
  }
  if (handle instanceof ArrayBuffer) return Buffer.from(handle);
  return null;
}

function receiveSpoutTextureInfo() {
  if (!spoutReceiver) {
    return {
      available: false,
      platform: textureSharePlatform,
      label: textureShareLabel,
      reason: 'receiver-not-started',
    };
  }

  if (typeof spoutReceiver.receiveTextureInfo !== 'function') {
    return {
      available: false,
      platform: textureSharePlatform,
      label: textureShareLabel,
      reason: 'receiver-texture-info-unavailable',
      senderName: spoutReceiverName,
    };
  }

  const info = spoutReceiver.receiveTextureInfo();
  if (!info) return null;

  const handle = normalizeSharedTextureHandle(info.handle);
  if (!handle || handle.byteLength === 0) return null;
  const format = typeof info.format === 'string'
    ? info.format
    : Number(info.format || 0);

  return {
    available: true,
    platform: textureSharePlatform,
    label: textureShareLabel,
    senderName: String(info.senderName || spoutReceiverName || ''),
    width: Number(info.width || 0),
    height: Number(info.height || 0),
    format,
    updated: !!info.updated,
    isNewFrame: !!info.isNewFrame,
    frame: Number(info.frame || 0),
    fps: Number(info.fps || 0),
    handle: handle.toString('base64'),
    handleEncoding: 'base64',
    handleByteLength: handle.byteLength,
  };
}

function listSpoutSenders() {
  const addon = loadSpoutAddon();
  if (!addon) return [];

  try {
    const senders = addon.listSenders();
    const key = JSON.stringify(senders || []);
    if (key !== textureShareSenderListLogKey) {
      textureShareSenderListLogKey = key;
      console.log(`[${textureShareLabel}] listSenders -> ${(senders || []).length}: ${(senders || []).join(', ')}`);
    }
    return senders;
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
// Coalesce OSC → renderer IPC. Controllers typically send ONE message
// per UDP packet; a busy fader bank easily produces 200+ packets/sec,
// and each webContents.send is a separate IPC round-trip. Messages
// queue for up to 8ms (half a frame — imperceptible on a fader) and
// flush as one batched send. Queue is capped: OSC is realtime control,
// so when the renderer can't keep up the OLDEST values are the right
// ones to drop.
const OSC_FLUSH_MS = 8;
const OSC_QUEUE_MAX = 512;
let oscMsgQueue = [];
let oscFlushTimer = null;
function queueOscMessages(win, msgs) {
  oscMsgQueue.push(...msgs);
  if (oscMsgQueue.length > OSC_QUEUE_MAX) {
    oscMsgQueue.splice(0, oscMsgQueue.length - OSC_QUEUE_MAX);
  }
  if (oscFlushTimer) return;
  oscFlushTimer = setTimeout(() => {
    oscFlushTimer = null;
    const batch = oscMsgQueue;
    oscMsgQueue = [];
    if (batch.length === 0 || !win || win.isDestroyed()) return;
    win.webContents.send('osc-msg', batch);
  }, OSC_FLUSH_MS);
}
function stopOSC() {
  if (oscSocket) {
    try { oscSocket.close(); } catch (e) { /* socket already gone */ }
    oscSocket = null;
  }
  if (oscFlushTimer) {
    clearTimeout(oscFlushTimer);
    oscFlushTimer = null;
  }
  oscMsgQueue = [];
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
          queueOscMessages(win, serializable);
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
  ipcMain.handle('wled_send_frame', async (_, { controllerId, ip, port, pixels }) => {
    if (!ip || !pixels || pixels.length === 0) return { ok: false, error: 'missing ip or pixels' };
    let sock = wledSockets.get(controllerId);
    if (!sock) {
      sock = dgram.createSocket('udp4');
      sock.on('error', (err) => {
        console.warn('[WLED] socket error for', controllerId, err.message);
      });
      sock._gaInFlight = 0;
      wledSockets.set(controllerId, sock);
    }
    // Backpressure: UDP sends complete async. If the renderer pushes
    // frames faster than the network stack drains (controller offline,
    // congested Wi-Fi), the send queue grows without bound. Dropping a
    // realtime LED frame is invisible; a multi-second backlog is not.
    if (sock._gaInFlight >= 2) {
      return { ok: false, dropped: true };
    }
    // pixels arrives as a Buffer (Node serializes Uint8Array → Buffer
    // across IPC). Either way the bytes are R,G,B triples already
    // packed by the renderer.
    const payload = Buffer.isBuffer(pixels) ? pixels : Buffer.from(pixels);
    const packet = Buffer.alloc(2 + payload.length);
    packet[0] = 2;     // DRGB
    packet[1] = 255;   // timeout
    payload.copy(packet, 2);
    sock._gaInFlight = (sock._gaInFlight || 0) + 1;
    return new Promise((resolve) => {
      sock.send(packet, 0, packet.length, port || 21324, ip, (err) => {
        sock._gaInFlight = Math.max(0, (sock._gaInFlight || 1) - 1);
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
  // --- Ableton Link ---
  // Renderer polls link_get_state (~4Hz) and re-anchors a local phase
  // extrapolation; tempo writes flow both ways (tap tempo → setTempo,
  // session tempo → audioStore.manualBPM in sync/abletonLink.ts).
  ipcMain.handle('link_enable', (_, args) => {
    const addon = loadLinkAddon();
    if (!addon) return { ok: false, error: linkAddonLoadError || 'Link addon unavailable' };
    try {
      const bpm = Number(args?.bpm) || 120;
      if (!linkSession) {
        linkSession = new addon.LinkSession(bpm);
        linkSession.enableStartStopSync(true);
      }
      linkSession.enable(true);
      console.log(`[Link] Enabled (initial ${bpm} BPM)`);
      return { ok: true };
    } catch (err) {
      console.error('[Link] enable failed:', err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('link_disable', () => {
    try { linkSession?.enable(false); } catch {}
    console.log('[Link] Disabled');
    return { ok: true };
  });

  ipcMain.handle('link_set_tempo', (_, args) => {
    if (!linkSession) return { ok: false, error: 'Link not enabled' };
    const bpm = Number(args?.bpm);
    if (!Number.isFinite(bpm)) return { ok: false, error: 'bad bpm' };
    try {
      return { ok: !!linkSession.setTempo(bpm) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('link_get_state', () => {
    if (!linkSession) return { available: !!loadLinkAddon(), enabled: false };
    try {
      return { available: true, ...linkSession.getState() };
    } catch (err) {
      return { available: true, enabled: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('ndi_available', () => {
    const a = loadNdiAddon();
    return {
      ...getNdiLoadStatus(),
      available: !!a,
    };
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
    console.log(`[IPC] spout_is_available (${textureShareLabel}):`, available, spoutAddonLoadError || '');
    return available;
  });

  // Return which texture sharing system is in use
  ipcMain.handle('texture_share_info', () => {
    loadSpoutAddon();
    return getTextureShareLoadStatus();
  });

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
        mode: getTextureShareSenderMode(),
        cpuFallbackAllowed: ALLOW_CPU_TEXTURE_SHARE_FALLBACK,
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
      mode: getTextureShareSenderMode(),
      cpuFallbackAllowed: ALLOW_CPU_TEXTURE_SHARE_FALLBACK,
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

    if (!ALLOW_CPU_TEXTURE_SHARE_FALLBACK) {
      if (!spoutCpuFallbackWarned) {
        spoutCpuFallbackWarned = true;
        console.warn(`[${textureShareLabel}] CPU sendImage rejected — zero-copy is required. Set GA_ALLOW_CPU_TEXTURE_SHARE_FALLBACK=1 or pass --allow-cpu-texture-share to enable the legacy compatibility path for testing.`);
      }
      return false;
    }

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

  ipcMain.handle('spout_receive_texture_info', () => {
    try {
      return receiveSpoutTextureInfo();
    } catch (err) {
      console.error('[IPC] spout_receive_texture_info error:', err.message);
      return {
        available: false,
        platform: textureSharePlatform,
        label: textureShareLabel,
        reason: err.message || 'texture-info-error',
        senderName: spoutReceiverName,
      };
    }
  });

  ipcMain.handle('spout_get_status', () => {
    return {
      sender_active: spoutSendActive,
      sender_name: spoutSendName,
      sender_mode: getTextureShareSenderMode(),
      osr_active: osrActive,
      osr_failure_reason: osrFailureReason,
      cpu_fallback_allowed: ALLOW_CPU_TEXTURE_SHARE_FALLBACK,
      receiver_active: spoutReceiver !== null,
      receiver_texture_info_available:
        spoutReceiver !== null && typeof spoutReceiver.receiveTextureInfo === 'function',
      receiver_texture_info_supported: getReceiverTextureInfoSupport(spoutAddon),
      receivers: [],
      atlas_active: atlasState.active,
      atlas_sender_count: atlasState.layout?.tiles?.length ?? 0,
    };
  });

  // --- Multi-slice zero-copy atlas ---
  // The slice-atlas OSR window publishes its packed layout here whenever
  // it changes: (re)configure the per-name native senders and resize the
  // atlas OSR window to the new atlas dimensions.
  ipcMain.handle('texshare_atlas_layout', (_, layout) => {
    atlasState.layout = layout && typeof layout === 'object' ? layout : null;
    const n = atlasState.layout?.tiles?.length ?? 0;
    if (n !== atlasState.lastLoggedCount) {
      atlasState.lastLoggedCount = n;
      console.log(`[Atlas] layout: ${n} sender tile(s), atlas ${layout?.atlasW || 0}x${layout?.atlasH || 0}${layout?.overflow ? ' (OVERFLOW)' : ''}`);
    }

    if (atlasOutput) {
      configureAtlasSenders(atlasState.layout);
    }
    if (atlasOsrWindow && !atlasOsrWindow.isDestroyed() && n > 0) {
      const w = clampAtlasDim(atlasState.layout?.atlasW, 0);
      const h = clampAtlasDim(atlasState.layout?.atlasH, 0);
      if (w > 0 && h > 0) {
        try {
          const [curW, curH] = atlasOsrWindow.getSize();
          if (curW !== w || curH !== h) {
            atlasOsrWindow.setSize(w, h);
            console.log(`[Atlas OSR] Resized to ${w}x${h}`);
          }
          atlasOsrWindow.webContents.invalidate?.();
        } catch (err) {
          console.error('[Atlas OSR] resize failed:', err?.message || err);
        }
      }
    }
    return { ok: true };
  });

  // Editor lifecycle: start/stop the atlas fan-out from the sender-slice
  // set in Canvas.svelte (≥1 Spout/Syphon sender slice → start).
  ipcMain.handle('texshare_start_atlas', () => {
    return startAtlasOutput();
  });

  ipcMain.handle('texshare_stop_atlas', () => {
    stopAtlasOutput('stopped');
    return true;
  });

  // --- OSR zero-copy lifecycle ---
  ipcMain.handle('spout_osr_ready', () => {
    console.log(`[${textureShareLabel} OSR] Renderer reports ready`);
    osrActive = true;
    osrFailureReason = null;
    osrLastLogTime = Date.now();
    osrFrameCount = 0;
    startOsrPaintPump();
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
        spoutOsrWindow.webContents.invalidate?.();
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

  // ── Stage 3D pop-out window ────────────────────────────────────────
  // Opens the 3D Stage Designer in its own BrowserWindow so the editor
  // stays free for live performance. Idempotent — calling while the
  // window is already open just brings it to the front. The renderer
  // shape inside is identical to a regular full editor (mounts Canvas +
  // Stage3DDesigner with state-sync over BroadcastChannel), so visuals
  // flowing through the editor's layers appear on the LED-screen meshes.
  ipcMain.handle('open_stage3d_window', () => {
    if (stage3dWindow && !stage3dWindow.isDestroyed()) {
      stage3dWindow.show();
      stage3dWindow.focus();
      return { alreadyOpen: true };
    }
    createStage3DWindow();
    return { alreadyOpen: false };
  });

  // The renderer pings this when the user clicks the in-app close
  // button so we can dispose the window from the main process side
  // (renderer-initiated `window.close()` doesn't always fire on macOS).
  ipcMain.handle('stage3d_window_closing', () => {
    if (stage3dWindow && !stage3dWindow.isDestroyed()) {
      stage3dWindow.close();
    }
  });

  ipcMain.handle('stage3d_set_fullscreen', (_, { fullScreen } = {}) => {
    if (!stage3dWindow || stage3dWindow.isDestroyed()) {
      return { ok: false, fullScreen: false, error: 'Stage 3D window is not open' };
    }
    const next = !!fullScreen;
    stage3dWindow.setFullScreen(next);
    publishStage3DFullscreenState(next);
    return { ok: true, fullScreen: next };
  });

  ipcMain.handle('stage3d_get_fullscreen', () => ({
    ok: !!(stage3dWindow && !stage3dWindow.isDestroyed()),
    fullScreen: !!(stage3dWindow && !stage3dWindow.isDestroyed() && stage3dWindow.isFullScreen()),
  }));

  // ── Projection Simulator pop-out window ───────────────────────────
  // Same performer workflow as Stage 3D: keep the editor/mapping UI
  // available while the 3D simulation lives on another monitor.
  ipcMain.handle('open_projection_sim_window', () => {
    if (projectionSimWindow && !projectionSimWindow.isDestroyed()) {
      projectionSimWindow.show();
      projectionSimWindow.focus();
      return { alreadyOpen: true };
    }
    createProjectionSimWindow();
    return { alreadyOpen: false };
  });

  ipcMain.handle('projection_sim_window_closing', () => {
    if (projectionSimWindow && !projectionSimWindow.isDestroyed()) {
      projectionSimWindow.close();
    }
  });

  ipcMain.handle('projection_sim_set_fullscreen', (_, { fullScreen } = {}) => {
    if (!projectionSimWindow || projectionSimWindow.isDestroyed()) {
      return { ok: false, fullScreen: false, error: 'Projection Simulator window is not open' };
    }
    const next = !!fullScreen;
    projectionSimWindow.setFullScreen(next);
    publishProjectionSimFullscreenState(next);
    return { ok: true, fullScreen: next };
  });

  ipcMain.handle('projection_sim_get_fullscreen', () => ({
    ok: !!(projectionSimWindow && !projectionSimWindow.isDestroyed()),
    fullScreen: !!(projectionSimWindow && !projectionSimWindow.isDestroyed() && projectionSimWindow.isFullScreen()),
  }));

  ipcMain.handle('projection_sim_is_open', () => projectionSimWindow !== null && !projectionSimWindow.isDestroyed());

  // ── Stage 3D state relay ──────────────────────────────────────────
  // BroadcastChannel between two Electron BrowserWindows is flaky on
  // some macOS configurations — Chromium's agent-cluster boundaries
  // don't always allow same-origin cross-window broadcast. We instead
  // route the editor's project JSON through the main process: the
  // editor pushes serialised project state, Stage 3D polls for it.
  //
  // Full/layout state and live VJ state are held separately. The Stage 3D
  // receiver asks for only the streams whose ticks changed, which keeps
  // live clip/fader updates from re-sending or re-importing the whole
  // project during performance.
  let stage3dRelayedFullState = null;
  let stage3dRelayedLiveState = null;
  let stage3dRelayedSceneState = null;
  let stage3dRelayedSettingsState = null;
  // Cumulative per-layer patches (corners/opacity/meshGrid), merged by
  // layer id so a slow poller still converges on the latest values.
  // Cleared whenever a new full lands — the full already carries them.
  let stage3dRelayedPatchState = {};
  let stage3dRelayFullTick = 0;
  let stage3dRelayLiveTick = 0;
  let stage3dRelaySceneTick = 0;
  let stage3dRelaySettingsTick = 0;
  let stage3dRelayPatchTick = 0;
  ipcMain.handle('stage3d_publish_state', (_, payload) => {
    const kind = payload && typeof payload === 'object' ? payload.kind : 'full';
    const state = payload && typeof payload === 'object' && 'state' in payload ? payload.state : payload;
    if (kind === 'live') {
      stage3dRelayedLiveState = state;
      stage3dRelayLiveTick++;
    } else if (kind === 'scene') {
      stage3dRelayedSceneState = state;
      stage3dRelaySceneTick++;
    } else if (kind === 'settings') {
      stage3dRelayedSettingsState = state;
      stage3dRelaySettingsTick++;
    } else if (kind === 'patch') {
      if (Array.isArray(state)) {
        for (const patch of state) {
          if (!patch || typeof patch.id !== 'string') continue;
          stage3dRelayedPatchState[patch.id] = { ...stage3dRelayedPatchState[patch.id], ...patch };
        }
        stage3dRelayPatchTick++;
      }
    } else {
      stage3dRelayedFullState = state;
      stage3dRelayFullTick++;
      stage3dRelayedPatchState = {};
      if (state?.vjClipLauncher) {
        stage3dRelayedLiveState = state.vjClipLauncher;
        stage3dRelayLiveTick++;
      }
      if (state?.stage3dScene) {
        stage3dRelayedSceneState = state.stage3dScene;
        stage3dRelaySceneTick++;
      }
      if (state?.settings) {
        stage3dRelayedSettingsState = state.settings;
        stage3dRelaySettingsTick++;
      }
    }
  });
  ipcMain.handle('stage3d_get_state', (_, cursor = {}) => ({
    full: cursor.fullTick === stage3dRelayFullTick ? null : stage3dRelayedFullState,
    fullTick: stage3dRelayFullTick,
    live: cursor.liveTick === stage3dRelayLiveTick ? null : stage3dRelayedLiveState,
    liveTick: stage3dRelayLiveTick,
    scene: cursor.sceneTick === stage3dRelaySceneTick ? null : stage3dRelayedSceneState,
    sceneTick: stage3dRelaySceneTick,
    settings: cursor.settingsTick === stage3dRelaySettingsTick ? null : stage3dRelayedSettingsState,
    settingsTick: stage3dRelaySettingsTick,
    patch: cursor.patchTick === stage3dRelayPatchTick ? null : Object.values(stage3dRelayedPatchState),
    patchTick: stage3dRelayPatchTick,
  }));
  ipcMain.handle('stage3d_is_open', () => stage3dWindow !== null && !stage3dWindow.isDestroyed());

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
  function screenSourceListOptions(options) {
    const raw = options && typeof options === 'object' ? options : {};
    const requestedSize = raw.thumbnailSize && typeof raw.thumbnailSize === 'object'
      ? raw.thumbnailSize
      : {};
    const width = Number.isFinite(Number(requestedSize.width))
      ? Math.max(0, Math.min(640, Math.round(Number(requestedSize.width))))
      : 320;
    const height = Number.isFinite(Number(requestedSize.height))
      ? Math.max(0, Math.min(360, Math.round(Number(requestedSize.height))))
      : 180;
    const timeoutMs = Number.isFinite(Number(raw.timeoutMs))
      ? Math.max(500, Math.min(10000, Math.round(Number(raw.timeoutMs))))
      : 5000;
    return {
      thumbnailSize: { width, height },
      fetchWindowIcons: raw.fetchWindowIcons !== false,
      timeoutMs,
    };
  }

  async function withScreenSourceTimeout(promise, timeoutMs) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`desktopCapturer.getSources timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  ipcMain.handle('screen_sources_list', async (_event, options = {}) => {
    try {
      const opts = screenSourceListOptions(options);
      const sources = await withScreenSourceTimeout(desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: opts.thumbnailSize,
        fetchWindowIcons: opts.fetchWindowIcons,
      }), opts.timeoutMs);
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

  ipcMain.handle('open_external_url', async (_, args) => {
    const rawUrl = typeof args === 'string' ? args : args?.url;
    try {
      const url = new URL(rawUrl);
      const isGhostArcade = url.hostname === 'ghostarcade.live' || url.hostname === 'www.ghostarcade.live';
      const isReleaseRepo = url.hostname === 'github.com' && url.pathname.startsWith('/riskcapital/ghost-arcade-releases/');
      if (url.protocol !== 'https:' || (!isGhostArcade && !isReleaseRepo)) {
        throw new Error('URL is not allowed');
      }
      await shell.openExternal(url.toString());
      return { success: true };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
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
      const { url, headers, data, base64Body, contentType } = args;
      validateProxyUrl(url);
      const encoded = data || base64Body;
      if (typeof encoded !== 'string') throw new Error('Missing binary payload');
      const buf = Buffer.from(encoded, 'base64');
      if (buf.length > 100 * 1024 * 1024) throw new Error('Payload too large (100MB max)');
      const requestHeaders = { ...(headers || {}) };
      if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
        requestHeaders['Content-Type'] = contentType || 'application/octet-stream';
      }
      const resp = await fetch(url, {
        method: 'PUT',
        headers: requestHeaders,
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

  ipcMain.handle('jpeg_sequence_start', async (_, args = {}) => {
    try {
      const job = startJpegSequenceJob(args);
      return { success: true, ...job };
    } catch (err) {
      console.error('[Main] jpeg_sequence_start error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('jpeg_sequence_write_frame', async (_, args = {}) => {
    try {
      return await writeJpegSequenceFrame(args);
    } catch (err) {
      console.error('[Main] jpeg_sequence_write_frame error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('jpeg_sequence_finish', async (_, args = {}) => {
    try {
      return await finishJpegSequenceJob(args.jobId);
    } catch (err) {
      console.error('[Main] jpeg_sequence_finish error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('jpeg_sequence_cancel', async (_, args = {}) => {
    try {
      return await cancelJpegSequenceJob(args.jobId);
    } catch (err) {
      console.error('[Main] jpeg_sequence_cancel error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });

  // --- Native FFmpeg video loop creation ---
  ipcMain.handle('video_loop_create', async (event, args = {}) => {
    let input = null;
    let outputPath = '';
    try {
      const jobId = typeof args.jobId === 'string' && args.jobId ? args.jobId : `loop-${Date.now().toString(36)}`;
      input = resolveLoopInput(args, 'input');
      const outputName = typeof args.outputName === 'string' && args.outputName
        ? args.outputName
        : `${sanitizeOutputBase(args.inputName, 'Loop')} (Loop).mp4`;
      outputPath = safeGeneratedVideoPath(outputName);

      publishVideoLoopProgress(event.sender, {
        jobId,
        stage: 'processing',
        progress: 0.02,
        message: 'Preparing native loop encoder...',
        outputPath,
      });

      const meta = await probeVideoMetadata(input.filePath);
      let duration = meta.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        publishVideoLoopProgress(event.sender, {
          jobId,
          stage: 'processing',
          progress: 0.04,
          message: 'Scanning video duration...',
          outputPath,
        });
        duration = await probeVideoDurationByDecode(input.filePath);
        meta.duration = duration;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Could not detect video duration.');
      }
      if (duration < 1) {
        throw new Error(`Video is too short to loop (${duration.toFixed(2)}s).`);
      }

      const midpoint = duration / 2;
      const secondHalfDuration = duration - midpoint;
      const fadeDuration = clampNumber(
        args.crossfadeDuration,
        0.1,
        Math.min(3, midpoint * 0.4),
        0.5,
      );
      const xfadeOffset = Math.max(0, secondHalfDuration - fadeDuration);
      const normalize = 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p';
      const xfadeFilter =
        `[0:v]trim=start=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[v0];` +
        `[1:v]trim=end=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[v1];` +
        `[v0][v1]xfade=${loopXfadeOptions(args.transitionType, fadeDuration, xfadeOffset)}[outv]`;

      const makeXfadeArgs = (preferHardware) => [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-progress', 'pipe:2',
        '-nostats',
        '-i', input.filePath,
        '-i', input.filePath,
        '-filter_complex', xfadeFilter,
        ...videoLoopEncoderArgs(outputPath, meta, preferHardware),
      ];

      try {
        try {
          await spawnFfmpegVideoLoop({
            sender: event.sender,
            jobId,
            durationSec: duration,
            outputPath,
            startMessage: process.platform === 'darwin'
              ? 'Creating loop with hardware H.264...'
              : 'Creating seamless loop with native FFmpeg...',
            completeMessage: 'Loop video complete.',
            args: makeXfadeArgs(true),
          });
        } catch (hardwareErr) {
          if (process.platform !== 'darwin') throw hardwareErr;
          console.warn('[VideoLoop] hardware encode failed, retrying software x264:', hardwareErr?.message || hardwareErr);
          try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
          await spawnFfmpegVideoLoop({
            sender: event.sender,
            jobId,
            durationSec: duration,
            outputPath,
            startMessage: 'Hardware encode failed; retrying software H.264...',
            completeMessage: 'Loop video complete.',
            args: makeXfadeArgs(false),
          });
        }
      } catch (xfadeErr) {
        console.warn('[VideoLoop] xfade pass failed, trying concat fallback:', xfadeErr?.message || xfadeErr);
        try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
        const concatFilter =
          `[0:v]trim=start=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[v0];` +
          `[1:v]trim=end=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,${normalize}[v1];` +
          `[v0][v1]concat=n=2:v=1:a=0[outv]`;
        await spawnFfmpegVideoLoop({
          sender: event.sender,
          jobId,
          durationSec: duration,
          outputPath,
          startMessage: 'Crossfade failed; creating hard-cut loop...',
          completeMessage: 'Loop video complete.',
          args: [
            '-hide_banner',
            '-nostdin',
            '-y',
            '-progress', 'pipe:2',
            '-nostats',
            '-i', input.filePath,
            '-i', input.filePath,
            '-filter_complex', concatFilter,
            ...videoLoopEncoderArgs(outputPath, meta, false),
          ],
        });
      }

      const stat = fs.statSync(outputPath);
      return { success: true, outputPath, size: stat.size, duration };
    } catch (err) {
      if (outputPath) {
        try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
      }
      console.error('[Main] video_loop_create error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    } finally {
      try { input?.cleanup?.(); } catch { /* ignore */ }
    }
  });

  ipcMain.handle('video_append_segment', async (event, args = {}) => {
    let input = null;
    let segment = null;
    let outputPath = '';
    try {
      const jobId = typeof args.jobId === 'string' && args.jobId ? args.jobId : `append-${Date.now().toString(36)}`;
      input = resolveLoopInput(args, 'input');
      segment = resolveLoopInput(args, 'segment');
      const outputName = typeof args.outputName === 'string' && args.outputName
        ? args.outputName
        : `${sanitizeOutputBase(args.inputName, 'Video')} (Assembled).mp4`;
      outputPath = safeGeneratedVideoPath(outputName);

      publishVideoLoopProgress(event.sender, {
        jobId,
        stage: 'processing',
        progress: 0.02,
        message: 'Preparing native video assembly...',
        outputPath,
      });

      const inputMeta = await probeVideoMetadata(input.filePath);
      const segmentMeta = await probeVideoMetadata(segment.filePath);
      if (!inputMeta.duration) inputMeta.duration = await probeVideoDurationByDecode(input.filePath);
      if (!segmentMeta.duration) segmentMeta.duration = await probeVideoDurationByDecode(segment.filePath);

      const targetW = evenDimension(args.width || inputMeta.width, 1920);
      const targetH = evenDimension(args.height || inputMeta.height, 1080);
      const durationSec = Math.max(1, (inputMeta.duration || 0) + (segmentMeta.duration || 0));
      const fitToTarget = `fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,` +
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;

      const appendArgs = (preferHardware) => [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-progress', 'pipe:2',
        '-nostats',
        '-i', input.filePath,
        '-i', segment.filePath,
        '-filter_complex',
        `[0:v]${fitToTarget}[v0];[1:v]${fitToTarget}[v1];[v0][v1]concat=n=2:v=1:a=0[outv]`,
        ...videoLoopEncoderArgs(outputPath, { width: targetW, height: targetH }, preferHardware),
      ];

      try {
        await spawnFfmpegVideoLoop({
          sender: event.sender,
          jobId,
          durationSec,
          outputPath,
          startMessage: process.platform === 'darwin'
            ? 'Appending segment with hardware H.264...'
            : 'Appending segment with native FFmpeg...',
          completeMessage: 'Video assembly complete.',
          args: appendArgs(true),
        });
      } catch (hardwareErr) {
        if (process.platform !== 'darwin') throw hardwareErr;
        console.warn('[VideoAppend] hardware encode failed, retrying software x264:', hardwareErr?.message || hardwareErr);
        try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
        await spawnFfmpegVideoLoop({
          sender: event.sender,
          jobId,
          durationSec,
          outputPath,
          startMessage: 'Hardware encode failed; retrying software H.264...',
          completeMessage: 'Video assembly complete.',
          args: appendArgs(false),
        });
      }

      const stat = fs.statSync(outputPath);
      return { success: true, outputPath, size: stat.size, width: targetW, height: targetH };
    } catch (err) {
      if (outputPath) {
        try { fs.rmSync(outputPath, { force: true }); } catch { /* ignore */ }
      }
      console.error('[Main] video_append_segment error:', err?.message || err);
      return { success: false, error: err?.message || String(err) };
    } finally {
      try { input?.cleanup?.(); } catch { /* ignore */ }
      try { segment?.cleanup?.(); } catch { /* ignore */ }
    }
  });

  // --- Native FFmpeg video converter ---
  ipcMain.handle('video_converter_pick_webm', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Choose WebM Video',
      filters: [
        { name: 'WebM Video', extensions: ['webm'] },
        { name: 'Video Files', extensions: ['webm', 'mkv', 'mov', 'mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stat = fs.statSync(filePath);
    const base = sanitizeOutputBase(path.basename(filePath));
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      defaultOutputPath: path.join(path.dirname(filePath), `${base}.mp4`),
    };
  });

  ipcMain.handle('video_converter_pick_sequence_folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Choose JPG Frame Sequence Folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sequence = listImageSequenceFrames(result.filePaths[0]);
    const base = sanitizeOutputBase(path.basename(sequence.folder), 'image-sequence');
    return {
      path: sequence.folder,
      name: path.basename(sequence.folder),
      frameCount: sequence.frameCount,
      firstFrame: sequence.firstFrame,
      lastFrame: sequence.lastFrame,
      defaultOutputPath: path.join(path.dirname(sequence.folder), `${base}.mp4`),
    };
  });

  ipcMain.handle('video_converter_pick_output', async (_, args = {}) => {
    const suggested = typeof args.defaultPath === 'string' && args.defaultPath
      ? args.defaultPath
      : path.join(app.getPath('videos'), `${sanitizeOutputBase(args.defaultName, 'converted-video')}.mp4`);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save MP4',
      defaultPath: suggested,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    return { path: result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4` };
  });

  ipcMain.handle('video_converter_reveal_path', async (_, args = {}) => {
    const filePath = assertAbsolutePath(args.path, 'output path');
    if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    else shell.openPath(path.dirname(filePath));
    return { success: true };
  });

  ipcMain.handle('video_converter_cancel', async () => {
    const job = activeVideoConverterJob;
    if (!job) return { success: false, error: 'No active conversion.' };
    job.cancelled = true;
    try { job.process?.kill?.('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => {
      if (activeVideoConverterJob === job) {
        try { job.process?.kill?.('SIGKILL'); } catch { /* ignore */ }
      }
    }, 1500).unref?.();
    return { success: true };
  });

  ipcMain.handle('video_converter_start', async (event, args = {}) => {
    const mode = args.mode === 'sequence' ? 'sequence' : 'webm';
    const jobId = typeof args.jobId === 'string' && args.jobId ? args.jobId : `vc-${Date.now().toString(36)}`;
    const outputPath = assertAbsolutePath(args.outputPath, 'output path');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const crf = Math.round(clampNumber(args.crf, 10, 32, 18));
    const preset = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'].includes(args.preset)
      ? args.preset
      : 'veryfast';
    const commonOutput = [
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ];

    if (mode === 'sequence') {
      const sequence = listImageSequenceFrames(args.folderPath);
      const fps = clampNumber(args.fps, 1, 240, 30);
      const { tmpDir, listPath } = makeConcatList(sequence.frames, fps);
      const durationSec = sequence.frameCount / fps;
      publishVideoConverterProgress(event.sender, {
        jobId,
        stage: 'scanning',
        progress: 0,
        message: `Found ${sequence.frameCount} frames. Preparing encoder...`,
        outputPath,
      });
      return spawnFfmpegConversion({
        sender: event.sender,
        jobId,
        durationSec,
        outputPath,
        startMessage: `Encoding ${sequence.frameCount} frames at ${fps} fps...`,
        completeMessage: 'Image sequence MP4 complete.',
        progressMode: 'frames',
        totalFrames: sequence.frameCount,
        cleanup: () => {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        },
        args: [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-progress', 'pipe:2',
          '-nostats',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
          '-r', String(fps),
          ...commonOutput,
        ],
      });
    }

    const inputPath = assertAbsolutePath(args.inputPath, 'input video path');
    if (!fs.existsSync(inputPath)) throw new Error('Input video not found.');
    publishVideoConverterProgress(event.sender, {
      jobId,
      stage: 'preparing',
      progress: 0,
      message: 'Preparing native FFmpeg encoder...',
      outputPath,
    });
    return spawnFfmpegConversion({
      sender: event.sender,
      jobId,
      durationSec: 0,
      outputPath,
      startMessage: 'Converting WebM to MP4...',
      completeMessage: 'WebM MP4 conversion complete.',
      args: [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-progress', 'pipe:2',
        '-nostats',
        '-fflags', '+genpts',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-avoid_negative_ts', 'make_zero',
        '-max_muxing_queue_size', '1024',
        ...commonOutput,
      ],
    });
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

  // --- Save binary file from structured-cloned bytes ---
  // Frame-sequence export writes thousands of JPEGs; sending Uint8Array bytes
  // avoids the CPU + memory hit of base64 expanding every frame by ~33%.
  ipcMain.handle('save_file_bytes', async (_, args) => {
    try {
      if (!args || typeof args !== 'object') return { success: false, error: 'Invalid arguments' };
      const { path: filePath, bytes } = args;
      if (typeof filePath !== 'string' || !filePath) return { success: false, error: 'Invalid file path' };
      const normalized = path.normalize(filePath);
      if (!path.isAbsolute(normalized) || normalized.includes('..')) {
        return { success: false, error: 'Invalid file path (must be absolute, no traversal)' };
      }

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
      fs.writeFileSync(normalized, buffer);
      return { success: true };
    } catch (err) {
      console.error('[Main] save_file_bytes error:', err?.message || err);
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

  // Native renderer bridge. Electron is the long-term UI shell for 2.0;
  // the render core runs as a separate Rust/wgpu process so a renderer
  // crash does not take the control surface down.
  for (const cmd of nativeRendererCommandNames()) {
    ipcMain.handle(cmd, async (_event, args = {}) => nativeRendererBroker.invoke(cmd, args));
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
      // The editor's render loop drives Spout/NDI/WLED sends and the
      // audio/modulation broadcasts. Chromium suspends rAF in fully
      // occluded windows by default — minimizing the editor (or covering
      // it with another app) mid-show would freeze every editor-driven
      // output. Every other window in this file already disables it.
      backgroundThrottling: false,
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
      message.includes('[NativeRendererSync]') || // native render-core bridge diagnostics
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
    // Close every performer/display pop-out so the app can actually exit.
    closeAuxiliaryWindows();
  });
}

// 3D Stage Designer pop-out window. Loads the Svelte app with
// `?mode=stage-3d` which mounts Stage3DWindowApp.svelte — an off-screen
// layer renderer (Canvas) + the Stage3DDesigner visible UI. State-sync
// over BroadcastChannel keeps the off-screen renderer's layers in
// lockstep with the editor.
//
// The window is resizable (so users can rearrange between monitors),
// frame: true (so they get OS chrome to drag + close), and persists
// across the editor lifetime only: closing the main app window also
// closes this pop-out so it cannot keep Electron alive by itself.
function createStage3DWindow() {
  // Default size: a wide 16:10 that's bigger than typical editor
  // sidebars but doesn't try to fill the whole screen. Users can
  // resize or drag to a second monitor freely.
  const winW = 1400;
  const winH = 900;

  // Place on a second display if one's available — Stage 3D is a
  // performance / preview surface, the main editor wants the primary.
  const allDisplays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = allDisplays.find(d => d.id !== primary.id) || primary;
  const winX = Math.round(target.bounds.x + (target.bounds.width - winW) / 2);
  const winY = Math.round(target.bounds.y + (target.bounds.height - winH) / 2);

  stage3dWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    title: 'Ghost Arcade — 3D Stage Designer',
    resizable: true,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#04060a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      backgroundThrottling: false,
    },
  });
  stage3dWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  const isDev = !app.isPackaged;
  if (isDev) {
    stage3dWindow.loadURL(`${devUrl}?mode=stage-3d`);
  } else {
    stage3dWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      search: 'mode=stage-3d',
    });
  }

  stage3dWindow.on('closed', () => {
    stage3dWindow = null;
  });
  stage3dWindow.on('enter-full-screen', () => publishStage3DFullscreenState(true));
  stage3dWindow.on('leave-full-screen', () => publishStage3DFullscreenState(false));
}

function createProjectionSimWindow() {
  const winW = 1400;
  const winH = 900;

  const allDisplays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = allDisplays.find(d => d.id !== primary.id) || primary;
  const winX = Math.round(target.bounds.x + (target.bounds.width - winW) / 2);
  const winY = Math.round(target.bounds.y + (target.bounds.height - winH) / 2);

  projectionSimWindow = new BrowserWindow({
    width: winW,
    height: winH,
    x: winX,
    y: winY,
    title: 'Ghost Arcade — Projection Simulator',
    resizable: true,
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#05070b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webgl: true,
      backgroundThrottling: false,
    },
  });
  projectionSimWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420';
  const isDev = !app.isPackaged;
  if (isDev) {
    projectionSimWindow.loadURL(`${devUrl}?mode=projection-sim`);
  } else {
    projectionSimWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      search: 'mode=projection-sim',
    });
  }

  projectionSimWindow.on('closed', () => {
    projectionSimWindow = null;
  });
  projectionSimWindow.on('enter-full-screen', () => publishProjectionSimFullscreenState(true));
  projectionSimWindow.on('leave-full-screen', () => publishProjectionSimFullscreenState(false));
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

  const win = new BrowserWindow({
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
  outputWindow = win;

  // Hide menu bar for clean look
  win.setMenuBarVisibility(false);

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
    win.loadURL(`${devUrl}?${queryParts.join('&')}`);
    // Auto-DevTools on output is a debugging convenience but it changes
    // the perf profile measurably (devtools allocates extra GPU surfaces
    // + renderer threads). Opt in via env or a launch arg so smoothness
    // benchmarks match the Pro folder's no-devtools baseline. Set
    // GHOSTARCADE_OUTPUT_DEVTOOLS=1 in the shell that runs `npm run
    // desktop` to enable.
    if (process.env.GHOSTARCADE_OUTPUT_DEVTOOLS === '1') {
      try { win.webContents.openDevTools({ mode: 'detach' }); } catch {}
    }
  } else {
    const filePath = path.join(__dirname, '..', 'dist', 'index.html');
    const fileQuery = { mode: outputMode };
    if (wantWebgpuDisable) fileQuery['webgpu-disable'] = '1';
    win.loadFile(filePath, { query: fileQuery });
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

  win.on('closed', () => {
    if (outputWindow === win) {
      outputWindow = null;
    }
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
  app.setAboutPanelOptions({
    applicationName: 'Ghost Arcade',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright (c) 2024-2026 Risk Capital Media LLC',
    credits: 'NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video/',
  });

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
  if (!isQuitting) {
    event.preventDefault();
    cleanupAndQuit();
    return;
  }

  // Menu/Cmd+Q quits should tear down performer/display pop-outs too.
  closeAuxiliaryWindows();
});

let isQuitting = false;
let hardExitTimer = null;

function scheduleHardExit(delayMs) {
  if (hardExitTimer) return;
  hardExitTimer = setTimeout(() => {
    console.log('[Main] Force exiting after cleanup timeout');
    app.exit(0);
  }, delayMs);
  hardExitTimer.unref?.();
}

function destroyNdiSenders() {
  if (!ndiAddon || ndiSenders.size === 0) return;
  for (const name of Array.from(ndiSenders)) {
    runCleanupStep(`NDI sender ${name}`, () => ndiAddon.destroySender({ name }));
    ndiSenders.delete(name);
  }
}

function destroyNdiReceivers() {
  if (!ndiAddon || ndiReceivers.size === 0) return;
  for (const sourceName of Array.from(ndiReceivers)) {
    runCleanupStep(`NDI receiver ${sourceName}`, () => ndiAddon.destroyReceiver({ sourceName }));
    ndiReceivers.delete(sourceName);
  }
}

function killPluginProcesses() {
  if (typeof plugins === 'undefined' || !plugins || typeof plugins !== 'object') return;

  for (const [name, plugin] of Object.entries(plugins)) {
    const child = plugin?.process;
    if (!child) continue;
    console.log(`[Cleanup] Killing plugin: ${name}`);
    killChildProcess(child, `plugin ${name}`);
    plugin.process = null;
  }
}

function cleanupAndQuit() {
  if (isQuitting) {
    scheduleHardExit(250);
    return;
  }
  isQuitting = true;
  console.log('[Main] Cleaning up before quit...');

  // Schedule first so a stuck native addon/socket teardown cannot keep the
  // single-instance lock alive in Task Manager.
  scheduleHardExit(750);

  runCleanupStep('closeAuxiliaryWindows', closeAuxiliaryWindows);
  runCleanupStep('stopSpoutSender', stopSpoutSender);
  runCleanupStep('stopSpoutReceiver', stopSpoutReceiver);
  runCleanupStep('destroyNdiSenders', destroyNdiSenders);
  runCleanupStep('destroyNdiReceivers', destroyNdiReceivers);
  runCleanupStep('stopNativeRenderer', () => nativeRendererBroker.shutdownSync());
  runCleanupStep('shutdownLink', shutdownLink);
  runCleanupStep('stopOSC', stopOSC);
  runCleanupStep('stopServer', stopServer);
  runCleanupStep('closeAllWledSockets', closeAllWledSockets);
  runCleanupStep('killPluginProcesses', killPluginProcesses);

  app.exit(0);
}
