import { describe, expect, it } from 'vitest';
import { defaultInteractive, validateScene, type InteractiveScene, type Interaction } from '../mobile/studio/interactive';
import { validateShowAction } from '../show/showActionValidate';
import type { SignalFrame } from '../mediapipe/signals';
import {
  combineInputs,
  MAX_INPUT_POINTS,
  PointSmoother,
  touchBufferData,
  trackedPoints,
  ZoneTriggers,
} from './interactiveRuntime';

const hand = (handedness: string, x: number, y: number) => ({
  handedness,
  landmarks: Array.from({ length: 21 }, (_, i) => ({ x: x + (i === 8 ? 0.05 : 0), y: y - (i === 8 ? 0.1 : 0), z: 0 })),
});
const frame = (extra: Partial<SignalFrame> = {}): SignalFrame => ({
  timestamp: 1, values: {}, gestures: {}, confidence: {}, hands: [], ...extra,
});

function zoneScene(rearm = 1): InteractiveScene {
  return validateScene({
    ...defaultInteractive(),
    surfaces: [{
      id: 'zone', name: 'Zone', behavior: 'trigger',
      points: [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.9 }, { x: 0.5, y: 0.9 }],
      trigger: { rearm, actions: [{ kind: 'burst' }, { kind: 'show', action: { kind: 'look', lookId: 'neon-edges' } }] },
    }],
  });
}
const at = (x: number, y: number, id = 'p'): Interaction => ({ id, point: { x, y }, strength: 1 });

describe('tracked points', () => {
  it('takes the palm and index tip of each hand, mirrored like the camera view', () => {
    const points = trackedPoints(frame({ hands: [hand('Left', 0.2, 0.6)] }), 'hands', true);
    expect(points.map((p) => p.id)).toEqual(['hand-Left-palm', 'hand-Left-tip']);
    expect(points[0].point.x).toBeCloseTo(0.8);
    expect(points[0].point.y).toBeCloseTo(0.6);
    expect(points[1].point.x).toBeCloseTo(0.75);
    expect(points[1].point.y).toBeCloseTo(0.5);
    expect(trackedPoints(frame({ hands: [hand('Left', 0.2, 0.6)] }), 'hands', false)[0].point.x).toBeCloseTo(0.2);
  });

  it('takes the visible head, wrists and feet of a body, and nothing when tracking is off', () => {
    const pose = Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: i / 33, z: 0, visibility: i === 31 ? 0.1 : 0.9 }));
    const body = trackedPoints(frame({ pose }), 'body', false).map((p) => p.id);
    expect(body).toEqual(['body-head', 'body-wrist-l', 'body-wrist-r', 'body-foot-r']);
    expect(trackedPoints(frame({ pose, hands: [hand('Right', 0.5, 0.5)] }), 'off', false)).toEqual([]);
    expect(trackedPoints(frame({ pose, hands: [hand('Right', 0.5, 0.5)] }), 'both', false)).toHaveLength(6);
  });

  it('smooths small jitter but follows a fast move at once', () => {
    const smoother = new PointSmoother();
    smoother.update([{ id: 'a', point: { x: 0.5, y: 0.5 } }]);
    const jitter = smoother.update([{ id: 'a', point: { x: 0.502, y: 0.5 } }])[0].point.x;
    expect(jitter).toBeGreaterThan(0.5);
    expect(jitter).toBeLessThan(0.502);
    const jump = smoother.update([{ id: 'a', point: { x: 0.9, y: 0.5 } }])[0].point.x;
    expect(jump).toBeCloseTo(0.9);
  });
});

describe('touch buffer', () => {
  it('puts pointer touches first, caps at eight and parks unused entries outside the scene', () => {
    const tracked = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, point: { x: 0.1, y: 0.1 } }));
    const all = combineInputs([at(0.3, 0.3, 'mouse')], tracked, { force: 'vortex', strength: 0.5 });
    expect(all).toHaveLength(MAX_INPUT_POINTS);
    expect(all[0].id).toBe('mouse');
    expect(all[1]).toMatchObject({ strength: 0.5, mode: 'vortex' });
    const data = touchBufferData([at(0.3, 0.4)]);
    expect([...data.slice(0, 4)]).toEqual([expect.closeTo(0.3), expect.closeTo(0.4), 1, 0]);
    expect([...data.slice(4, 8)]).toEqual([-10, -10, 0, 0]);
  });
});

