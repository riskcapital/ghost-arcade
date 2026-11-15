'use strict';
const { tokensEqual } = require('./pairing.cjs');

const HOST_MESSAGES = new Set([
  'sync', 'library_sync', 'vj_clips_sync', 'compositions_sync', 'shader_library_sync',
  'beat_pulse', 'output_freeze_state', 'studio_scene_status', 'studio_capabilities',
  'studio_calibration_status', 'studio_scan_status', 'studio_depth_capture_status', 'studio_depth_scan_request', 'phone_camera_answer',
  'phone_vision_status', 'show_state',
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
// Scans sent from a phone to the desktop (src/lib/mobile/studio/scanTransfer.ts).
// The server only passes these on, between the phone that made the offer and
// the desktop. It still refuses anything that is plainly not one of the four
// messages, so a paired client cannot use the route to push arbitrary or
// oversized payloads at the desktop.
const SCAN_ID = /^[\w.:-]{1,128}$/;
const SCAN_MAX_BYTES = 64 * 1024 * 1024;
const SCAN_MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const SCAN_TERMINAL = new Set(['saved', 'declined', 'failed', 'aborted']);
const SCAN_STATES = new Set(['waiting', 'ready', 'progress', ...SCAN_TERMINAL]);
function scanMessageAllowed(msg) {
  if (!msg || typeof msg.requestId !== 'string' || !SCAN_ID.test(msg.requestId)) return false;
  switch (msg.type) {
    case 'studio_scan_offer':
      return typeof msg.name === 'string' && msg.name.length <= 300
        && Number.isInteger(msg.bytes) && msg.bytes > 0 && msg.bytes <= SCAN_MAX_BYTES
        && typeof msg.sha256 === 'string' && /^[0-9a-f]{64}$/.test(msg.sha256)
        && Number.isInteger(msg.chunkBytes) && msg.chunkBytes > 0 && msg.chunkBytes <= SCAN_MAX_CHUNK_BYTES;
    case 'studio_scan_chunk':
      return Number.isInteger(msg.index) && msg.index >= 0 && msg.index < 4096
        && typeof msg.data === 'string' && msg.data.length <= Math.ceil(SCAN_MAX_CHUNK_BYTES / 3) * 4 + 4;
    case 'studio_scan_abort':
      return true;
    case 'studio_scan_status':
      return SCAN_STATES.has(msg.state);
    default:
      return false;
  }
}
/** True when this message ends a scan transfer, so its route can be forgotten. */
function scanMessageEnds(msg) {
  return msg.type === 'studio_scan_abort' || (msg.type === 'studio_scan_status' && SCAN_TERMINAL.has(msg.state));
}
// A room scan for Depth mode (src/lib/mobile/studio/depthCaptureOffer.ts):
// one message from the phone, answered by the desktop. The desktop checks
// the scan itself; here only its size and shape, so the route cannot carry
// anything else.
const DEPTH_MAX_BYTES = 8000000;
const DEPTH_TERMINAL = new Set(['applied', 'declined', 'error']);
const DEPTH_STATES = new Set(['received', ...DEPTH_TERMINAL]);
const DEPTH_STAGES = new Set(['ready', 'measuring', 'patterns', 'solving', 'sending', 'cancelled', 'error']);
const shortText = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
/** `bytes` is the JSON size of the offer's capture. */
function depthMessageAllowed(msg, bytes) {
  if (!msg || typeof msg.requestId !== 'string' || !SCAN_ID.test(msg.requestId)) return false;
  switch (msg.type) {
    case 'studio_depth_capture_offer':
      return !!msg.capture && typeof msg.capture === 'object' && !Array.isArray(msg.capture)
        && Number.isFinite(bytes) && bytes > 0 && bytes <= DEPTH_MAX_BYTES;
    case 'studio_depth_capture_status':
      return DEPTH_STATES.has(msg.state) && shortText(msg.message, 500);
    // The desktop asks one phone for a scan (Interactive Studio, Depth setup).
    case 'studio_depth_scan_request':
      return typeof msg.to === 'string' && msg.to.length <= 120 && typeof msg.layerId === 'string' && msg.layerId.length <= 128
        && (msg.screenId === undefined || (typeof msg.screenId === 'string' && msg.screenId.length <= 128))
        && !!msg.output && Number.isInteger(msg.output.width) && Number.isInteger(msg.output.height)
        && msg.output.width > 0 && msg.output.width <= 32768 && msg.output.height > 0 && msg.output.height <= 32768;
    case 'studio_depth_scan_progress':
      return DEPTH_STAGES.has(msg.stage) && shortText(msg.message, 300)
        && (msg.pct === undefined || (typeof msg.pct === 'number' && msg.pct >= 0 && msg.pct <= 100));
    default:
      return false;
  }
}
/** True when the desktop's answer ends the scan's route. */
function depthMessageEnds(msg) {
  return (msg.type === 'studio_depth_capture_status' && DEPTH_TERMINAL.has(msg.state))
    || (msg.type === 'studio_depth_scan_progress' && (msg.stage === 'cancelled' || msg.stage === 'error'));
}
/** The phone app a capabilities request names, kept short and plain. */
function describeClient(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const part = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[^\w.+ -]/g, '').slice(0, 40) : '');
  const client = { app: part(raw.app), version: part(raw.version), build: part(raw.build), name: part(raw.name) };
  return client.app || client.version ? client : null;
}
module.exports = { HOST_MESSAGES, authorizedHost, isLoopback, permittedSource, scanMessageAllowed, scanMessageEnds, depthMessageAllowed, depthMessageEnds, describeClient };
