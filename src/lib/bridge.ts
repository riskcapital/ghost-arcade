/**
 * Platform Bridge — Electron IPC wrapper
 *
 * Provides a single `invoke()` function for IPC calls to the Electron main process.
 * Frontend code uses: import { invoke, isDesktopApp } from '$lib/bridge';
 */

declare global {
  interface Window {
    __ELECTRON__?: boolean;
    __SPOUT_OSR_MODE__?: boolean;
    __TAURI_INTERNALS__?: unknown;
    electronAPI?: {
      invoke: (command: string, args?: any) => Promise<any>;
      platform: string;
    };
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
