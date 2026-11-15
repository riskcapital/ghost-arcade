/**
 * Live input on an Interactive layer (touches, tracked points, the Orbit
 * view, throws and pours) is worked out on its own, from the installed
 * build, instead of rebuilding the whole graph every frame it moves.
 */
import { describe, expect, it } from 'vitest';
import { buildInteractiveGraph, interactiveParamsAreValues, type InteractiveGraphBuildResult, type InteractiveLiveInput, type InteractiveLiveParams } from './nativeInteractiveGraph';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { applyInteractiveOverrides, EFFECT_KINDS, effectParams, isWorldEffect, makeEffect } from '../mobile/studio/interactiveEffects';
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

/**
 * Auto on an Interactive scene's effect param (a live `interactive:` value)
 * moves only value buffers: the installed build works them out without
 * building the graph again, and they equal a full build of the scene with
 * those params set.
 */
describe('Interactive graph: live params as their own values', () => {
  /** Every number param of every effect, set somewhere inside its range. */
  function everyParam(scene: InteractiveScene, at: number): InteractiveLiveParams {
    const out: InteractiveLiveParams = {};
    for (const e of scene.effects ?? []) {
      for (const d of effectParams(e.kind)) out[`interactive:${e.id}:${d.key}`] = d.min + (d.max - d.min) * at;
    }
    return out;
  }
  /** Without the sound defaults, which put modulation on some of these keys. */
  const quiet = (scene: InteractiveScene): InteractiveScene => ({ ...scene, effects: scene.effects?.map((e) => ({ ...e, mods: {} })) });
  const scenes: [string, InteractiveScene][] = [
    // With the sound defaults: their modulation is dropped where a live value lands.
    ['wall, projected, with sound', wall({ flat: 'projected' })],
    ['2D only', quiet(wall(null))],
    ['wall, projected', quiet(wall({ flat: 'projected' }))],
    ['wall, over', quiet(wall({ flat: 'over' }))],
    ['wall, off', quiet(wall({ flat: 'off' }))],
    ['room', quiet(room())],
  ];
  for (const [name, scene] of scenes) {
    it(`gives what a full build of the moved scene gives (${name})`, () => {
      const installed = build(scene);
      const firstEffect = scene.effects![1] ?? scene.effects![0];
      const sets: InteractiveLiveParams[] = [
        everyParam(scene, 0.25),
        everyParam(scene, 0.9),
        { [`interactive:${firstEffect.id}:hue`]: 300 },
        // One world effect's param only.
        { [`interactive:${scene.effects!.find((e) => e.kind === 'balls3d' || e.kind === 'flames')!.id}:glow`]: 0.7 },
      ];
      // No params (an Auto that just stopped): the stored values, for every buffer params fill.
      for (const live of inputs) {
        const full = build(scene, live);
        const byId = new Map(full.interactive.values.map((v) => [v.id, v]));
        const back = installed.interactive.live!(live, {});
        expect(back.some((v) => v.id.endsWith(':matter') || v.id.endsWith(':ball-kinds'))).toBe(true);
        for (const v of back) expect({ id: v.id, key: v.key, initial_b64: v.initial_b64 }).toEqual(byId.get(v.id));
      }
      for (const all of sets) {
        // Keys that need a rebuild (a Core-modulated key with modulation on it) are not live values.
        const params = Object.fromEntries(Object.entries(all).filter(([k, v]) => interactiveParamsAreValues(scene, { [k]: v })));
        expect(Object.keys(params).length).toBeGreaterThan(0);
        expect(interactiveParamsAreValues(scene, params)).toBe(true);
        for (const live of inputs) {
          const full = build(applyInteractiveOverrides(scene, params), live);
          // The same structure: nothing to install.
          expect(full.interactive.topology).toBe(installed.interactive.topology);
          const fresh = installed.interactive.live!(live, params);
          const byId = new Map(full.interactive.values.map((v) => [v.id, v]));
          for (const v of fresh) expect({ id: v.id, key: v.key, initial_b64: v.initial_b64 }).toEqual(byId.get(v.id));
          const liveIds = new Set(fresh.map((v) => v.id));
          const before = new Map(installed.interactive.values.map((v) => [v.id, v.key]));
          const otherChanges = full.interactive.values.filter((v) => !liveIds.has(v.id) && before.get(v.id) !== v.key);
          expect(otherChanges.map((v) => v.id)).toEqual([]);
        }
      }
    });
  }

  it('leaves structural keys to a rebuild', () => {
    const scene = wall({ flat: 'projected' });
    const fire = scene.effects!.find((e) => e.kind === 'fire')!;
    expect(interactiveParamsAreValues(scene, { [`interactive:${fire.id}:enabled`]: 0 })).toBe(false);
    // A key the core modulates from the installed params, with a modulation on it.
    const modded = { ...scene, effects: scene.effects!.map((e) => e.id === fire.id ? { ...e, mods: { hue: { source: 'bass', amount: 0.5, speed: 0.15, invert: false, bpmSync: false } } } : e) } as InteractiveScene;
    expect(interactiveParamsAreValues(modded, { [`interactive:${fire.id}:hue`]: 120 })).toBe(false);
    expect(interactiveParamsAreValues(modded, { [`interactive:${fire.id}:flow`]: 0.2 })).toBe(true);
  });
});

