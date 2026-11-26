import { describe, expect, it } from 'vitest';
import { createDefaultSVGContent, type SVGContent } from '../types';
import {
  SVG_CACHE_LIMIT,
  advanceSvgSpin,
  buildSvgNativeComputeGraph,
  svgGeometryBuildCount,
} from './svgNative';

const art = (n: number) => `<svg viewBox="0 0 100 100"><rect x="${n}" y="10" width="30" height="30" fill="#0f0"/></svg>`;

function content(source: string, patch: Partial<SVGContent> = {}): SVGContent {
  return { ...createDefaultSVGContent(), renderMode: 'flat', svgSource: source, ...patch };
}

function build(source: string, extra: Record<string, unknown> = {}, patch: Partial<SVGContent> = {}) {
  return buildSvgNativeComputeGraph({
    sourceId: 'cache-test',
    content: content(source, patch),
    width: 320,
    height: 180,
    time: 2,
    frameIndex: 1,
    ...extra,
  } as Parameters<typeof buildSvgNativeComputeGraph>[0]);
}

const rawBuffer = (graph: ReturnType<typeof build>) =>
  graph.config.buffers.find((b) => String(b.id).endsWith(':raw')) as { clear?: boolean; initial_f32?: number[] };

describe('SVG geometry cache', () => {
  it('packs each artwork once while two SVG layers draw every frame', () => {
    const a = art(1001);
    const b = art(1002);
    build(a);
    build(b);
    const before = svgGeometryBuildCount();
    for (let frame = 0; frame < 20; frame += 1) {
      build(a);
      build(b);
    }
    expect(svgGeometryBuildCount()).toBe(before);
  });

  it('keeps at most a bounded number of artworks', () => {
    for (let i = 0; i < SVG_CACHE_LIMIT + 5; i += 1) build(art(2000 + i));
    const before = svgGeometryBuildCount();
    build(art(2000)); // evicted: oldest
    expect(svgGeometryBuildCount()).toBe(before + 1);
    build(art(2000 + SVG_CACHE_LIMIT + 4)); // newest: still cached
    expect(svgGeometryBuildCount()).toBe(before + 1);
  });
});

describe('SVG geometry upload', () => {
  it('sends the points until the caller has them, then stops', () => {
    const first = build(art(3000));
    expect(rawBuffer(first).clear).toBe(true);
    expect(rawBuffer(first).initial_f32?.length).toBeGreaterThan(0);
    const next = build(art(3000), { uploadedGeometrySignature: first.geometrySignature });
    expect(rawBuffer(next).clear).toBe(false);
    expect(rawBuffer(next).initial_f32).toBeUndefined();
  });

  it('sends them again once the core has dropped them (restart, layer hidden)', () => {
    const first = build(art(3001));
    // The sync forgets the upload ('') when the core frees the buffers.
    const again = build(art(3001), { uploadedGeometrySignature: '' });
    expect(rawBuffer(again).clear).toBe(true);
    expect(rawBuffer(again).initial_f32?.length).toBeGreaterThan(0);
    expect(again.geometrySignature).toBe(first.geometrySignature);
  });

  it('sends a changed artwork', () => {
    const first = build(art(3002));
    const changed = build(art(3003), { uploadedGeometrySignature: first.geometrySignature });
    expect(rawBuffer(changed).clear).toBe(true);
  });
});

describe('SVG 3D auto-spin', () => {
  const extrude = (rotateSpeedY: number) => ({ renderMode: 'extrude' as const, rotateSpeedX: 0, rotateSpeedY, rotateSpeedZ: 0 });

  it('turns by speed * dt', () => {
    let spin = advanceSvgSpin(null, extrude(0.5), 0.1);
    spin = advanceSvgSpin(spin, extrude(0.5), 0.1);
    expect(spin.y).toBeCloseTo(0.1);
  });

  it('carries on from where it is when the speed changes, instead of snapping', () => {
    let spin = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60; i += 1) spin = advanceSvgSpin(spin, extrude(0.5), 1 / 60);
    const before = spin.y;
    spin = advanceSvgSpin(spin, extrude(3), 1 / 60);
    expect(spin.y - before).toBeCloseTo(3 / 60);
  });

  it('holds still outside 3D and ignores a clock jump', () => {
    const spin = { x: 0, y: 1, z: 0 };
    expect(advanceSvgSpin(spin, { ...extrude(1), renderMode: 'flat' }, 1 / 60)).toEqual(spin);
    expect(advanceSvgSpin(spin, extrude(1), 30).y).toBeCloseTo(1.1);
  });

  it('draws the angle it is given', () => {
    const graph = build(art(4000), { spin: { x: 0, y: 0.75, z: 0 } }, { renderMode: 'extrude', rotateY: 0, rotateSpeedY: 9 });
    const header = graph.config.buffers[0].initial_f32 as number[];
    expect(header[81]).toBeCloseTo(0.75); // h20.y = rotation about Y
  });
});

describe('SVG bloom', () => {
  it('lifts pixels above the threshold, not below it', async () => {
    const { SVG_NATIVE_WGSL } = await import('./svgNative');
    const line = SVG_NATIVE_WGSL.split('\n').find((l) => l.includes('let bloom='))!;
    expect(line).toContain('*smoothstep(svg.h9.z,1.0,');
    expect(line).not.toContain('1.0-smoothstep(svg.h9.z');
  });
});
