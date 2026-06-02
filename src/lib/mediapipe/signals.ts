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
}

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
export function deriveSignals(timestamp: number, hands: WorkerHandResult[]): SignalFrame {
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