/**
 * What the keyframe, show lane and Timeline line pickers offer on an
 * Interactive layer (keyframes/paramDiscovery.ts): `enabled` as on/off, and
 * every number param of every effect as a smooth line. Each number param, on
 * its own at either end of its range, moves value buffers only (the same
 * structure, Most balls/drops/particles included), and a build made while
 * values moved still puts the stored ones back.
 */
describe('Interactive graph: every param a line can drive is a value', () => {
  const withEffect = (kind: Parameters<typeof makeEffect>[0]): InteractiveScene => ({
    ...defaultInteractive(),
    surfaces: [block],
    effects: [{ ...makeEffect(kind), mods: {} }],
    ...(isWorldEffect(kind) ? { world: { ...defaultReliefWorld(), flat: 'projected' as const } } : {}),
  });
  for (const kind of EFFECT_KINDS) {
    it(`${kind}: each param alone, at its min and max`, () => {
      const scene = withEffect(kind);
      const installed = build(scene);
      const effect = scene.effects![0];
      for (const d of effectParams(kind)) {
        for (const value of [d.min, d.max]) {
          const params = { [`interactive:${effect.id}:${d.key}`]: value };
          expect(interactiveParamsAreValues(scene, params)).toBe(true);
          const full = build(applyInteractiveOverrides(scene, params));
          expect([d.key, full.interactive.topology]).toEqual([d.key, installed.interactive.topology]);
          const byId = new Map(full.interactive.values.map((v) => [v.id, v]));
          const fresh = installed.interactive.live!({}, params);
          for (const v of fresh) expect({ id: v.id, key: v.key, initial_b64: v.initial_b64 }).toEqual(byId.get(v.id));
          const liveIds = new Set(fresh.map((v) => v.id));
          const before = new Map(installed.interactive.values.map((v) => [v.id, v.key]));
          expect([d.key, full.interactive.values.filter((v) => !liveIds.has(v.id) && before.get(v.id) !== v.key).map((v) => v.id)]).toEqual([d.key, []]);
        }
      }
    });
  }

  it('a build made while values moved gives the stored values back when they stop', () => {
    const scene = wall({ flat: 'projected' });
    const fire = scene.effects!.find((e) => e.kind === 'fire')!;
    const balls = scene.effects!.find((e) => e.kind === 'balls3d')!;
    const params = { [`interactive:${fire.id}:speed`]: 0.9, [`interactive:${balls.id}:glow`]: 0.8 };
    const movedBuild = buildInteractiveGraph({
      kind: 'performer-world', sourceId: 'layer-1', params: { interactiveScene: scene, interactiveLiveParams: params },
      width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio, state: null, reset: false,
    } as Parameters<typeof buildInteractiveGraph>[0]);
    // The build itself is the moved scene.
    const moved = build(applyInteractiveOverrides(scene, params));
    expect(movedBuild.interactive.values).toEqual(moved.interactive.values);
    // Stopped: every buffer the params fill goes back to the stored scene's.
    const stored = new Map(build(scene).interactive.values.map((v) => [v.id, v]));
    const back = movedBuild.interactive.live!({}, {});
    expect(back.some((v) => v.id.endsWith(':matter'))).toBe(true);
    for (const v of back) expect({ id: v.id, key: v.key, initial_b64: v.initial_b64 }).toEqual(stored.get(v.id));
  });
});
