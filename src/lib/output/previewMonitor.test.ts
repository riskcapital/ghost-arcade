import { describe, expect, it } from 'vitest';
import { fitAspect, maskPath, previewMonitorGeometry, type Rect } from './previewMonitorLayout';
import {
  displayFingerprint,
  findPreviewMonitorDisplay,
  previewMonitorTexture,
  previewMonitorViewName,
} from '../../../electron/preview-monitor.js';

const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
  && inner.x + inner.width <= outer.x + outer.width + 0.5
  && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('Preview monitor layout', () => {
  const screen: Rect = { x: 0, y: 0, width: 1920, height: 1080 };

  it('multiview: the program large on the left, the decks stacked on the right, nothing overlapping', () => {
    const g = previewMonitorGeometry(1920, 1080, 16 / 9, 'multiview', true);
    const { program, 'deck-a': a, 'deck-b': b } = g.tiles;
    expect(program && a && b).toBeTruthy();
    for (const r of [program!, a!, b!, g.status]) expect(inside(r, screen)).toBe(true);
    expect(program!.width).toBeGreaterThan(a!.width * 1.8);
    expect(a!.x).toBeGreaterThan(program!.x + program!.width);
    expect(b!.y).toBeGreaterThan(a!.y + a!.height);
    const all = [program!, a!, b!, g.status, g.labels.program!, g.labels['deck-a']!, g.labels['deck-b']!];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j])).toBe(false);
  });

  it('keeps the output shape in every tile', () => {
    const g = previewMonitorGeometry(1920, 1080, 4 / 3, 'multiview', true);
    for (const t of Object.values(g.tiles)) expect(Math.abs(t!.width / t!.height - 4 / 3)).toBeLessThan(0.02);
    const wide = previewMonitorGeometry(1920, 1200, 32 / 9, 'program', false);
    expect(Math.abs(wide.tiles.program!.width / wide.tiles.program!.height - 32 / 9)).toBeLessThan(0.02);
  });

  it('shows the program alone when asked, or when there are no decks to show', () => {
    for (const g of [previewMonitorGeometry(1920, 1080, 16 / 9, 'program', true), previewMonitorGeometry(1920, 1080, 16 / 9, 'multiview', false)]) {
      expect(Object.keys(g.tiles)).toEqual(['program']);
      expect(g.tiles.program!.width).toBeGreaterThan(1500);
    }
  });

  it('fits a picture centred in its cell', () => {
    expect(fitAspect({ x: 0, y: 0, width: 1000, height: 1000 }, 2)).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
    expect(fitAspect({ x: 0, y: 0, width: 1000, height: 100 }, 2)).toEqual({ x: 400, y: 0, width: 200, height: 100 });
  });

  it('cuts a hole in the mask for each picture', () => {
    expect(maskPath(10, 10, [{ x: 1, y: 2, width: 3, height: 4 }])).toBe('M0 0H10V10H0ZM1 2h3v4h-3Z');
  });
});

describe('Preview monitor display and textures', () => {
  const projector = { id: 2, label: 'EPSON PJ', scaleFactor: 1, bounds: { width: 1920, height: 1080 } };
  const monitor = { id: 3, label: 'DELL U2720Q', scaleFactor: 1.5, bounds: { width: 2560, height: 1440 } };

  it('finds its display by id, or by how it looks once plugged back in under a new id', () => {
    const wanted = { displayId: 3, fingerprint: displayFingerprint(monitor) };
    expect(findPreviewMonitorDisplay([projector, monitor], wanted)?.id).toBe(3);
    const replugged = { ...monitor, id: 9 };
    expect(findPreviewMonitorDisplay([projector, replugged], wanted)?.id).toBe(9);
    expect(findPreviewMonitorDisplay([projector], wanted)).toBe(null);
  });

  it('does not land on another display that took its old id', () => {
    const wanted = { displayId: 2, fingerprint: displayFingerprint(monitor) };
    const replugged = { ...monitor, id: 7 };
    expect(findPreviewMonitorDisplay([projector, replugged], wanted)?.id).toBe(7);
  });

  it('shows the output texture as the program and each bank as its deck', () => {
    const output = { handle: 41, width: 1920, height: 1080, frame: 10 };
    const decks = { banks: [{ bank: 'a', handle: 51, width: 960, height: 540, frame: 3 }, { bank: 'b', handle: 52, width: 960, height: 540, frame: 3 }] };
    expect(previewMonitorTexture('program', { output, decks, windows: false, nativePump: false })?.surfaceId).toBe(41);
    expect(previewMonitorTexture('deck-a', { output, decks, windows: false, nativePump: false })?.surfaceId).toBe(51);
    expect(previewMonitorTexture('deck-b', { output, decks, windows: false, nativePump: false })?.surfaceId).toBe(52);
    expect(previewMonitorTexture('deck-b', { output, decks: { banks: [] }, windows: false, nativePump: false })).toBe(null);
  });

  it('on Windows binds by shared name, once with the vblank pump and per frame without it', () => {
    const output = { shared_name: 'GA_OUT', width: 1920, height: 1080, frame: 10 };
    expect(previewMonitorTexture('program', { output, windows: true, nativePump: true })?.binding).toBe('GA_OUT:1920x1080');
    expect(previewMonitorTexture('program', { output, windows: true, nativePump: false })?.binding).toBe('GA_OUT:1920x1080:10');
    expect(previewMonitorTexture('program', { output: { width: 1920, height: 1080 }, windows: true, nativePump: true })).toBe(null);
  });

  it('names its views apart from the VJ panel deck panes', () => {
    expect(previewMonitorViewName('deck-a')).not.toBe('deck-a');
  });
});
