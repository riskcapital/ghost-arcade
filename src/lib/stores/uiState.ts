/**
 * Cross-component UI state.
 *
 * Lives outside any single component so children deep in the tree (e.g.
 * SettingsPanel, top bar) can flip global modals open without prop-drilling.
 */

import { writable } from 'svelte/store';

/** Update-available modal — opened from Settings update banner. */
export const updateModalOpen = writable<boolean>(false);

/** Active tab in the left sidebar. 'layers' shows the layer
 *  hierarchy + per-layer effect chain (LayerPanel). 'screens' shows
 *  output Screens with warp/blend/effects (ScreenPanel) and enables
 *  the on-canvas warp-handle overlay so the user can re-align a
 *  projector that got bumped. */
export type LeftSidebarTab = 'layers' | 'screens';
export const leftSidebarTab = writable<LeftSidebarTab>('layers');
