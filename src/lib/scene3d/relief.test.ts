import { describe, expect, it } from 'vitest';
import { defaultInteractive, validateScene, type InteractiveScene, type InteractiveSurface } from '../mobile/studio/interactive';
import { buildSceneMeshes, VERTEX_FLOATS } from './sceneMeshes';
import type { MeshNode, SceneNode, Vec3 } from './sceneModel';
import { blockDepth, project, reliefFrame, reliefScene, sunDirection } from './relief';
import { pickWorld, rayThrough, wallProjector, worldGeometry } from './worldGeometry';
import { defaultReliefWorld, validateReliefWorld } from './worldModel';

const solid = (id: string, points: { x: number; y: number }[], height = 0.3): InteractiveSurface => ({ id, name: id, behavior: 'solid', points, height });
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const scene = (surfaces: InteractiveSurface[]): InteractiveScene => ({ ...defaultInteractive(), surfaces });
const world = defaultReliefWorld();
const ASPECT = 16 / 9;

function vertices(node: SceneNode): Vec3[] {
  const m = buildSceneMeshes([node], () => 0);
  return Array.from({ length: m.count }, (_, i) => [m.vertices[i * VERTEX_FLOATS], m.vertices[i * VERTEX_FLOATS + 1], m.vertices[i * VERTEX_FLOATS + 2]] as Vec3);
}

