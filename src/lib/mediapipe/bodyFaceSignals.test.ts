import { describe, expect, it } from 'vitest';
import { deriveBodySignals, deriveFaceSignals, deriveSignals, SIGNAL_DEFS, type PoseLandmark } from './signals';

/** A standing figure facing the camera, built from a few named joints. */
function figure(joints: Partial<Record<'nose' | 'shoulderL' | 'shoulderR' | 'wristL' | 'wristR' | 'hipL' | 'hipR' | 'ankleL' | 'ankleR', [number, number]>> = {}, hidden: number[] = []) {
  const base: Record<string, [number, number]> = {
    nose: [0.5, 0.2], shoulderL: [0.58, 0.3], shoulderR: [0.42, 0.3], wristL: [0.6, 0.52], wristR: [0.4, 0.52],
    hipL: [0.55, 0.5], hipR: [0.45, 0.5], ankleL: [0.55, 0.88], ankleR: [0.45, 0.88], ...joints,
  };
  const index: Record<string, number> = { nose: 0, shoulderL: 11, shoulderR: 12, wristL: 15, wristR: 16, hipL: 23, hipR: 24, ankleL: 27, ankleR: 28 };
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  for (const [name, [x, y]] of Object.entries(base)) landmarks[index[name]] = { x, y, z: 0, visibility: 0.95 };
  for (const i of hidden) landmarks[i].visibility = 0.1;
  return { landmarks };
}

describe('body signals', () => {
  it('reads a neutral standing figure as upright, arms down, standing tall', () => {
    const v = deriveBodySignals(figure(), false);
    expect(v['body.x']).toBeCloseTo(0.5, 2);
    expect(v['body.lean']).toBeCloseTo(0.5, 2);
    expect(v['arm.left.raise']).toBeLessThan(0.1);
    expect(v['arm.right.raise']).toBeLessThan(0.1);
    expect(v['body.crouch']).toBeLessThan(0.1);
    expect(v['body.facing']).toBeGreaterThan(0.9);
  });
  it('raises one arm, and only that arm', () => {
    const v = deriveBodySignals(figure({ wristL: [0.62, 0.08] }), false);
    expect(v['arm.left.raise']).toBeGreaterThan(0.95);
    expect(v['arm.right.raise']).toBeLessThan(0.1);
  });
  it("swaps left and right for a mirrored picture, so the right arm is the performer's right", () => {
    const v = deriveBodySignals(figure({ wristL: [0.62, 0.08] }), true);
    expect(v['arm.right.raise']).toBeGreaterThan(0.95);
    expect(v['arm.left.raise']).toBeLessThan(0.1);
  });
  it('follows a crouch, a lean and a wide stance', () => {
    const crouched = deriveBodySignals(figure({ ankleL: [0.55, 0.7], ankleR: [0.45, 0.7] }), false);
    expect(crouched['body.crouch']).toBeGreaterThan(0.4);
    const leaning = deriveBodySignals(figure({ shoulderL: [0.68, 0.3], shoulderR: [0.52, 0.3] }), false);
    expect(leaning['body.lean']).toBeGreaterThan(0.9);
    const wide = deriveBodySignals(figure({ ankleL: [0.75, 0.88], ankleR: [0.25, 0.88] }), false);
    expect(wide['stance.width']).toBeGreaterThan(deriveBodySignals(figure(), false)['stance.width'] + 0.4);
  });
  it('is the same near and far', () => {
    const near = deriveBodySignals(figure({ wristL: [0.6, 0.3] }), false);
    const far = { landmarks: figure({ wristL: [0.6, 0.3] }).landmarks.map(p => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.4, y: 0.5 + (p.y - 0.5) * 0.4 })) };
    const v = deriveBodySignals(far, false);
    for (const id of ['arm.left.raise', 'body.lean', 'body.crouch', 'stance.width', 'arms.spread']) expect(v[id]).toBeCloseTo(near[id], 2);
  });
  it('leaves out what it cannot see instead of reporting zero', () => {
    const v = deriveBodySignals(figure({}, [27, 28, 15]), false);
    expect('body.crouch' in v).toBe(false);
    expect('stance.width' in v).toBe(false);
    expect('arm.left.raise' in v).toBe(false);
    expect('arm.right.raise' in v).toBe(true);
    expect(deriveBodySignals(figure({}, [11, 12]), false)['body.x']).toBeUndefined();
  });
});

