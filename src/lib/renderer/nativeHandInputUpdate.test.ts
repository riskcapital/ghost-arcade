/**
 * The HandFX input pump sends only the buffers live input moves. It used to
 * build the whole graph every frame to pull them out; now it works out only
 * the inputs. What it sends must be exactly what a full build would have
 * given under the same ids, frame after frame, in every kind of mode.
 */
import { describe, expect, it } from 'vitest';
import { buildNativeHandInputUpdate, buildNativePluginGraph, type NativePluginGraphState } from './nativePluginGraphs';

const audio = { active: true, bass: 0.7, mid: 0.45, treble: 0.3, energy: 0.6, beatPhase: 0.25, beatPulse: 0.9, amplitude: 0.5 };
const pt = (i: number, t: number) => ({ x: 0.5 + 0.3 * Math.sin(i * 0.37 + t), y: 0.5 + 0.3 * Math.cos(i * 0.21 + t), z: 0.01 * i, visibility: 0.9 });
function frameAt(t: number, withFace: boolean) {
  return {
    timestamp: t * 1000, values: {}, confidence: {}, gestures: { 'gesture.right': '', 'gesture.left': '' } as any,
    hands: ['Left', 'Right'].map((handedness, k) => ({ handedness, landmarks: Array.from({ length: 21 }, (_, i) => pt(i + k * 21, t)) })),
    pose: Array.from({ length: 33 }, (_, i) => pt(i, t)),
    face: withFace ? Array.from({ length: 478 }, (_, i) => pt(i, t)) : undefined,
  };
}

/** The buffers a full build gives that the pump sends: uniform, hands or body, and the face wire when it changed. */
function inputBuffersOfFullBuild(config: any, before: NativePluginGraphState | null, after: NativePluginGraphState) {
  const topologyChanged = after.handField?.faceTopologyVersion !== before?.handField?.faceTopologyVersion;
  return (config.buffers as any[])
    .filter((b) => typeof b.initial_b64 === 'string' && (b.id.endsWith(':uniform') || b.id.endsWith(':landmarks') || b.id.endsWith(':body')
      || (topologyChanged && b.id.endsWith(':face-topology'))))
    .map((b) => ({ id: b.id, initialB64: b.initial_b64 }));
}

describe('HandFX input pump', () => {
  it.each([
    ['trails', 'live'], ['skeleton', 'live'], ['bridge', 'demo'],
    ['bodyswarm', 'live'], ['bodyflow', 'demo'], ['facemask', 'live'], ['facestream', 'demo'],
  ])('sends what a full build gives for %s (%s input), frame after frame', (mode, input) => {
    let fullState: NativePluginGraphState | null = null;
    let pumpState: NativePluginGraphState | null = null;
    for (let f = 0; f < 12; f++) {
      const t = 1 + f / 60;
      // The face arrives a few frames in, so its wire goes out then, once.
      const options = {
        sourceId: 'plugin:layer:handfx', params: { handfxMode: mode, handfxInput: input, handfxQuality: 'low' }, width: 1280, height: 720,
        time: t, frameDelta: 1 / 60, frameIndex: f, audio: f % 3 ? audio : { ...audio, active: false },
        handFrame: frameAt(t, f >= 4) as any, cameraMirror: f % 2 === 0, reset: false,
      };
      const full = buildNativePluginGraph({ ...options, kind: 'handfx', state: fullState });
      const pump = buildNativeHandInputUpdate({ ...options, state: pumpState });
      expect(pump.buffers).toEqual(inputBuffersOfFullBuild(full.config, fullState, full.state));
      expect(pump.state).toEqual(full.state);
      fullState = full.state;
      pumpState = pump.state;
    }
  });
});
