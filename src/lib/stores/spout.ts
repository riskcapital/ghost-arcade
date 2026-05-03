/**
 * Spout Store — Manages Spout sender detection globally.
 *
 * The scanner runs whenever we're in a desktop app (Tauri or Electron),
 * regardless of which panel is open. MediaTray subscribes to the store
 * to display available senders.
 */

import { writable } from 'svelte/store';
import { invoke, isDesktopApp } from '$lib/bridge';

/** List of currently available Spout senders */
export const spoutSenders = writable<string[]>([]);

let scanInterval: ReturnType<typeof setInterval> | null = null;
let scanning = false;

/**
 * Scan for Spout senders via native bridge (Tauri or Electron IPC).
 */
export async function scanSpoutSenders() {
  // Check at call time — isDesktopApp const may be false if bridge loaded before preload
  const isDesktop = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__);

  if (!isDesktop) return;

  try {
    const senders = await invoke<string[]>('spout_list_senders');
    spoutSenders.set(senders || []);
  } catch (err) {
    console.warn('[Spout] Scan failed:', err);
    spoutSenders.set([]);
  }
}

/**
 * Start the periodic Spout sender scanner.
 * Safe to call multiple times — only one interval is created.
 */
export function startSpoutScanner() {
  if (scanning) return;

  const isDesktop = isDesktopApp || (typeof window !== 'undefined' && !!window.__ELECTRON__);
  if (!isDesktop) return;

  scanning = true;
  console.log('[Spout] Starting sender scanner');

  // Scan immediately
  scanSpoutSenders();

  // Then every 5 seconds
  scanInterval = setInterval(scanSpoutSenders, 5000);
}

/**
 * Stop the periodic scanner.
 */
export function stopSpoutScanner() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  scanning = false;
}
