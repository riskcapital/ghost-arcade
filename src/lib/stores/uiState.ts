/**
 * Cross-component UI state.
 *
 * Lives outside any single component so children deep in the tree (e.g.
 * SettingsPanel, top bar) can flip global modals open without prop-drilling.
 */

import { writable } from 'svelte/store';

/** Update-available modal — opened from Settings update banner. */
export const updateModalOpen = writable<boolean>(false);
