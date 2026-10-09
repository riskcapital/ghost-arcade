// Media Library tab identities, shared by the tray UI (MediaTray.svelte) and
// control-path validation (controlPaths.ts) so a learnable `tray:tab:<arg>`
// path and a tab the tray can actually switch to never drift apart.

/** Tab order a controller steps through with `tray:tab` / `tray:tab:next|prev`. */
export const TRAY_TAB_ORDER = ['shaders', 'js', 'library', 'videos', 'images', 'sources', 'plugins'] as const;

export type TrayTab = typeof TRAY_TAB_ORDER[number];

/**
 * Short aliases a control path may name a tab by (`tray:tab:fx`), plus the
 * canonical names. Keep every key short enough to fit a controller overlay.
 */
export const TRAY_TAB_ALIASES: Record<string, TrayTab> = {
  fx: 'shaders', shaders: 'shaders',
  js: 'js',
  saved: 'library', library: 'library',
  vid: 'videos', videos: 'videos',
  img: 'images', images: 'images',
  src: 'sources', sources: 'sources',
  plug: 'plugins', plugins: 'plugins',
};

/** Args `tray:tab:<arg>` accepts: a relative step, or a tab to jump straight to. */
export const TRAY_TAB_ARGS: readonly string[] = ['next', 'prev', ...Object.keys(TRAY_TAB_ALIASES)];
