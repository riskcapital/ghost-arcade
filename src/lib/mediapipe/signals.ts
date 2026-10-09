// MediaPipe signal definitions + derivation helpers.
//
// We expose hand-derived signals at three abstraction levels:
//   - position/depth (palm.x/y/z per hand)
//   - relations (pinch distance, two-hand spread)
//   - categorical gesture (canned MediaPipe gestures)
//
// Continuous signals are normalized 0..1 so any binding can rescale to
// a target param range with the same math as MIDI CC. Categorical
// gestures emit 1.0 on the frame they're first detected and 0.0 when
// the gesture changes — see GESTURE_LIST below for the canonical id
// strings the rest of the app uses.
//
// Signal id naming: `<group>.<handedness>.<axis>` for positional,
// `<group>.<handedness>` for scalar, `<group>` for global. Stable IDs
// so bindings persisted in localStorage survive code reshapes.

import type { WorkerHandResult } from './mediaPipeWorker';

export type SignalKind = 'continuous' | 'trigger' | 'categorical';

export interface SignalDef {
  id: string;
  label: string;
  kind: SignalKind;
  description: string;
}

export const SIGNAL_DEFS: SignalDef[] = [
  // Per-hand palm position (palm center landmark, MediaPipe index 0)
  { id: 'palm.right.x',  label: 'Right palm X', kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'palm.right.y',  label: 'Right palm Y', kind: 'continuous', description: '0=top, 1=bottom' },
  { id: 'palm.right.z',  label: 'Right palm Z', kind: 'continuous', description: '0=close, 1=far (depth)' },
  { id: 'palm.left.x',   label: 'Left palm X',  kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'palm.left.y',   label: 'Left palm Y',  kind: 'continuous', description: '0=top, 1=bottom' },
  { id: 'palm.left.z',   label: 'Left palm Z',  kind: 'continuous', description: '0=close, 1=far (depth)' },
  // Pinch distance (thumb tip ↔ index tip) normalized to hand size
  { id: 'pinch.right',   label: 'Right pinch',  kind: 'continuous', description: '0=fully pinched, 1=open' },
  { id: 'pinch.left',    label: 'Left pinch',   kind: 'continuous', description: '0=fully pinched, 1=open' },
  // Intra-hand finger spread (thumb tip ↔ pinky tip) — hand-size
  // normalised so depth doesn't fake spread. Reads as "openness" of
  // the hand: closed fist ≈ 0.2, fully splayed ≈ 1.0.
  { id: 'spread.right',  label: 'Right spread', kind: 'continuous', description: '0=closed fist, 1=fingers splayed' },
  { id: 'spread.left',   label: 'Left spread',  kind: 'continuous', description: '0=closed fist, 1=fingers splayed' },
  // Two-hand relations
  { id: 'hands.distance',label: 'Hands spread', kind: 'continuous', description: 'Palm-to-palm distance' },
  // Categorical gestures — emit 1.0 on frame detected, 0.0 otherwise.
  // Stored as a single string-valued signal per hand for the UI; the
  // bindings layer will offer "trigger on gesture X" mode.
  { id: 'gesture.right', label: 'Right gesture',kind: 'categorical', description: 'Canned MediaPipe gesture' },
  { id: 'gesture.left',  label: 'Left gesture', kind: 'categorical', description: 'Canned MediaPipe gesture' },
  // ── Body (skeleton). On when body tracking is switched on. ────────────
  { id: 'body.x',          label: 'Body X',           kind: 'continuous', description: 'Where you stand: 0=left edge, 1=right edge' },
  { id: 'body.y',          label: 'Body Y',           kind: 'continuous', description: 'Hip height in the picture: 0=top, 1=bottom' },
  { id: 'body.lean',       label: 'Body lean',        kind: 'continuous', description: '0=leaning left, 0.5=upright, 1=leaning right' },
  { id: 'body.crouch',     label: 'Crouch',           kind: 'continuous', description: '0=standing tall, 1=crouched' },
  { id: 'body.facing',     label: 'Facing camera',    kind: 'continuous', description: '1=square to the camera, lower as you turn side-on' },
  { id: 'arm.right.raise', label: 'Right arm raise',  kind: 'continuous', description: '0=down by your side, 0.5=level, 1=overhead' },
  { id: 'arm.left.raise',  label: 'Left arm raise',   kind: 'continuous', description: '0=down by your side, 0.5=level, 1=overhead' },
  { id: 'arms.spread',     label: 'Arms spread',      kind: 'continuous', description: 'Wrist to wrist: 0=together, 1=wide apart' },
  { id: 'wrist.right.x',   label: 'Right wrist X',    kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'wrist.right.y',   label: 'Right wrist Y',    kind: 'continuous', description: '0=top, 1=bottom' },
  { id: 'wrist.left.x',    label: 'Left wrist X',     kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'wrist.left.y',    label: 'Left wrist Y',     kind: 'continuous', description: '0=top, 1=bottom' },
  { id: 'stance.width',    label: 'Stance width',     kind: 'continuous', description: 'Feet: 0=together, 1=wide' },
  { id: 'head.x',          label: 'Head X',           kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'head.y',          label: 'Head Y',           kind: 'continuous', description: '0=top, 1=bottom' },
  // ── Face. On when face tracking is switched on. ───────────────────────
  { id: 'face.mouth',       label: 'Mouth open',      kind: 'continuous', description: '0=closed, 1=wide open' },
  { id: 'face.smile',       label: 'Smile',           kind: 'continuous', description: '0=neutral, 1=big smile' },
  { id: 'face.brows',       label: 'Brows raised',    kind: 'continuous', description: '0=relaxed, 1=raised' },
  { id: 'face.pucker',      label: 'Pucker',          kind: 'continuous', description: '0=relaxed, 1=lips pursed' },
  { id: 'face.blink.right', label: 'Right eye closed',kind: 'continuous', description: '0=open, 1=closed' },
  { id: 'face.blink.left',  label: 'Left eye closed', kind: 'continuous', description: '0=open, 1=closed' },
  { id: 'face.turn',        label: 'Head turn',       kind: 'continuous', description: '0=turned left, 0.5=straight, 1=turned right' },
  { id: 'face.nod',         label: 'Head nod',        kind: 'continuous', description: '0=looking up, 0.5=level, 1=looking down' },
  { id: 'face.tilt',        label: 'Head tilt',       kind: 'continuous', description: '0=tilted left, 0.5=level, 1=tilted right' },
  { id: 'face.x',           label: 'Face X',          kind: 'continuous', description: '0=left edge, 1=right edge' },
  { id: 'face.y',           label: 'Face Y',          kind: 'continuous', description: '0=top, 1=bottom' },
  { id: 'face.near',        label: 'Face near',       kind: 'continuous', description: '0=far from the camera, 1=close' },
];

