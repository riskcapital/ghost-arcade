/**
 * webgpuShared — singleton WebGPU adapter + device for the whole
 * renderer process.
 *
 * Multiple subsystems need WebGPU now:
 *   - WebGPUCanvas (the bridge presenter)
 *   - WebGPUStrokeParticles + AdvLightPaint + PaintDrip (compute renderers)
 *   - WebGPUPixelParticles (per-layer)
 *   - GPU effect runner (per-layer effects like fluid sim)
 *
 * Sharing a single GPUDevice across all of them lets them swap
 * textures + buffers without going through the CPU. It also avoids
 * paying the (slow) device-creation cost N times.
 *
 * Init is async (requestAdapter + requestDevice are awaitable).
 * `ensureWebGPUDevice()` is the entry point — it dedupes concurrent
 * callers via a stored init promise, so 5 subsystems calling it on
 * boot all wait for the same single init.
 */

import { buildGhostGpuCaps, type GhostGpuCaps } from './gpuCaps';
import { WebGhostGpuRuntime, type GhostGpuRuntime } from './gpuRuntime';

let _device: any = null;
let _adapter: any = null;
let _format: string = 'bgra8unorm';
let _caps: GhostGpuCaps | null = null;
let _runtime: GhostGpuRuntime | null = null;
let _initPromise: Promise<{ device: any; adapter: any; presentFormat: string; caps: GhostGpuCaps; runtime: GhostGpuRuntime }> | null = null;
let _disposed = false;

/** Lazy-init the WebGPU device (idempotent, safe to call from
 *  multiple subsystems on boot). Returns the same device on every
 *  subsequent call. */
export async function ensureWebGPUDevice(): Promise<{ device: any; adapter: any; presentFormat: string; caps: GhostGpuCaps; runtime: GhostGpuRuntime }> {
  if (_device && !_disposed && _caps && _runtime) {
    return { device: _device, adapter: _adapter, presentFormat: _format, caps: _caps, runtime: _runtime };
  }
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      throw new Error('WebGPU not available in this environment');
    }
    const gpu = (navigator as any).gpu;
    _adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!_adapter) throw new Error('GPUAdapter request returned null');
    _device = await _adapter.requestDevice();
    _format = gpu.getPreferredCanvasFormat();
    _caps = buildGhostGpuCaps(_adapter, _device, _format);
    _runtime = new WebGhostGpuRuntime(_device, _caps);
    _disposed = false;
    // When the device is dropped (HMR, OS GPU reset), wipe state so
    // the next ensureWebGPUDevice() rebuilds cleanly.
    _device.lost.then((info: any) => {
      console.warn('[webgpuShared] device lost:', info?.message || info);
      _disposed = true;
      _device = null;
      _adapter = null;
      _caps = null;
      try { _runtime?.dispose(); } catch { /* */ }
      _runtime = null;
      _initPromise = null;
    });
    console.log(`[webgpuShared] device created (${_caps.quality.label}: ${_caps.description})`);
    return { device: _device, adapter: _adapter, presentFormat: _format, caps: _caps, runtime: _runtime };
  })();
  return _initPromise;
}

/** Synchronous accessor — returns null if device hasn't been
 *  initialised yet. Use ensureWebGPUDevice() to await init. */
export function getWebGPUDevice(): any | null { return _device; }
export function getWebGPUAdapter(): any | null { return _adapter; }
export function getWebGPUCaps(): GhostGpuCaps | null { return _caps; }
export function getGhostGpuRuntime(): GhostGpuRuntime | null { return _runtime; }
export function getPreferredCanvasFormat(): string { return _format; }
export function isWebGPUReady(): boolean { return !!_device && !_disposed; }
