/**
 * mediaTrayShaders — singleton mirror of MediaTray.svelte's `shaders` list.
 *
 * Why this exists: MediaTray is the desktop's source of truth for which
 * shaders the user can pick (manifest catalog + AI-generated + user-imported
 * + cloud-synced). The same list needs to appear on the mobile companion's
 * shaders tab — including thumbnails — so the user sees identical options on
 * both surfaces. Without a shared store, App.svelte (which owns the WS pipe
 * to mobile) had no way to read MediaTray's local component state.
 *
 * MediaTray writes here every time its local `shaders` array changes
 * (manifest loaded, library hydrated, AI shader added, etc.). App.svelte
 * subscribes and broadcasts a trimmed payload to mobile via the
 * `shader_library_sync` WS message. The WS server caches the most recent
 * payload so freshly-connected mobiles get the list on first paint.
 *
 * Lifecycle: this is a single writable store at module scope so it survives
 * MediaTray remounts (user switching layers tears down + remounts the panel).
 * The cache on `window.__shaderCache` already provides the same survivability
 * for the in-component state; this store is the equivalent for the WS sync.
 */
import { writable } from 'svelte/store';

/**
 * Shape mirrors what mobile actually needs to render a thumbnail tile +
 * trigger the shader on a layer. Keeping it tight (no shader code, no input
 * defs) keeps the WS payload small — typical desktop libraries are 100+
 * shaders so 5KB per shader of metadata adds up fast.
 */
export interface MediaTrayShaderInfo {
  id: string;
  name: string;
  /** Either a real path (`./ISF/<file>.fs`) for manifest shaders, or the
   *  pseudo-URL `library-shader:<id>` for in-memory user-library shaders.
   *  The desktop's set_layer_source handler routes both shapes correctly. */
  src: string;
  /** Pre-generated thumbnail data URL or path. May be undefined for shaders
   *  that haven't had a thumbnail rendered yet — mobile shows the SVG
   *  fallback in that case. */
  thumbnail?: string;
  /** True for user-added (vs. built-in catalog) so mobile can sort or badge
   *  custom entries differently if needed. */
  custom?: boolean;
}

export const mediaTrayShaders = writable<MediaTrayShaderInfo[]>([]);
