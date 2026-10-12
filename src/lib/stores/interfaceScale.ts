import { writable } from 'svelte/store';
import { invoke, isDesktopApp } from '../bridge';

const key = 'ghostarcade-interface-scale';
export function normalizeInterfaceScale(value: unknown): number {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? Math.max(0.75, Math.min(2, scale)) : 1;
}
let initial = 1;
try { initial = normalizeInterfaceScale(localStorage.getItem(key)); } catch { /* optional storage */ }
export const interfaceScale = writable(initial);

/** Only the main editor starts this subscription; output pixels remain unchanged. */
export function startInterfaceScale(): () => void {
  if (!isDesktopApp) return () => {};
  return interfaceScale.subscribe(value => {
    const scale = normalizeInterfaceScale(value);
    try { localStorage.setItem(key, String(scale)); } catch { /* session preference still works */ }
    void invoke('set_interface_scale', { scale }).catch(error => console.warn('[Interface scale]', error));
  });
}
