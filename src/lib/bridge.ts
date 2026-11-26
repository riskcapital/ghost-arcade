/**
 * Platform Bridge — Electron IPC wrapper
 *
 * Provides a single `invoke()` function for IPC calls to the Electron main process.
 * Frontend code uses: import { invoke, isDesktopApp } from '$lib/bridge';
 */

/** The NDI addon surface the preload exposes as `window.ghostNDI` (absent outside Electron / without the addon). */
export interface GhostNdiBridge {
  available: () => Promise<any>;
  findSources: () => Promise<any>;
  createReceiver: (name: string) => Promise<any>;
  destroyReceiver: (name: string) => Promise<any>;
  receiveFrame: (name: string) => Promise<any>;
  receiveTextureInfo: (name: string) => Promise<any>;
  outputStatus?: () => Promise<any>;
  outputStart?: (options: { name: string }) => Promise<unknown>;
  outputStop?: () => Promise<unknown>;
}

declare global {
  interface Window {
    __ELECTRON__?: boolean;
    __SPOUT_OSR_MODE__?: boolean;
    __TAURI_INTERNALS__?: unknown;
    electronAPI?: {
      invoke: (command: string, args?: any) => Promise<any>;
      on?: (channel: string, callback: (...args: any[]) => void) => (() => void);
      getPathForFile?: (file: File) => string;
      platform: string;
    };
    ghostNDI?: GhostNdiBridge;
    electronOSR?: {
      onOsrStatus: (callback: (data: { active: boolean; reason?: string; cpuFallbackAllowed?: boolean }) => void) => (() => void) | void;
    };
  }
}

/**
 * Runtime detection — module-level constants for use in onMount() guards and reactive blocks.
 * The invoke() function also checks window.__ELECTRON__ at call time for safety.
 */
export const isElectron = typeof window !== 'undefined' && !!window.__ELECTRON__;
export const isDesktopApp = isElectron;
export const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';
export const isWindows = typeof window !== 'undefined' && (!window.electronAPI || window.electronAPI?.platform === 'win32');
export const isLinux = typeof window !== 'undefined' && window.electronAPI?.platform === 'linux';

/** Returns "Syphon" on macOS, "Spout" on Windows */
export function getTextureShareLabel(): string {
  return isMac ? 'Syphon' : 'Spout';
}
/** True when running inside the hidden OSR window (no UI, no Spout send/receive) */
export const isOsrMode = typeof window !== 'undefined' && !!window.__SPOUT_OSR_MODE__;
/** True when running inside the visible output window (canvas only, state receiver) */
export const isOutputMode = typeof window !== 'undefined' && !!((window as any).__OUTPUT_WINDOW_MODE__);

/**
 * Unified invoke — routes IPC calls to the Electron main process.
 *
 * Usage:
 *   const senders = await invoke<string[]>('spout_list_senders');
 *   await invoke('fluidgen_command', { command: json });
 */
export async function invoke<T = any>(command: string, args?: Record<string, any>): Promise<T> {
  if (window.__ELECTRON__ && window.electronAPI) {
    return window.electronAPI.invoke(command, args) as Promise<T>;
  }
  throw new Error(`invoke('${command}') called but Electron runtime not available`);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (typeof window === 'undefined') return;

  if (window.__ELECTRON__ && window.electronAPI) {
    try {
      const result = await window.electronAPI.invoke('open_external_url', { url });
      if (result?.success) return;
    } catch (err) {
      console.warn('[Bridge] open_external_url failed, falling back to window.open', err);
    }
  }

  window.open(url, '_blank', 'noopener');
}

/** The NDI addon bridge, or null when it is not present (non-Electron build, or no addon). */
export function getNdiBridge(): GhostNdiBridge | null {
  return typeof window !== 'undefined' ? window.ghostNDI ?? null : null;
}

/** Loosely typed preload API (`any`, as the call sites that probe optional or newer channels always had it). */
export type ElectronApiLoose = any;

/**
 * The preload API exactly as `window.electronAPI` exposes it (no `__ELECTRON__` check), or null when absent.
 * Looks at `window` when there is one, else `globalThis`, so non-DOM test environments still work.
 */
export function getRawElectronApi(): ElectronApiLoose | null {
  const host = (typeof window !== 'undefined' ? window : globalThis) as { electronAPI?: ElectronApiLoose };
  return host.electronAPI ?? null;
}

/** The raw Electron preload API, or null when not running in Electron. */
export function getElectronApi(): NonNullable<Window['electronAPI']> | null {
  return isElectron && typeof window !== 'undefined' ? window.electronAPI ?? null : null;
}

/**
 * Subscribe to a main-process event channel. Returns the unsubscribe function,
 * or undefined when the preload does not expose `on` (non-Electron).
 */
export function onElectronEvent(channel: string, callback: (...args: any[]) => void): (() => void) | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.electronAPI?.on?.(channel, callback);
}

/** True when the preload exposes both `invoke` and `on` (needed for progress-reporting native jobs). */
export function hasElectronEventApi(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.invoke && !!window.electronAPI?.on;
}

/** Absolute disk path for a dropped File (Electron only); '' when unavailable. */
export function getPathForFile(file: File): string {
  return (typeof window !== 'undefined' ? window.electronAPI?.getPathForFile?.(file) : '') || '';
}
