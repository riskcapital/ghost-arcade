import { describe, expect, it } from 'vitest';
import { CABLE_COLORS, CABLE_LIVE_COLOR, cablePath } from '../music/cableLook';
import { cableColor, liveCable, sourceKind, synthCables, type Point } from './cables';
import { INPUT_JACKS } from './patch';
import { inputJack } from './patching';

/** Every jack on screen, each at its own spot. */
const centers: Record<string, Point> = {};
for (let s = 1; s <= 13; s++) centers[`out:${s}`] = { x: s * 10, y: 20 };
INPUT_JACKS.forEach((j, i) => (centers[`in:${j.id}`] = { x: i * 10, y: 200 }));

const mod = inputJack('AMod')!;
const rotate = inputJack('RotateIn')!;

describe('Analog Synth cables', () => {
  it('draws nothing for a fresh patch: every input is empty or on its normal', () => {
    expect(synthCables({}, centers)).toEqual([]);
  });

  it('draws a patched input as a cable from its source, in that source\'s colour', () => {
    const [c] = synthCables({ vsRotateInSrc: 6 }, centers, { floor: 400 });
    const a = centers['out:6'], b = centers['in:RotateIn'];
    expect(c).toEqual({ id: 'RotateIn', d: cablePath(a.x, a.y, b.x, b.y, 400), color: cableColor(6), ends: [a.x, a.y, b.x, b.y] });
  });

  it('shows normals only when asked, faint and marked', () => {
    expect(synthCables({}, centers, { showNormals: true }).every((c) => c.normal)).toBe(true);
    expect(synthCables({}, centers, { showNormals: true }).map((c) => c.id)).toContain('AMod');
    // A cable that replaces the normal is a real cable.
    expect(synthCables({ vsAModSrc: 9 }, centers, { showNormals: true }).find((c) => c.id === 'AMod')?.normal).toBeUndefined();
  });

  it('leaves out the cable in the hand and any jack not on screen', () => {
    expect(synthCables({ vsRotateInSrc: 6, vsAModSrc: 9 }, centers, { carried: rotate }).map((c) => c.id)).toEqual(['AMod']);
    const { ['in:RotateIn']: _gone, ...rest } = centers;
    expect(synthCables({ vsRotateInSrc: 6 }, rest)).toEqual([]);
    expect(mod.normal).toBeGreaterThan(0);
  });

  it('gives each source one colour from the shared set, and tells pictures from control signals', () => {
    for (let s = 1; s <= 13; s++) expect(CABLE_COLORS).toContain(cableColor(s));
    expect(cableColor(1)).toBe(CABLE_COLORS[0]);
    expect([2, 3, 4, 13].map(sourceKind)).toEqual(['picture', 'picture', 'picture', 'picture']);
    expect([5, 7, 8, 12].map(sourceKind)).toEqual(['control', 'control', 'control', 'control']);
  });

  it('draws the cable in the hand dotted, in the live colour', () => {
    const c = liveCable({ x: 0, y: 0 }, { x: 50, y: 10 }, 300);
    expect(c).toMatchObject({ live: true, color: CABLE_LIVE_COLOR, ends: [0, 0, 50, 10], d: cablePath(0, 0, 50, 10, 300) });
  });
});