/** Canonical gesture ids — these are what MediaPipe's gesture model
 *  returns. The 'None' bucket is collapsed to empty string at the
 *  source level so we don't fire a trigger every frame the hand is
 *  visible but not gesturing. */
export const GESTURE_LIST = [
  'Open_Palm', 'Closed_Fist', 'Pointing_Up',
  'Thumb_Up', 'Thumb_Down', 'Victory', 'ILoveYou',
] as const;
export type GestureName = (typeof GESTURE_LIST)[number] | '';

/** Live signal snapshot the source produces each frame. Continuous
 *  values are 0..1 (or NaN if not currently observable); gestures are
 *  the empty string when nothing recognized. */
export interface SignalFrame {
  timestamp: number;
  values: Record<string, number>;       // continuous signals
  gestures: Record<string, GestureName>; // per-hand gesture state
  /** Confidence per signal id — 0..1. Continuous signals get the
   *  hand-presence score; gestures get the model's category score. */
  confidence: Record<string, number>;
  /** Raw landmark data for the debug overlay. Empty when no hand. */
  hands: { handedness: string; landmarks: { x: number; y: number; z: number; }[] }[];
  /** The 33 body landmarks for the overlay, or absent when no body is seen. */
  pose?: PoseLandmark[];
  /** The 478 face landmarks for the overlay, or absent when no face is seen. */
  face?: { x: number; y: number; z: number }[];
}