describe('face signals', () => {
  const mesh = (nose: [number, number], eyes: [[number, number], [number, number]] = [[0.42, 0.42], [0.58, 0.42]]) => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[1] = { x: nose[0], y: nose[1], z: 0 };
    landmarks[10] = { x: 0.5, y: 0.3, z: 0 }; landmarks[152] = { x: 0.5, y: 0.7, z: 0 };
    landmarks[234] = { x: 0.35, y: 0.5, z: 0 }; landmarks[454] = { x: 0.65, y: 0.5, z: 0 };
    landmarks[33] = { x: eyes[0][0], y: eyes[0][1], z: 0 }; landmarks[263] = { x: eyes[1][0], y: eyes[1][1], z: 0 };
    return landmarks;
  };
  it('takes expressions from the model scores and swaps the eyes when mirrored', () => {
    const blendshapes = { jawOpen: 0.8, mouthSmileLeft: 0.6, mouthSmileRight: 0.4, browInnerUp: 0.9, browOuterUpLeft: 0.3, browOuterUpRight: 0.3, eyeBlinkLeft: 1, eyeBlinkRight: 0, mouthPucker: 0.2 };
    const v = deriveFaceSignals({ landmarks: mesh([0.5, 0.5]), blendshapes }, false);
    expect(v['face.mouth']).toBeCloseTo(0.8, 5);
    expect(v['face.smile']).toBeCloseTo(0.5, 5);
    expect(v['face.brows']).toBeCloseTo(0.5, 5);
    expect([v['face.blink.left'], v['face.blink.right']]).toEqual([1, 0]);
    const mirrored = deriveFaceSignals({ landmarks: mesh([0.5, 0.5]), blendshapes }, true);
    expect([mirrored['face.blink.left'], mirrored['face.blink.right']]).toEqual([0, 1]);
  });
  it('reads head turn, nod and tilt from the landmarks, centred at 0.5', () => {
    const straight = deriveFaceSignals({ landmarks: mesh([0.5, 0.5]), blendshapes: {} }, false);
    expect([straight['face.turn'], straight['face.nod'], straight['face.tilt']].map(n => +n.toFixed(2))).toEqual([0.5, 0.5, 0.5]);
    expect(deriveFaceSignals({ landmarks: mesh([0.58, 0.5]), blendshapes: {} }, false)['face.turn']).toBeGreaterThan(0.85);
    expect(deriveFaceSignals({ landmarks: mesh([0.5, 0.42]), blendshapes: {} }, false)['face.nod']).toBeLessThan(0.15);
    expect(deriveFaceSignals({ landmarks: mesh([0.5, 0.5], [[0.42, 0.38], [0.58, 0.46]]), blendshapes: {} }, false)['face.tilt']).toBeGreaterThan(0.75);
    // No expression scores: those signals are simply absent.
    expect('face.mouth' in straight).toBe(false);
  });
});

describe('the combined frame', () => {
  it('keeps hand signals untouched and adds body and face beside them', () => {
    const none = deriveSignals(1, []);
    expect(none.pose).toBeUndefined();
    const frame = deriveSignals(2, [], { pose: figure(), face: { landmarks: [], blendshapes: { jawOpen: 0.5 } }, mirrored: true });
    expect(frame.values['body.x']).toBeCloseTo(0.5, 2);
    expect(frame.values['face.mouth']).toBe(0.5);
    expect(frame.pose).toHaveLength(33);
    expect(frame.gestures).toEqual({ 'gesture.right': '', 'gesture.left': '' });
  });
  it('every signal a derivation can produce is listed for binding', () => {
    const listed = new Set(SIGNAL_DEFS.map(s => s.id));
    const produced = Object.keys({ ...deriveBodySignals(figure(), false), ...deriveFaceSignals({ landmarks: Array.from({ length: 478 }, (_, i) => ({ x: 0.3 + (i % 7) * 0.05, y: 0.3 + (i % 5) * 0.05, z: 0 })), blendshapes: { jawOpen: 1, mouthSmileLeft: 1, mouthSmileRight: 1, browInnerUp: 1, eyeBlinkLeft: 1, eyeBlinkRight: 1, mouthPucker: 1 } }, false) });
    expect(produced.filter(id => !listed.has(id))).toEqual([]);
    expect(produced.length).toBeGreaterThan(22);
  });
});
