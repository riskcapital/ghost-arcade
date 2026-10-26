'use strict';

/**
 * macOS: the render core raises its output window when it is shown or
 * reconfigured, and does so by activating its own process. That takes the
 * menu bar away from Ghost Arcade: the editor loses focus and the menus stay
 * empty until the user clicks back into it.
 *
 * Raising matters only when the output shares the editor's display (the core
 * window could otherwise stay hidden behind the editor). When it is on
 * another display, or is the editor's own underlay preview, the editor takes
 * focus straight back, but only if it had focus before the call.
 */

function isShown(config) {
  const shown = config.attached ?? config.visible ?? config.enabled;
  return shown !== false;
}

function outputRect(config) {
  const { x, y, width, height } = config;
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * @param {object} input
 * @param {string} input.platform process.platform
 * @param {object|null|undefined} input.config the output window config sent to the core
 * @param {boolean} input.editorWasFocused a Ghost Arcade window had focus before the call
 * @param {boolean|null} input.sameDisplay output on the editor's display; null when unknown
 */
function shouldRestoreEditorFocus({ platform, config, editorWasFocused, sameDisplay }) {
  if (platform !== 'darwin' || !editorWasFocused) return false;
  if (!config || typeof config !== 'object' || !isShown(config)) return false;
  if (config.underlay === true || config.always_on_bottom === true) return true;
  return sameDisplay === false;
}

/**
 * Whether the output rect is on the editor window's display, using
 * Electron's `screen`. Null when the config carries no rect.
 */
function outputOnEditorDisplay(screen, editorBounds, config) {
  const rect = config && typeof config === 'object' ? outputRect(config) : null;
  if (!rect || !editorBounds || !screen?.getDisplayMatching) return null;
  try {
    return screen.getDisplayMatching(rect).id === screen.getDisplayMatching(editorBounds).id;
  } catch {
    return null;
  }
}

module.exports = { shouldRestoreEditorFocus, outputOnEditorDisplay };
