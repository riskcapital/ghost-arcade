import { writable } from 'svelte/store';
import { invoke, isDesktopApp } from '../bridge';

const key = 'ghostarcade-interface-scale';

/** A size picked in Settings, or Auto: the editor fits itself to the window (electron/main.js). */
export type InterfaceScale = number | 'auto';

/** A saved size, checked. Nothing saved (or something unreadable) is Auto. */
export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  if (value === 'auto' || value === null || value === undefined || value === '') return 'auto';
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? Math.max(0.75, Math.min(2, scale)) : 'auto';
}
let initial: InterfaceScale = 'auto';
try { initial = normalizeInterfaceScale(localStorage.getItem(key)); } catch { /* optional storage */ }
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
