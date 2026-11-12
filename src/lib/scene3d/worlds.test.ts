import { describe, expect, it } from 'vitest';
import { validateScene3D, type MeshNode, type SceneNode } from './sceneModel';
import { buildSceneMeshes, VERTEX_FLOATS } from './sceneMeshes';
import { buildWorld, floorFrame, fromInteractiveScene, lightAndShadowWorld, WORLDS } from './worlds';
import { INTERACTIVE_STARTERS, starterScene } from '../mobile/studio/interactiveLibrary';
import { defaultInteractive } from '../mobile/studio/interactive';

const square = (x: number, y: number, s = 0.1) => [
  { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
];

describe('worlds', () => {
  it('Light and shadow stands each mapped shape on the floor, where it is in the output', () => {
    const scene = validateScene3D(lightAndShadowWorld([{ name: 'Left', points: square(0.1, 0.2) }], 16 / 9));
    const frame = floorFrame(16 / 9);
    const blockNode = scene.nodes.find((n) => n.name === 'Left') as SceneNode & MeshNode;
    const m = buildSceneMeshes([blockNode], () => 0);
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < m.count; i++) {
      xs.push(m.vertices[i * VERTEX_FLOATS]); ys.push(m.vertices[i * VERTEX_FLOATS + 1]); zs.push(m.vertices[i * VERTEX_FLOATS + 2]);
    }
    // Output x 0.1..0.2 → floor X; output y 0.2..0.3 (top half) → far (-Z); from the floor up.
    expect(Math.min(...xs)).toBeCloseTo((0.1 - 0.5) * frame.width);
    expect(Math.max(...xs)).toBeCloseTo((0.2 - 0.5) * frame.width);
    expect(Math.min(...zs)).toBeCloseTo((0.2 - 0.5) * frame.depth);
    expect(Math.max(...zs)).toBeCloseTo((0.3 - 0.5) * frame.depth);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(0.55);
  });

  it('fits the floor to the picture from a camera straight above', () => {
    const scene = lightAndShadowWorld([], 16 / 9);
    const frame = floorFrame(16 / 9);
    expect(scene.camera.position[1] * Math.tan((scene.camera.fov * Math.PI) / 360) * 2).toBeCloseTo(frame.depth);
    // Three plinths stand in when nothing is mapped.
    expect(scene.nodes.filter((n) => n.kind === 'mesh')).toHaveLength(4);
  });

  it('names what is not ready yet', () => {
    expect(WORLDS.filter((w) => w.ready).map((w) => w.id)).toEqual(['light-and-shadow']);
    expect(() => buildWorld('marbles', [], 1)).toThrow(/arrives with bodies and rules/);
  });

  it('converts every old starter scene into a valid world', () => {
    for (const s of INTERACTIVE_STARTERS) {
      const world = validateScene3D(fromInteractiveScene(starterScene(s.id), 16 / 9));
      expect(world.nodes.length, s.id).toBeGreaterThan(1);
      expect(world.nodes.some((n) => n.kind === 'light' && n.light === 'key'), s.id).toBe(true);
    }
    expect(validateScene3D(fromInteractiveScene(defaultInteractive(), 4 / 3)).nodes.some((n) => n.kind === 'zone')).toBe(true);
  });
});
