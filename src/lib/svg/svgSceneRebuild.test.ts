import { describe, expect, it } from 'vitest';
import { createDefaultSVGContent, type SVGContent } from '../types';
import { planSvgScene } from './svgSceneRebuild';

const SVG = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const content = (patch: Partial<SVGContent> = {}): SVGContent => ({ ...createDefaultSVGContent(), svgSource: SVG, ...patch });

describe('the preview SVG scene', () => {
  it('builds a new layer once', () => {
    const first = planSvgScene(null, content(), false);
    expect(first).toMatchObject({ parse: true, build: true, empty: false });
    const second = planSvgScene(first.next, content(), false);
    expect(second).toMatchObject({ parse: false, build: false });
  });

  it('rebuilds for a structural change but not for a live one', () => {
    const built = planSvgScene(null, content(), false).next;
    expect(planSvgScene(built, content({ glowEnabled: true }), false)).toMatchObject({ parse: false, build: true });
    expect(planSvgScene(built, content({ rotateSpeedY: 2, panX: 0.3 }), false)).toMatchObject({ parse: false, build: false });
  });

  it('reads the artwork again when it or the size changes', () => {
    const built = planSvgScene(null, content(), false).next;
    expect(planSvgScene(built, content({ svgSource: SVG.replace('1"/>', '0.5"/>') }), false).parse).toBe(true);
    expect(planSvgScene(built, content(), true).parse).toBe(true);
  });

  it('has nothing to draw once the artwork is cleared', () => {
    const built = planSvgScene(null, content(), false).next;
    const cleared = planSvgScene(built, content({ svgSource: '' }), false);
    expect(cleared).toMatchObject({ parse: false, build: false, empty: true });
    // Loading art again builds it.
    expect(planSvgScene(cleared.next, content(), false)).toMatchObject({ parse: true, build: true });
  });
});
