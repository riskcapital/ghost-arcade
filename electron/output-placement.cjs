'use strict';
// Where output and Screen windows go, and how they get there.
//
// Two things went wrong before:
//
// - The editor stages a window's placement with `configure_next_output_window`
//   and then calls `window.open`. The staged placement was a single slot shared
//   by the output and every Screen, so two windows opened close together (a
//   Screen while the output reopened, or Fullscreen right after closing the
//   preview) could take each other's display. Placements are now keyed by the
//   window name the editor passes to `window.open`, and each one is used once.
//
// - Windows were built with `fullscreen: true` and the target x/y in the
//   constructor. On Windows a window that goes fullscreen while it is being
//   created takes the display it was created on, which is not always the one
//   its x/y point at (scaling differences between displays move it), so the
//   output came up fullscreen on the main display. Windows are now created
//   hidden, moved onto the target display, shown, and only then made
//   fullscreen; the display they ended up on is checked and corrected.

const DEFAULT_TTL_MS = 10000;
/** Key for a placement staged without a window name (older callers). */
const UNNAMED = '';

/**
 * Placements staged by the editor, waiting for the window they belong to.
 * `now` is injectable for tests.
 */
function createPendingWindowConfigs({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const pending = new Map();

  function purge() {
    const t = now();
    for (const [key, entry] of pending) {
      if (t - entry.at > ttlMs) pending.delete(key);
    }
  }

  return {
    /** Stage a placement. `config.name` is the window name passed to window.open. */
    stage(config) {
      purge();
      if (!config || typeof config !== 'object') return;
      const key = typeof config.name === 'string' ? config.name : UNNAMED;
      pending.set(key, { config: { ...config }, at: now() });
    },
    /**
     * The placement for the window named `frameName`, removed so it is used
     * once. An unnamed placement is only handed to a window nobody staged a
     * named placement for.
     */
    take(frameName) {
      purge();
      const key = typeof frameName === 'string' ? frameName : UNNAMED;
      const named = pending.get(key);
      if (named) {
        pending.delete(key);
        return named.config;
      }
      const unnamed = pending.get(UNNAMED);
      if (unnamed) {
        pending.delete(UNNAMED);
        return unnamed.config;
      }
      return null;
    },
    get size() {
      purge();
      return pending.size;
    },
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
}

/**
 * Bounds for an output window on `display`: the display's whole area when
 * fullscreen, otherwise the requested size (clamped) at the requested
 * position, or centred on the display. A requested position that lies on
 * another display is ignored, so a stale x/y cannot move the window off the
 * display it was meant for.
 */
function outputWindowBounds(display, config = {}) {
  const b = display.bounds;
  if (config.fullscreen) return { x: b.x, y: b.y, width: b.width, height: b.height };
  const width = Math.min(b.width, clampInt(config.width, 320, 8192, 1280));
  const height = Math.min(b.height, clampInt(config.height, 240, 8192, 720));
  let x = Number.isFinite(Number(config.x)) ? Math.round(Number(config.x)) : null;
  let y = Number.isFinite(Number(config.y)) ? Math.round(Number(config.y)) : null;
  const cx = x == null ? null : x + width / 2;
  const cy = y == null ? null : y + height / 2;
  const onDisplay = cx != null && cy != null
    && cx >= b.x && cx < b.x + b.width && cy >= b.y && cy < b.y + b.height;
  if (!onDisplay) {
    x = Math.round(b.x + (b.width - width) / 2);
    y = Math.round(b.y + (b.height - height) / 2);
  }
  return { x, y, width, height };
}

/**
 * The display a fullscreen output should take when the editor named none or
 * named one that is gone: the first display that is not the main one. Null
 * when only the main display is connected.
 */
function firstExternalDisplay(displays, primary) {
  return displays.find((d) => d.id !== primary.id) || null;
}

module.exports = {
  createPendingWindowConfigs,
  outputWindowBounds,
  firstExternalDisplay,
};
