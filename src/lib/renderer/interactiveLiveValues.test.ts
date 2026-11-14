/**
 * Live input on an Interactive layer (touches, tracked points, the Orbit
 * view, throws and pours) is worked out on its own, from the installed
 * build, instead of rebuilding the whole graph every frame it moves.
 */
import { describe, expect, it } from 'vitest';
import { buildInteractiveGraph, type InteractiveGraphBuildResult, type InteractiveLiveInput } from './nativeInteractiveGraph';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { defaultReliefWorld, type ReliefWorld } from '../scene3d/worldModel';
import { facePoint, type Room, type RoomFace } from '../scene3d/roomModel';
import { projectPoint, worldGeometry } from '../scene3d/worldGeometry';

const audio = { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 };
const build = (scene: InteractiveScene, live: InteractiveLiveInput = {}): InteractiveGraphBuildResult =>
  buildInteractiveGraph({
    kind: 'performer-world', sourceId: 'layer-1', params: { interactiveScene: scene, ...live },
    width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio, state: null, reset: false,
  } as Parameters<typeof buildInteractiveGraph>[0]);

const block = { id: 'b', name: 'Block', behavior: 'trigger' as const, points: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.3, y: 0.7 }], height: 0.4 };
const wall = (world: Partial<ReliefWorld> | null): InteractiveScene => ({
  ...defaultInteractive(),
  surfaces: [{ ...block, look: { fill: 'ripples', brightness: 0.6, outline: 0.5, scale: 0.5, speed: 0.4 } } as InteractiveScene['surfaces'][number]],
  effects: [makeEffect('architecture'), makeEffect('fire'), makeEffect('balls3d'), makeEffect('drips'), makeEffect('flames')],
  ...(world ? { world: { ...defaultReliefWorld(), ...world } } : {}),
});

function room(): InteractiveScene {
  const top: RoomFace = {
    surfaceId: 'top', role: 'top', origin: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, -1],
    points: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }], depth: 1,
  };
  const r: Room = { source: 'manual', projector: { position: [0, 2.5, 4], target: [0, 0, 0], fov: 35 }, down: [0, -1, 0], floor: true, faces: [top] };
  const world = { ...defaultReliefWorld(), source: 'room' as const, room: r };
  const geo = worldGeometry(defaultInteractive(), world, 16 / 9);
  return {
    ...defaultInteractive(),
    surfaces: [{ id: 'top', name: 'Top', behavior: 'solid', points: top.points.map((p) => projectPoint(geo.projector, facePoint(top, p))) }],
    effects: [makeEffect('architecture'), makeEffect('balls3d'), makeEffect('flames')],
    world,
  };
}

const inputs: InteractiveLiveInput[] = [
  {},
  { interactiveInputs: [{ id: 'p', point: { x: 0.4, y: 0.5 }, strength: 1, mode: 'attract' }] },
  {
    interactiveInputs: [{ id: 'p', point: { x: 0.45, y: 0.4 }, strength: 0.7, mode: 'push' }, { id: 'h', point: { x: 0.7, y: 0.2 }, strength: 1, mode: 'vortex' }],
    interactiveView: { yaw: 25, pitch: -10 },
    interactiveWorld: {
      pointers: [{ point: { x: 0.5, y: 0.5 }, velocity: { x: 0.2, y: 0 }, tool: 'ignite', strength: 1 }, { point: { x: 0.3, y: 0.6 }, velocity: { x: 0, y: 0 }, tool: 'push', strength: 0.5 }],
      throws: [{ point: { x: 0.5, y: 0.2 }, velocity: { x: 1, y: -2 }, number: 7, at: 0 }],
    },
  },
  { interactiveView: { yaw: -60, pitch: 30 } },
];

describe('Interactive graph: live input as its own values', () => {
  const scenes: [string, InteractiveScene][] = [
    ['2D only', wall(null)],
    ['wall, projected', wall({ flat: 'projected' })],
    ['wall, over', wall({ flat: 'over' })],
    ['wall, off', wall({ flat: 'off' })],
    ['room', room()],
  ];
  for (const [name, scene] of scenes) {
    it(`gives what a full build gives, for every input (${name})`, () => {
      const installed = build(scene);
      for (const live of inputs) {
        const full = build(scene, live);
        expect(full.interactive.topology).toBe(installed.interactive.topology);
        const fresh = installed.interactive.live!(live);
        const byId = new Map(full.interactive.values.map((v) => [v.id, v]));
        // Every live value is the one the full build has under that id.
        for (const v of fresh) expect({ id: v.id, key: v.key, initial_b64: v.initial_b64 }).toEqual(byId.get(v.id));
        // And nothing else differs between the full build and the installed one.
        const liveIds = new Set(fresh.map((v) => v.id));
        const before = new Map(installed.interactive.values.map((v) => [v.id, v.key]));
        const otherChanges = full.interactive.values.filter((v) => !liveIds.has(v.id) && before.get(v.id) !== v.key);
        expect(otherChanges.map((v) => v.id)).toEqual([]);
      }
    });
  }

  it('is small next to the graph it saves rebuilding', () => {
    const installed = build(wall({ flat: 'projected' }));
    const bytes = installed.interactive.live!(inputs[2]).reduce((n, v) => n + v.initial_b64.length, 0);
    expect(bytes).toBeLessThan(8_000);
    expect(JSON.stringify(installed.config).length).toBeGreaterThan(10 * bytes);
  });
});
