/**
 * What the Render to video dialog offers for the show that is open: how much
 * of it to render (the whole show, or the in/out work area when one is set)
 * and what it should say honestly about the content in it.
 */
import type { Layer } from '../types';

export interface RenderRange {
  start: number;
  seconds: number;
}

export interface RenderRanges {
  /** The whole show (null: nothing on it, the dialog keeps its own length). */
  show: RenderRange | null;
  /** The in/out points, when set. */
  area: RenderRange | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function renderRanges(show: { duration: number; workArea: { start: number; end: number } | null }, hasContent: boolean): RenderRanges {
  const whole = hasContent && show.duration > 0 ? { start: 0, seconds: round(Math.max(0.5, show.duration)) } : null;
  const wa = show.workArea;
  const area = wa && wa.end - wa.start >= 0.1 ? { start: round(Math.max(0, wa.start)), seconds: round(wa.end - Math.max(0, wa.start)) } : null;
  return { show: whole, area };
}

/** An Interactive Studio world (balls, fire, paint, particles) on a visible layer. */
export function isInteractiveLayer(layer: Layer): boolean {
  const effect = layer.source?.effectSource;
  return layer.type === 'interactive' || effect?.effectType === 'performer-world' || !!effect?.interactiveScene;
}

/** A three.js or p5.js page as a layer's content. */
export function isScriptPageLayer(layer: Layer): boolean {
  const type = layer.source?.type as string | undefined;
  return type === 'threejs' || type === 'p5js' || type === 'javascript' || !!(layer as { jsAnimation?: unknown }).jsAnimation;
}

/** A page that asks to keep its own clock in a render (js-source-page.js wantsLiveClock). */
export function pageKeepsOwnClock(html: string | null | undefined): boolean {
  return /<meta\b[^>]*\bname\s*=\s*["']ghost-arcade-clock["'][^>]*\bcontent\s*=\s*["']live["']/i.test(String(html ?? ''));
}

export interface RenderNotes {
  interactive: boolean;
  /** A visible three.js / p5.js page keeps its own clock (it asked to): it is not rendered frame by frame. */
  scriptPages: boolean;
}

export function renderNotes(layers: readonly Layer[]): RenderNotes {
  const visible = layers.filter((l) => l.visible !== false);
  const ownClock = (l: Layer) => isScriptPageLayer(l) && pageKeepsOwnClock((l.source as { jsAnimation?: { htmlCode?: string } } | undefined)?.jsAnimation?.htmlCode ?? (l as { jsAnimation?: { htmlCode?: string } }).jsAnimation?.htmlCode);
  return { interactive: visible.some(isInteractiveLayer), scriptPages: visible.some(ownClock) };
}

/** "1:05" / "1:05.5" for a range label. */
export function clockLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.abs(s - Math.round(s)) < 0.05;
  return `${m}:${whole ? String(Math.round(s)).padStart(2, '0') : s.toFixed(1).padStart(4, '0')}`;
}