export interface PoseLandmark { x: number; y: number; z: number; visibility?: number }
/** One tracked body as the worker reports it: 33 landmarks, image space 0..1. */
export interface WorkerPoseResult { landmarks: PoseLandmark[] }
/** One tracked face: 478 landmarks plus MediaPipe's expression scores by name. */
export interface WorkerFaceResult { landmarks: { x: number; y: number; z: number }[]; blendshapes: Record<string, number> }

const EMPTY_FRAME: SignalFrame = {
  timestamp: 0, values: {}, gestures: { 'gesture.right': '', 'gesture.left': '' },
  confidence: {}, hands: [],
};

/** Distance helper for landmark pairs. MediaPipe landmark space is
 *  normalized 0..1 in image coords; that's already a usable scale. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Turn worker-side per-hand landmark results into normalized signals.
 * One frame per inference cycle.
 */
export function deriveSignals(
  timestamp: number,
  hands: WorkerHandResult[],
  body: { pose?: WorkerPoseResult | null; face?: WorkerFaceResult | null; mirrored?: boolean } = {},
): SignalFrame {
  const frame = deriveHandSignals(timestamp, hands);
  if (!body.pose && !body.face) return frame;
  const values = { ...frame.values }, confidence = { ...frame.confidence };
  if (body.pose) Object.assign(values, deriveBodySignals(body.pose, !!body.mirrored, confidence));
  if (body.face) Object.assign(values, deriveFaceSignals(body.face, !!body.mirrored, confidence));
  return { ...frame, values, confidence, pose: body.pose?.landmarks, face: body.face?.landmarks };
}

// MediaPipe pose landmark indices.
const POSE = { nose: 0, shoulderL: 11, shoulderR: 12, wristL: 15, wristR: 16, hipL: 23, hipR: 24, ankleL: 27, ankleR: 28 } as const;
const SEEN = 0.5;

/**
 * Body signals from the 33 pose landmarks. Everything is measured against
 * the body's own size (shoulder width, torso length), so it reads the same
 * near the camera and far from it. A signal is left out, not zeroed, when
 * the landmarks it needs are out of view. `mirrored` swaps left and right
 * so "right arm" is the performer's right arm in a selfie-style picture.
 */
export function deriveBodySignals(pose: WorkerPoseResult, mirrored: boolean, confidence: Record<string, number> = {}): Record<string, number> {
  const lm = pose.landmarks, out: Record<string, number> = {};
  if (!lm || lm.length < 29) return out;
  const seen = (...ids: number[]) => Math.min(...ids.map(i => lm[i]?.visibility ?? 1));
  const mid = (a: number, b: number) => ({ x: (lm[a].x + lm[b].x) / 2, y: (lm[a].y + lm[b].y) / 2 });
  const put = (id: string, value: number, sure: number) => { if (Number.isFinite(value)) { out[id] = clamp01(value); confidence[id] = clamp01(sure); } };
  const side = (modelLeft: boolean) => (modelLeft !== mirrored ? 'left' : 'right');

  const torsoSeen = seen(POSE.shoulderL, POSE.shoulderR, POSE.hipL, POSE.hipR);
  if (seen(POSE.nose) >= SEEN) { put('head.x', lm[POSE.nose].x, seen(POSE.nose)); put('head.y', lm[POSE.nose].y, seen(POSE.nose)); }
  if (torsoSeen < SEEN) return out;
  const shoulders = mid(POSE.shoulderL, POSE.shoulderR), hips = mid(POSE.hipL, POSE.hipR);
  const shoulderWidth = Math.max(0.03, dist(lm[POSE.shoulderL], lm[POSE.shoulderR]));
  const torso = Math.max(0.05, dist(shoulders, hips));
  put('body.x', hips.x, torsoSeen);
  put('body.y', hips.y, torsoSeen);
  put('body.lean', 0.5 + (shoulders.x - hips.x) / torso, torsoSeen);
  // Square to the camera the shoulders are about 0.8 of the torso wide; side-on they close up.
  put('body.facing', shoulderWidth / (torso * 0.8), torsoSeen);
  for (const [wrist, shoulder, modelLeft] of [[POSE.wristL, POSE.shoulderL, true], [POSE.wristR, POSE.shoulderR, false]] as const) {
    const sure = Math.min(torsoSeen, seen(wrist));
    if (sure < SEEN) continue;
    // Down by the side the wrist is a torso below the shoulder; overhead, a torso above.
    put(`arm.${side(modelLeft)}.raise`, 0.5 + (lm[shoulder].y - lm[wrist].y) / (torso * 2), sure);
    put(`wrist.${side(modelLeft)}.x`, lm[wrist].x, sure);
    put(`wrist.${side(modelLeft)}.y`, lm[wrist].y, sure);
  }
  const wrists = seen(POSE.wristL, POSE.wristR);
  if (wrists >= SEEN) put('arms.spread', dist(lm[POSE.wristL], lm[POSE.wristR]) / (shoulderWidth * 4), Math.min(torsoSeen, wrists));
  const ankles = seen(POSE.ankleL, POSE.ankleR);
  if (ankles >= SEEN) {
    put('stance.width', dist(lm[POSE.ankleL], lm[POSE.ankleR]) / (shoulderWidth * 3), ankles);
    // Standing, hip to ankle is about 1.9 torsos; it shortens as the knees bend.
    put('body.crouch', 1 - dist(hips, mid(POSE.ankleL, POSE.ankleR)) / (torso * 1.9), Math.min(torsoSeen, ankles));
  }
  return out;
}

