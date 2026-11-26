/**
 * GPU-side frames for the offscreen three.js / p5 hosts (macOS, opt-in).
 *
 * By default a host's paint becomes a bitmap in this process, a temp file,
 * and a texture upload in the core: about 8 MB of copies per 1080p frame.
 * With GA_JS_HOST_SHARED_TEXTURE=1 a host paints into a shared texture
 * instead. Chromium's IOSurface is local to this process, so the
 * js_frame_ring addon copies it on the GPU into one of a few global
 * IOSurfaces, and the core imports that one by its ID.
 *
 * Any failure goes back to bitmaps: no addon, a core that cannot import or
 * report a frame it could not open, or frames that keep failing (then every
 * host after it uses bitmaps too, for the rest of the session).
 */

export const SHARED_TEXTURE_ENV = 'GA_JS_HOST_SHARED_TEXTURE';
// Copies and uploads in flight are capped at two by the host, so with four
// surfaces the one being written was handed to the core at least two
// answered frames ago.
export const RING_SLOTS = 4;
// Failed frames in a row before a host goes back to bitmaps.
export const FAILURE_LIMIT = 3;

/** The core command for a frame in a ring surface. */
export function sharedFrameCommand({ sourceId, seq, surfaceId, width, height }) {
  return {
    type: 'upload_source_frame',
    source_id: sourceId,
    seq,
    width,
    height,
    shared_handle: String(surfaceId),
    shared_texture_platform: 'iosurface',
    shared_texture_format: 'bgra8unorm',
    shared_texture_handle_encoding: 'integer',
  };
}

/** The core's answer to a submit says it could not open the frame. */
export function submitRejectedFrame(result) {
  return !!result && typeof result === 'object' && Array.isArray(result.errors)
    && result.errors.some((error) => error?.type === 'upload_source_frame');
}

/** What of a paint's texture to copy: its visible rectangle and format. */
export function paintFrame(textureInfo) {
  const coded = textureInfo?.codedSize ?? {};
  const visible = textureInfo?.visibleRect ?? {};
  const width = Math.round(Number(visible.width ?? coded.width) || 0);
  const height = Math.round(Number(visible.height ?? coded.height) || 0);
  const handle = textureInfo?.handle?.ioSurface;
  if (!width || !height || !handle || handle.length < 8) return null;
  return {
    handle,
    x: Math.max(0, Math.round(Number(visible.x) || 0)),
    y: Math.max(0, Math.round(Number(visible.y) || 0)),
    width,
    height,
    pixelFormat: typeof textureInfo.pixelFormat === 'string' ? textureInfo.pixelFormat : 'bgra',
  };
}

export function createSharedFrames({ env = process.env, platform = process.platform, loadAddon, getCapabilities, log = console }) {
  let addon = null;
  let addonTried = false;
  let addonError = null;
  let disabledReason = null;

  function loadedAddon() {
    if (addonTried) return addon;
    addonTried = true;
    try {
      const loaded = loadAddon?.() ?? null;
      if (!loaded || typeof loaded.JsFrameRing !== 'function') {
        addonError = 'js_frame_ring_addon.node is not built';
      } else if (typeof loaded.available === 'function' && !loaded.available()) {
        addonError = `js_frame_ring_addon has no GPU: ${loaded.lastError?.() || 'unknown'}`;
      } else {
        addon = loaded;
      }
    } catch (err) {
      addonError = String(err?.message || err);
    }
    if (!addon && env[SHARED_TEXTURE_ENV] === '1') log.warn?.(`[JsSource] shared textures off: ${addonError}`);
    return addon;
  }

  /** Why a new host would paint bitmaps, or null when it can use textures. */
  function unavailableReason() {
    if (env[SHARED_TEXTURE_ENV] !== '1') return 'not enabled';
    if (platform !== 'darwin') return 'macOS only';
    if (disabledReason) return disabledReason;
    if (!loadedAddon()) return addonError;
    const features = getCapabilities?.()?.features ?? {};
    if (features.shared_texture_source_frame_upload !== true) return 'the render core cannot import shared textures';
    if (features.shared_texture_source_frame_errors !== true) return 'the render core does not report shared-texture failures';
    return null;
  }

  function createRing() {
    return addon ? new addon.JsFrameRing({ slots: RING_SLOTS }) : null;
  }

  /** Every host opened from now on paints bitmaps. */
  function disable(reason) {
    if (disabledReason) return;
    disabledReason = String(reason || 'failed');
    log.warn?.(`[JsSource] shared textures off for this session: ${disabledReason}`);
  }

  function status() {
    return { wanted: env[SHARED_TEXTURE_ENV] === '1', unavailable: unavailableReason(), disabled: disabledReason };
  }

  return { unavailableReason, createRing, disable, status };
}
