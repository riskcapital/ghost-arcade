'use strict';
const { tokensEqual } = require('./pairing.cjs');

const HOST_MESSAGES = new Set([
  'sync', 'library_sync', 'vj_clips_sync', 'compositions_sync', 'shader_library_sync',
  'beat_pulse', 'output_freeze_state', 'studio_scene_status', 'studio_capabilities',
  'studio_calibration_status', 'phone_camera_answer', 'phone_vision_status',
]);
const BUNDLED_SHADER = /^(\.?\/)?ISF\/([^/\\?#:]+\/)*[^/\\?#:]+\.fs$/;
function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function authorizedHost(secret, presented, address) {
  return isLoopback(address) && tokensEqual(secret, presented);
}
function permittedSource(msg, media, shaders) {
  if (typeof msg.sourceSrc !== 'string' || typeof msg.layerId !== 'string') return false;
  if (msg.sourceType === 'color') return /^#[\da-f]{6}([\da-f]{2})?$/i.test(msg.sourceSrc);
  // A phone selects a source the desktop has advertised. It cannot turn a
  // shader trigger into a fetch of an arbitrary URL or introduce executable JS.
  // Phones without the desktop's shader list yet (app 1.0 falls back to the
  // bundled manifest) send a path inside the app's own ISF folder.
  if (msg.sourceType === 'shader' && BUNDLED_SHADER.test(msg.sourceSrc) && !msg.sourceSrc.includes('..')) return true;
  const catalog = msg.sourceType === 'shader' ? shaders : media;
  return ['shader', 'video', 'image', 'threejs'].includes(msg.sourceType)
    && Array.isArray(catalog) && catalog.some(item => item?.src === msg.sourceSrc);
}
module.exports = { HOST_MESSAGES, authorizedHost, isLoopback, permittedSource };
