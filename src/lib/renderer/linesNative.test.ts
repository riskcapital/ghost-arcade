import { describe, it, expect } from 'vitest';
import { buildLinesNativeComputeGraph } from './linesNative';
import { createDefaultLinesContent, createDefaultPointClickLine, createLineElement } from '../lines/types';

const HEADER_VEC4S = 7;

function packFirst(stroke: any) {
  const el = createLineElement(createDefaultPointClickLine([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]));
  el.stroke = stroke;
  const content = { ...createDefaultLinesContent(), elements: [el] };
  const graph = buildLinesNativeComputeGraph({ content, width: 1000, height: 500, time: 0 } as any);
  const data = graph.config.buffers[0].initial_f32 as number[];
  const e = HEADER_VEC4S * 4;
  return { p: data.slice(e + 8, e + 16), totalLen: data[e + 26] };
}

describe('native lines dashed / dotted', () => {
  it('reads Dash / Gap in the panel units (tenths of the line), not pixels', () => {
    const { p, totalLen } = packFirst({ type: 'dashed', color: [1, 1, 1, 1], width: 3, dashLength: 0.3, gapLength: 0.2, animated: true, animationSpeed: 1 });
    expect(totalLen).toBeCloseTo(1000);
    expect(p[0]).toBeCloseTo(30);   // 0.3 × 1000 px / 10
    expect(p[1]).toBeCloseTo(20);
    // Animated speed 1 scrolls a tenth of the line per second, as in WebGL.
    expect(p[3]).toBeCloseTo(100);
  });

  it('dotted packs dot length and dot-to-dot period in pixels', () => {
    const { p } = packFirst({ type: 'dotted', color: [1, 1, 1, 1], width: 3, dotSize: 0.1, spacing: 0.15, animated: false, animationSpeed: 1 });
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(25);
  });
});
