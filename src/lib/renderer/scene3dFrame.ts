/**
 * The scene frame block: one uniform buffer the render core writes every frame
 * for an Interactive 3D (`scene3d`) layer. A scene graph declares it with
 * `scene3dFrameBuffer()` and reads it in WGSL as `SCENE3D_FRAME_WGSL`.
 *
 * The layout is owned by `native-renderer/src/scene_frame.rs`; this copy is
 * checked against it by `scene3dFrame.test.ts`. Add fields at the end only.
 */

export const SCENE3D_FRAME_BUFFER_SUFFIX = ':scene3d:frame';

export const SCENE3D_FRAME_FIELDS = [
  'time',
  'delta',
  'frame',
  'audio_active',
  'bass',
  'mid',
  'treble',
  'energy',
  'beat',
  'kick',
  'snare',
  'centroid',
  'tempo',
  'beat_phase',
  'bar_phase',
  'beats',
] as const;

export type Scene3DFrameField = (typeof SCENE3D_FRAME_FIELDS)[number];

export const SCENE3D_FRAME_BYTES = SCENE3D_FRAME_FIELDS.length * 4;

/** Float slot of each field. */
export const SCENE3D_FRAME_SLOT = Object.fromEntries(
  SCENE3D_FRAME_FIELDS.map((field, slot) => [field, slot]),
) as Record<Scene3DFrameField, number>;

/** The block as a WGSL struct, for scene shaders to bind as a uniform. */
export const SCENE3D_FRAME_WGSL = `struct SceneFrame {
${SCENE3D_FRAME_FIELDS.map((field) => `  ${field}: f32,`).join('\n')}
}`;

/**
 * The frame block buffer for a scene graph. It starts zeroed; the core fills
 * it before every frame the layer draws. `prefix` keeps ids unique per layer.
 */
export function scene3dFrameBuffer(prefix: string) {
  return {
    id: `${prefix}${SCENE3D_FRAME_BUFFER_SUFFIX}`,
    kind: 'uniform' as const,
    byte_length: SCENE3D_FRAME_BYTES,
    initial_b64: btoa(String.fromCharCode(...new Uint8Array(SCENE3D_FRAME_BYTES))),
  };
}