// Face mesh landmark indices: nose tip, forehead, chin, the two cheek edges, the two outer eye corners.
const FACE = { nose: 1, top: 10, chin: 152, edgeA: 234, edgeB: 454, eyeA: 33, eyeB: 263 } as const;

/**
 * Face signals: expressions from MediaPipe's own scores, and head pose from
 * where the nose sits inside the face outline (which needs no calibration).
 */
export function deriveFaceSignals(face: WorkerFaceResult, mirrored: boolean, confidence: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (id: string, value: number) => { if (Number.isFinite(value)) { out[id] = clamp01(value); confidence[id] = 1; } };
  const b = face.blendshapes || {};
  const score = (...names: string[]) => { const found = names.map(n => b[n]).filter((v): v is number => typeof v === 'number'); return found.length ? found.reduce((t, v) => t + v, 0) / found.length : NaN; };
  put('face.mouth', score('jawOpen'));
  put('face.smile', score('mouthSmileLeft', 'mouthSmileRight'));
  put('face.brows', score('browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'));
  put('face.pucker', score('mouthPucker'));
  // The model names eyes as it sees them. In a mirrored (selfie) picture its
  // "left" eye is the performer's right, the same swap the hands and arms get.
  put('face.blink.left', score(mirrored ? 'eyeBlinkRight' : 'eyeBlinkLeft'));
  put('face.blink.right', score(mirrored ? 'eyeBlinkLeft' : 'eyeBlinkRight'));
  const lm = face.landmarks;
  if (lm && lm.length > FACE.edgeB) {
    const nose = lm[FACE.nose];
    const width = Math.max(0.02, dist(lm[FACE.edgeA], lm[FACE.edgeB])), height = Math.max(0.02, dist(lm[FACE.top], lm[FACE.chin]));
    const centre = { x: (lm[FACE.edgeA].x + lm[FACE.edgeB].x) / 2, y: (lm[FACE.top].y + lm[FACE.chin].y) / 2 };
    put('face.x', nose.x);
    put('face.y', nose.y);
    put('face.near', width * 2.2);
    put('face.turn', 0.5 + ((nose.x - centre.x) / width) * 1.6);
    put('face.nod', 0.5 + ((nose.y - centre.y) / height) * 2.2);
    const a = lm[FACE.eyeA], c = lm[FACE.eyeB];
    const left = a.x < c.x ? a : c, right = a.x < c.x ? c : a;
    put('face.tilt', 0.5 + Math.atan2(right.y - left.y, right.x - left.x) / (Math.PI / 2));
  }
  return out;
}

