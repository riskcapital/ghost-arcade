import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Stage3DRenderer, captureSourceCrop } from './Stage3DRenderer';

/** Just enough of the renderer for its window key handler. */
function keyTarget(lastRenderAt: number, connected = true): any {
  const r: any = Object.create(Stage3DRenderer.prototype);
  r.canvas = { isConnected: connected };
  r.lastRenderAt = lastRenderAt;
  r.deleteSelection = vi.fn();
  r.duplicateSelection = vi.fn();
  r.setGizmoMode = vi.fn();
  r.selectNode = vi.fn();
  return r;
}

const key = (k: string) => ({ key: k, target: null, preventDefault: () => {} }) as unknown as KeyboardEvent;

describe('Stage 3D shortcuts', () => {
  it('act while the stage view is drawing', () => {
    const r = keyTarget(performance.now());
    r.onKeyDown(key('Delete'));
    r.onKeyDown(key('d'));
    expect(r.deleteSelection).toHaveBeenCalledTimes(1);
    expect(r.duplicateSelection).toHaveBeenCalledTimes(1);
  });

  it('do nothing once the view has closed (no recent render)', () => {
    const r = keyTarget(performance.now() - 5000);
    r.onKeyDown(key('Delete'));
    r.onKeyDown(key('Backspace'));
    r.onKeyDown(key('d'));
    r.onKeyDown(key('w'));
    expect(r.deleteSelection).not.toHaveBeenCalled();
    expect(r.duplicateSelection).not.toHaveBeenCalled();
    expect(r.setGizmoMode).not.toHaveBeenCalled();
  });

  it('do nothing before the first render or with the canvas removed', () => {
    const never = keyTarget(Number.NEGATIVE_INFINITY);
    never.onKeyDown(key('Delete'));
    expect(never.deleteSelection).not.toHaveBeenCalled();

    const detached = keyTarget(performance.now(), false);
    detached.onKeyDown(key('Delete'));
    expect(detached.deleteSelection).not.toHaveBeenCalled();
  });
});

/** Renderer stub with the pieces the Space hand tool touches. */
function handTarget(): any {
  const r = keyTarget(performance.now());
  r.canvas.style = { cursor: '' };
  r.controls = { mouseButtons: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN } };
  r.transformControls = { enabled: true };
  r.spacePan = false;
  r.spacePanPointerUpCleanup = null;
  return r;
}

const spaceEvent = (extra: Record<string, unknown> = {}) => {
  const e = { key: ' ', code: 'Space', target: null, repeat: false, preventDefault: vi.fn(), ...extra };
  return e as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };
};

describe('Stage 3D Space hand tool', () => {
  it('holding Space turns a left drag into a screen pan and back', () => {
    const r = handTarget();
    const down = spaceEvent();
    r.onKeyDown(down);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(r.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
    expect(r.transformControls.enabled).toBe(false);
    expect(r.canvas.style.cursor).toBe('grab');
    // Key repeat while held changes nothing.
    r.onKeyDown(spaceEvent({ repeat: true }));
    expect(r.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);

    r.onKeyUp(spaceEvent());
    expect(r.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(r.transformControls.enabled).toBe(true);
    expect(r.canvas.style.cursor).toBe('');
  });

  it('leaves Space alone while typing or with a modifier held', () => {
    const r = handTarget();
    r.onKeyDown(spaceEvent({ target: { tagName: 'INPUT' } }));
    r.onKeyDown(spaceEvent({ metaKey: true }));
    expect(r.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(r.spacePan).toBe(false);
  });

  it('does nothing once the stage view has closed', () => {
    const r = handTarget();
    r.lastRenderAt = performance.now() - 5000;
    r.onKeyDown(spaceEvent());
    expect(r.spacePan).toBe(false);
  });
});

describe('Stage capture crop', () => {
  it('takes the whole backing store when the view already has the frame aspect', () => {
    expect(captureSourceCrop(1920, 1080, 1600, 900, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('crops the sides of a wider view instead of squeezing it', () => {
    // 2.0 view into a 16:9 file: keep the centre 16:9 of what is shown.
    const crop = captureSourceCrop(1920, 1080, 2000, 1000, 1920, 1080);
    expect(crop.h).toBe(1080);
    expect(crop.w).toBeCloseTo(1920 * (16 / 9) / 2, 6);
    expect(crop.x).toBeCloseTo((1920 - crop.w) / 2, 6);
  });

  it('crops top and bottom of a taller view instead of stretching it', () => {
    // 1400×868 window (≈1.61) into 16:9.
    const crop = captureSourceCrop(1920, 1080, 1400, 868, 1920, 1080);
    expect(crop.w).toBe(1920);
    expect(crop.h).toBeCloseTo(1080 * (1400 / 868) / (16 / 9), 6);
    expect(crop.y).toBeCloseTo((1080 - crop.h) / 2, 6);
  });
});
