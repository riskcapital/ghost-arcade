/**
 * Whether a file's text is an SVG the layer can show. Used before a dropped
 * or chosen file replaces the layer's artwork, so a broken file says so
 * instead of silently leaving a blank layer.
 */
export function isUsableSvgSource(text: string): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!/<svg[\s>]/i.test(trimmed)) return false;
  if (typeof DOMParser === 'undefined') return true;
  try {
    const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return false;
    return doc.documentElement?.localName?.toLowerCase() === 'svg';
  } catch {
    return false;
  }
}
