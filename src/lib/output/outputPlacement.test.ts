/**
 * Output and Screen window placement in the main process
 * (electron/output-placement.cjs): staged placements are per window and used
 * once, and window bounds stay on the display they were meant for.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPendingWindowConfigs, outputWindowBounds, firstExternalDisplay } = require('../../../electron/output-placement.cjs');

const primary = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } };
const projector = { id: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } };

describe('createPendingWindowConfigs', () => {
  it('hands each window its own placement', () => {
    const pending = createPendingWindowConfigs();
    pending.stage({ name: 'ga-output-a', displayId: 2, fullscreen: true });
    pending.stage({ name: 'ga-slice-left-b', displayId: 3, fullscreen: true });
    expect(pending.take('ga-slice-left-b')).toMatchObject({ displayId: 3 });
    expect(pending.take('ga-output-a')).toMatchObject({ displayId: 2 });
  });

  it('uses a placement once', () => {
    const pending = createPendingWindowConfigs();
    pending.stage({ name: 'ga-output-a', displayId: 2 });
    expect(pending.take('ga-output-a')).not.toBeNull();
    expect(pending.take('ga-output-a')).toBeNull();
  });

  it('gives an unnamed placement only to a window nobody named one for', () => {
    const pending = createPendingWindowConfigs();
    pending.stage({ displayId: 2 });
    pending.stage({ name: 'ga-output-a', displayId: 3 });
    expect(pending.take('ga-output-a')).toMatchObject({ displayId: 3 });
    expect(pending.take('other')).toMatchObject({ displayId: 2 });
  });

  it('drops placements nobody opened a window for', () => {
    let now = 0;
    const pending = createPendingWindowConfigs({ ttlMs: 1000, now: () => now });
    pending.stage({ name: 'ga-output-a', displayId: 2 });
    now = 1500;
    expect(pending.take('ga-output-a')).toBeNull();
    expect(pending.size).toBe(0);
  });
});

describe('outputWindowBounds', () => {
  it('covers the whole display when fullscreen', () => {
    expect(outputWindowBounds(projector, { fullscreen: true })).toEqual(projector.bounds);
  });

  it('keeps a requested position that is on the display', () => {
    expect(outputWindowBounds(projector, { width: 1280, height: 720, x: 1600, y: 100 }))
      .toEqual({ x: 1600, y: 100, width: 1280, height: 720 });
  });

  it('centres the window when the requested position is on another display', () => {
    expect(outputWindowBounds(projector, { width: 1280, height: 720, x: 0, y: 0 }))
      .toEqual({ x: 1512 + 320, y: 180, width: 1280, height: 720 });
  });

  it('never makes a window larger than its display', () => {
    const b = outputWindowBounds(primary, { width: 4000, height: 3000 });
    expect(b.width).toBe(1512);
    expect(b.height).toBe(982);
  });
});

describe('firstExternalDisplay', () => {
  it('is the first display that is not the main one, or null', () => {
    expect(firstExternalDisplay([primary, projector], primary)).toBe(projector);
    expect(firstExternalDisplay([primary], primary)).toBeNull();
  });
});
