/** m:ss.d, the show tray's precise time readout. */
export function formatPrecise(t: number): string {
  const safe = Math.max(0, t);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const d = Math.floor((safe % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** Round a pixel position to the device pixel grid, where layout would
 *  have snapped it, so a transformed element lands where `left` put it. */
export function devicePixel(x: number, dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  return Math.round(x * dpr) / dpr;
}
