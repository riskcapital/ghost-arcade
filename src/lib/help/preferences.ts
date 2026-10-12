import { writable } from 'svelte/store';

const key = 'ghostarcade-tooltips-enabled';
let initial = true;
try { initial = localStorage.getItem(key) !== 'false'; } catch { /* Storage may be unavailable. */ }
export const tooltipsEnabled = writable(initial);
tooltipsEnabled.subscribe(enabled => {
  try { localStorage.setItem(key, String(enabled)); } catch { /* Keep the session preference. */ }
});
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === key) tooltipsEnabled.set(event.newValue !== 'false');
  });
}