describe('trigger zones', () => {
  it('fire once on entry, not while held, and again after leaving once re-armed', () => {
    const scene = zoneScene(1);
    const zones = new ZoneTriggers();
    expect(zones.update(scene, [at(0.7, 0.7)], 0)).toEqual([{ surfaceId: 'zone', actions: scene.surfaces[0].trigger!.actions }]);
    expect(zones.update(scene, [at(0.7, 0.7)], 0.5)).toEqual([]);
    expect(zones.update(scene, [at(0.7, 0.7)], 5)).toEqual([]);
    expect(zones.update(scene, [], 5.1)).toEqual([]);
    expect(zones.update(scene, [at(0.6, 0.6)], 5.2)).toHaveLength(1);
  });

  it('wait out the re-arm time even when the touch leaves and comes back', () => {
    const scene = zoneScene(2);
    const zones = new ZoneTriggers();
    expect(zones.update(scene, [at(0.7, 0.7)], 0)).toHaveLength(1);
    zones.update(scene, [], 0.2);
    expect(zones.update(scene, [at(0.7, 0.7)], 0.4)).toEqual([]);
    zones.update(scene, [], 2.5);
    expect(zones.update(scene, [at(0.7, 0.7)], 2.6)).toHaveLength(1);
  });

  it('ignore points outside, and zones without a trigger', () => {
    const scene = zoneScene();
    const zones = new ZoneTriggers();
    expect(zones.update(scene, [at(0.1, 0.1)], 0)).toEqual([]);
    const plain = validateScene({ ...scene, surfaces: [{ ...scene.surfaces[0], trigger: undefined }] });
    expect(new ZoneTriggers().update(plain, [at(0.7, 0.7)], 0)).toEqual([]);
  });
});

describe('stored zones and input', () => {
  it('keep valid actions, drop stale ones and clamp the re-arm time', () => {
    const scene = validateScene({
      ...defaultInteractive(),
      input: { tracking: 'hands', force: 'repel', strength: 3 },
      surfaces: [{
        id: 'z', name: 'Z', behavior: 'trigger', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
        trigger: { rearm: 500, actions: [
          { kind: 'show', action: { kind: 'clip', row: 1, column: 2, deck: 'B', extra: 'x' } },
          { kind: 'show', action: { kind: 'takeover', track: 0 } },
          { kind: 'show', action: { kind: 'nope' } },
          { kind: 'burst', junk: true },
        ] },
      }],
    });
    expect(scene.input).toEqual({ tracking: 'hands', force: 'repel', strength: 1 });
    expect(scene.surfaces[0].trigger).toEqual({
      rearm: 60,
      actions: [{ kind: 'show', action: { kind: 'clip', row: 1, column: 2, deck: 'B' } }, { kind: 'burst' }],
    });
  });

  it('drop a trigger on a surface that is not a zone', () => {
    const scene = validateScene({
      ...defaultInteractive(),
      surfaces: [{ id: 's', name: 'S', behavior: 'solid', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], trigger: { rearm: 1, actions: [] } }],
    });
    expect(scene.surfaces[0].trigger).toBeUndefined();
  });

  it('validate every show action kind a zone can carry', () => {
    expect(validateShowAction({ kind: 'look', lookId: 'a', layerIds: ['x', 5] })).toEqual({ kind: 'look', lookId: 'a', layerIds: ['x'] });
    expect(validateShowAction({ kind: 'cue', op: 'fire', index: 3 })).toEqual({ kind: 'cue', op: 'fire', index: 3 });
    expect(validateShowAction({ kind: 'cue', op: 'fire' })).toBeNull();
    expect(validateShowAction({ kind: 'section', name: 'Drop' })).toEqual({ kind: 'section', name: 'Drop' });
    expect(validateShowAction({ kind: 'phrase', pad: 0 })).toBeNull();
    expect(validateShowAction({ kind: 'blackout' })).toEqual({ kind: 'blackout' });
    expect(validateShowAction({ kind: 'transport', op: 'seek', seconds: -4 })).toEqual({ kind: 'transport', op: 'seek', seconds: 0 });
    expect(validateShowAction({ kind: 'preset', compositionId: '../x y' })).toBeNull();
  });
});

import { EFFECT_KINDS, effectParams, evaluateEffect, makeEffect, validateEffects } from '../mobile/studio/interactiveEffects';

describe('new effects follow the music', () => {
  it('every kind starts with a sound modulation on a real parameter, kept by the validator', () => {
    for (const kind of EFFECT_KINDS) {
      const effect = makeEffect(kind);
      const keys = Object.keys(effect.mods);
      expect(keys.length, kind).toBeGreaterThan(0);
      for (const key of keys) expect(effectParams(kind).some((d) => d.key === key), `${kind}.${key}`).toBe(true);
      const [kept] = validateEffects([effect], new Set());
      expect(kept.mods, kind).toEqual(effect.mods);
    }
  });

  it('is quieter in silence than on a loud bass, and still moving in silence', () => {
    const effect = makeEffect('fire');
    const quiet = evaluateEffect(effect, 1, { bass: 0, amplitude: 0 });
    const loud = evaluateEffect(effect, 1, { bass: 1, amplitude: 1 });
    expect(loud.params.flow).toBeGreaterThan(quiet.params.flow);
    expect(loud.params.heat).toBeGreaterThan(quiet.params.heat);
    expect(quiet.params.flow).toBeGreaterThan(0.3);
  });

  it('leaves effects rebuilt from an older scene as they were', () => {
    expect(makeEffect('fire', 'point', false).mods).toEqual({});
  });
});
