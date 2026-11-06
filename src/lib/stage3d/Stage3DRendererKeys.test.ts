import { describe, expect, it, vi } from 'vitest';
import { Stage3DRenderer } from './Stage3DRenderer';

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
