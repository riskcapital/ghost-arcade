/**
 * Workspace mode flag — which fullscreen overlay (if any) is currently
 * occupying the user's view.
 *
 *   'main'  — default mapping canvas.
 *   'vj'    — VJModePanel overlay (legacy: still mirrored by
 *             vjClipLauncher.isOpen for back-compat).
 *   'stage' — StageDesignerPanel overlay (Phase 1+).
 *   'projection-sim' — 3D projection simulator for mapping practice.
 *
 * Two reasons this exists as its own store instead of a flag on
 * vjClipLauncher:
 *
 *  1. The two overlays are mutually exclusive — they're both
 *     `position: fixed; inset: 0; z-index: 999` panels, and having
 *     two open at once is a "why is the canvas dark" bug class waiting
 *     to happen. A single enum guarantees mutual exclusion by type,
 *     not by every callsite remembering to close the other panel first.
 *  2. The StageDesigner is conceptually separate from the VJ clip
 *     launcher — putting its open/close on `vjClipLauncher` would tie
 *     two unrelated subsystems together.
 *
 * `vjClipLauncher.setOpen()` writes through to this store (see that
 * file) so legacy callers stay consistent — anyone calling the new
 * helpers here gets the inverse sync as well.
 */

import { writable, get } from 'svelte/store';

export type Workspace = 'main' | 'vj' | 'stage' | 'projection-sim';

function createWorkspaceStore() {
  const { subscribe, set, update } = writable<Workspace>('main');

  return {
    subscribe,

    /** Switch to a workspace. When leaving 'vj', this also flips
     *  vjClipLauncher.isOpen to false so the legacy isOpen-reading
     *  code (KeyframeTimeline.svelte etc.) stays in sync. */
    setActive(next: Workspace) {
      const prev = get({ subscribe });
      if (prev === next) return;
      set(next);
      // Late-bound dynamic import to dodge the circular dep —
      // vjClipLauncher imports this store (it calls setActive on
      // setOpen), so importing the other way at module load time
      // creates a cycle.  Dynamic import resolves only when the
      // workspace actually transitions away from VJ.
      if (prev === 'vj' && next !== 'vj') {
        void import('./vjClipLauncher').then(({ vjClipLauncher }) => {
          // Pass `{ fromWorkspace: true }` so vjClipLauncher.setOpen
          // doesn't call back into setActive and ping-pong.
          (vjClipLauncher as any).setOpen(false, { fromWorkspace: true });
        });
      }
    },

    openVJ()    { this.setActive('vj'); },
    openStage() { this.setActive('stage'); },
    openProjectionSim() { this.setActive('projection-sim'); },
    closeAll()  { this.setActive('main'); },
  };
}

export const workspace = createWorkspaceStore();