function deriveHandSignals(timestamp: number, hands: WorkerHandResult[]): SignalFrame {
  if (!hands.length) {
    return { ...EMPTY_FRAME, timestamp, gestures: { 'gesture.right': '', 'gesture.left': '' } };
  }

  const values: Record<string, number> = {};
  const confidence: Record<string, number> = {};
  const gestures: Record<string, GestureName> = { 'gesture.right': '', 'gesture.left': '' };
  const handsOut: SignalFrame['hands'] = [];

  // Track palm centers for the two-hand distance calc
  let palmL: { x: number; y: number } | null = null;
  let palmR: { x: number; y: number } | null = null;

  for (const h of hands) {
    // MediaPipe handedness is from the model's POV — when the camera
    // image is mirrored (the usual default for selfie-style use) it
    // already reads left/right intuitively. We do NOT flip here; the
    // source layer toggles based on the user's mirror preference.
    const side = h.handedness === 'Left' ? 'left' : 'right';
    const lm = h.landmarks;
    if (!lm?.length) continue;

    // Palm center: MediaPipe landmark 0 is the wrist; the palm center
    // is closer to the average of landmarks 0, 5, 9, 13, 17 (wrist +
    // base of each finger). Average those for a stable position.
    const palm = avgLandmarks(lm, [0, 5, 9, 13, 17]);
    values[`palm.${side}.x`] = clamp01(palm.x);
    values[`palm.${side}.y`] = clamp01(palm.y);
    // z is signed in MediaPipe (camera-relative); map to 0..1 with 0.5
    // as "at the depth of the first frame's hand". Clamp the typical
    // ±0.5 range observed in practice.
    values[`palm.${side}.z`] = clamp01(0.5 + palm.z);
    confidence[`palm.${side}.x`] = h.handednessScore;
    confidence[`palm.${side}.y`] = h.handednessScore;
    confidence[`palm.${side}.z`] = h.handednessScore;
    (side === 'left' ? palmL = palm : palmR = palm);

    // Pinch: distance between thumb tip (4) and index tip (8). Hand
    // size proxy: wrist-to-middle-MCP distance (landmarks 0 and 9).
    // Without normalization, a small hand far away would read "always
    // pinched"; this scaling makes pinch invariant to depth.
    const handSize = Math.max(0.04, dist(lm[0], lm[9])); // floor avoids div-by-zero
    const pinchRaw = dist(lm[4], lm[8]);
    const pinchNorm = clamp01(pinchRaw / (handSize * 1.2)); // 1.2 calibrates so "fully open" reads ~1
    values[`pinch.${side}`] = pinchNorm;
    confidence[`pinch.${side}`] = h.handednessScore;

    // Spread: thumb tip (4) ↔ pinky tip (20). Same hand-size normalisation
    // as pinch — depth-invariant. Calibration: a closed fist reads ~0.25
    // and a fully splayed hand reads ~1.0 (clamped), so the 2.0 divisor
    // maps the natural human range to roughly 0..1.
    const spreadRaw = dist(lm[4], lm[20]);
    const spreadNorm = clamp01(spreadRaw / (handSize * 2.0));
    values[`spread.${side}`] = spreadNorm;
    confidence[`spread.${side}`] = h.handednessScore;

    // Gesture — drop 'None' to empty so consumers can detect "no
    // gesture this frame" cleanly.
    const g = h.gestureName === 'None' ? '' : (h.gestureName as GestureName);
    gestures[`gesture.${side}`] = g;
    confidence[`gesture.${side}`] = h.gestureScore;

    handsOut.push({ handedness: h.handedness, landmarks: lm });
  }

  if (palmL && palmR) {
    values['hands.distance'] = clamp01(dist(palmL, palmR));
    confidence['hands.distance'] = 1;
  }

  return { timestamp, values, gestures, confidence, hands: handsOut };
}

function avgLandmarks(lm: { x: number; y: number; z: number }[], idxs: number[]) {
  let x = 0, y = 0, z = 0;
  for (const i of idxs) { x += lm[i].x; y += lm[i].y; z += lm[i].z; }
  const n = idxs.length;
  return { x: x / n, y: y / n, z: z / n };
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

export const EMPTY_SIGNAL_FRAME: SignalFrame = EMPTY_FRAME;
