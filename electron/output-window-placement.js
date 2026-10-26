/**
 * Where the render core's Live Output window goes, in units the core can
 * place without guessing.
 *
 * The renderer sends Electron display bounds, which are DIPs. The core used
 * to hand them to winit as logical units, and winit converts those with the
 * scale of the monitor the window is on at that moment, not the one it is
 * going to. With a 150% laptop panel and a 100% projector the window landed
 * offset or off the projector entirely. On Windows the rect is converted here
 * with Electron's own DIP-to-screen mapping, which knows every display's
 * scale and origin, and the core places it in physical pixels.
 */

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} config
 * @param {(rect: {x: number, y: number, width: number, height: number}) => {x: number, y: number, width: number, height: number}} dipToScreenRect
 */
export function physicalOutputWindowConfig(config, dipToScreenRect) {
  if (!config || typeof config !== 'object' || typeof dipToScreenRect !== 'function') return config;
  if (config.coordinate_space === 'physical') return config;
  const x = finite(config.x);
  const y = finite(config.y);
  const width = finite(config.width);
  const height = finite(config.height);
  // A detach, a title change, or a partial update carries no rect to convert.
  if (x === null || y === null || width === null || height === null) return config;
  const physical = dipToScreenRect({ x, y, width, height });
  if (!physical || ![physical.x, physical.y, physical.width, physical.height].every(Number.isFinite)) return config;
  return {
    ...config,
    x: Math.round(physical.x),
    y: Math.round(physical.y),
    width: Math.max(1, Math.round(physical.width)),
    height: Math.max(1, Math.round(physical.height)),
    coordinate_space: 'physical',
  };
}

/** Rewrite a `native_renderer_set_output_window` IPC payload ({ config }). */
export function physicalOutputWindowArgs(args, dipToScreenRect) {
  if (!args || typeof args !== 'object' || !args.config) return args;
  const config = physicalOutputWindowConfig(args.config, dipToScreenRect);
  return config === args.config ? args : { ...args, config };
}