describe('the relief world', () => {
  const tri = solid('tri', [{ x: 0.2, y: 0.3 }, { x: 0.45, y: 0.25 }, { x: 0.3, y: 0.7 }], 0.5);
  const s = scene([tri, solid('box', rect(0.6, 0.4, 0.8, 0.9)), { id: 'z', name: 'z', behavior: 'trigger', points: rect(0.1, 0.1, 0.2, 0.2) }]);

  it('fits the wall to the output and lands each block’s front face on its outline', () => {
    const frame = reliefFrame(ASPECT, world.lens);
    // The wall's corners show at the output's corners.
    expect(project(frame, [-frame.W / 2, frame.H / 2, 0])).toEqual({ x: 0, y: 0 });
    const out = reliefScene(s, world, ASPECT);
    const block = out.nodes.find((n) => n.id === 'block:tri')!;
    const d = blockDepth(tri, world, frame);
    const front = vertices(block).filter((v) => Math.abs(v[2] - d) < 1e-6);
    const back = vertices(block).filter((v) => Math.abs(v[2]) < 1e-6);
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    for (const v of front) {
      const p = project(frame, v);
      const near = Math.min(...tri.points.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(near).toBeLessThan(1e-4);
    }
    // Only solids become blocks; the wall faces the camera.
    expect(out.nodes.filter((n) => n.id.startsWith('block:')).map((n) => n.id)).toEqual(['block:tri', 'block:box']);
    const wall = vertices(out.nodes.find((n) => n.id === 'wall')!);
    for (const v of wall) expect(Math.abs(v[2])).toBeLessThan(1e-6);
    expect(out.camera).toMatchObject({ mode: 'free', position: [0, 0, frame.camZ], target: [0, 0, 0] });
  });

  it('makes a light finish catch light only', () => {
    const out = reliefScene(scene([{ ...tri, finish: { preset: 'light', color: '#000000' } }]), world, ASPECT);
    expect((out.nodes.find((n) => n.id === 'block:tri') as SceneNode & MeshNode).catcher).toBe(true);
  });

  it('puts the sun where its angles say', () => {
    const [x, y, z] = sunDirection(-90, 0);
    expect(x).toBeCloseTo(-6);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
    expect(sunDirection(0, 90)[2]).toBeCloseTo(6);
  });

  it('picks the block under a point, its front or its side, else the wall', () => {
    const frame = reliefFrame(ASPECT, world.lens);
    const pick = (w: typeof world, p: { x: number; y: number }) =>
      pickWorld(worldGeometry(s, w, ASPECT), rayThrough(wallProjector(reliefFrame(ASPECT, w.lens)), p));
    const front = pick(world, { x: 0.7, y: 0.6 });
    expect(front.surfaceId).toBe('box');
    expect(front.normal).toEqual([0, 0, 1]);
    expect(front.point[2]).toBeCloseTo(blockDepth(s.surfaces[1], world, frame));
    expect(pick(world, { x: 0.5, y: 0.1 }).surfaceId).toBeNull();
    // Just outside the box's left edge (the side faces the centre), a wide lens
    // sees the side.
    const wide = { ...world, lens: 1, depthScale: 3 };
    const side = pick(wide, { x: 0.598, y: 0.6 });
    expect(side.surfaceId).toBe('box');
    expect(side.normal[0]).toBeCloseTo(-1);
    expect(side.point[2]).toBeGreaterThan(0);
  });
});

describe('the world settings', () => {
  it('fills in defaults and clamps ranges', () => {
    expect(validateReliefWorld({})).toEqual(defaultReliefWorld());
    const w = validateReliefWorld({ lens: 5, sun: { elevation: 0 }, wall: { color: '#ABCDEF' } });
    expect(w.lens).toBe(1);
    expect(w.sun.elevation).toBe(5);
    expect(w.wall.color).toBe('#abcdef');
  });

  it('refuses values of the wrong kind, saying where', () => {
    expect(() => validateReliefWorld({ gravity: 'lots' })).toThrow('World gravity: not a number.');
    expect(() => validateReliefWorld({ flat: 'sideways' })).toThrow('World flat: unknown mode sideways.');
    expect(() => validateReliefWorld({ sun: { color: 'red' } })).toThrow('World sun color');
    expect(() => validateReliefWorld([])).toThrow('World settings: not an object.');
  });

  it('travels with the scene, and a scene without one stays flat', () => {
    const flat = validateScene(defaultInteractive());
    expect(flat.world).toBeUndefined();
    const raw = { ...defaultInteractive(), world: { depthScale: 2 }, surfaces: [{ ...solid('a', rect(0.1, 0.1, 0.3, 0.3)), finish: { preset: 'chrome', color: '#ffffff' } }] };
    const v = validateScene(JSON.parse(JSON.stringify(raw)));
    expect(v.world?.depthScale).toBe(2);
    expect(v.surfaces[0].finish).toEqual({ preset: 'chrome', color: '#ffffff' });
    expect(() => validateScene({ ...raw, surfaces: [{ ...raw.surfaces[0], finish: { preset: 'gold' } }] })).toThrow('unknown finish gold');
  });

  it('keeps a zone’s world actions, and drops ones it does not know', async () => {
    const { validateZoneTrigger } = await import('../mobile/studio/interactive');
    const t = validateZoneTrigger({ rearm: 1, actions: [{ kind: 'world', what: 'ignite' }, { kind: 'world', what: 'nuke' }, { kind: 'world', what: 'balls' }, { kind: 'burst' }] });
    expect(t.actions).toEqual([{ kind: 'world', what: 'ignite' }, { kind: 'world', what: 'balls' }, { kind: 'burst' }]);
  });

  it('keeps what sets a zone off, touch when it says nothing sane', async () => {
    const { validateZoneTrigger } = await import('../mobile/studio/interactive');
    expect(validateZoneTrigger({ rearm: 1, actions: [], when: 'ball' }).when).toBe('ball');
    expect(validateZoneTrigger({ rearm: 1, actions: [], when: 'either' }).when).toBe('either');
    expect('when' in validateZoneTrigger({ rearm: 1, actions: [], when: 'touch' })).toBe(false);
    expect('when' in validateZoneTrigger({ rearm: 1, actions: [], when: 'laser' })).toBe(false);
  });

  it('leaves zones only balls set off alone when touched', async () => {
    const { ZoneTriggers } = await import('../interactive/interactiveRuntime');
    const { defaultInteractive } = await import('../mobile/studio/interactive');
    const zone = (id: string, when?: 'ball' | 'either') => ({
      id, name: id, behavior: 'trigger' as const, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      trigger: { actions: [{ kind: 'burst' as const }], rearm: 1, ...(when ? { when } : {}) },
    });
    const scene = { ...defaultInteractive(), surfaces: [zone('t'), zone('b', 'ball'), zone('e', 'either')] };
    const fired = new ZoneTriggers().update(scene, [{ id: 'p', point: { x: 0.5, y: 0.5 }, strength: 1 }], 0);
    expect(fired.map((f) => f.surfaceId)).toEqual(['t', 'e']);
  });
});
