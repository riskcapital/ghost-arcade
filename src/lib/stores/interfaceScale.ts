import { writable } from 'svelte/store';
import { invoke, isDesktopApp } from '../bridge';

/** Sizes are relative to the app's own 100%, which the desktop shell draws at 90% of the system's (electron/main.js). */
const key = 'ghostarcade-interface-scale-v2';
/** Where a size was kept when 100% meant the system's 100%. */
const oldKey = 'ghostarcade-interface-scale';
export const INTERFACE_SIZES = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** A size saved on the old scale as the nearest size that looks the same now (old 90% is 100%). */
export function migrateInterfaceScale(old: unknown): InterfaceScale {
  const was = normalizeInterfaceScale(old);
  if (was === 'auto') return 'auto';
  const same = was / 0.9;
  return INTERFACE_SIZES.reduce((best, size) => (Math.abs(size - same) < Math.abs(best - same) ? size : best), INTERFACE_SIZES[0] as number);
}

/** A size picked in Settings, or Auto: the editor fits itself to the window (electron/main.js). */
export type InterfaceScale = number | 'auto';

/** A saved size, checked. Nothing saved (or something unreadable) is Auto. */
export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  if (value === 'auto' || value === null || value === undefined || value === '') return 'auto';
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? Math.max(0.75, Math.min(2, scale)) : 'auto';
}
let initial: InterfaceScale = 'auto';
try {
  const saved = localStorage.getItem(key);
  initial = saved === null ? migrateInterfaceScale(localStorage.getItem(oldKey)) : normalizeInterfaceScale(saved);
} catch { /* optional storage */ }
export const interfaceScale = writable<InterfaceScale>(initial);

/** Only the main editor starts this subscription; output pixels remain unchanged. */
export function startInterfaceScale(): () => void {
  if (!isDesktopApp) return () => {};
  return interfaceScale.subscribe(value => {
    const scale = normalizeInterfaceScale(value);
    try { localStorage.setItem(key, String(scale)); } catch { /* session preference still works */ }
    void invoke('set_interface_scale', { scale }).catch(error => console.warn('[Interface scale]', error));
  });
}
