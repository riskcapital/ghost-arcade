'use strict';

/**
 * Quitting asks the editor first.
 *
 * Cmd+Q (and Quit in the Dock, and logging out) went straight to
 * cleanupAndQuit(), which ends with app.exit(): the window never closes
 * normally, so the editor's "Save changes?" prompt never ran and unsaved
 * work was lost. Now a quit is held while the editor is asked. The editor
 * acknowledges at once, then either says to go ahead (nothing unsaved, or
 * the user chose Save or Don't Save) or that the user cancelled.
 *
 * An editor that does not acknowledge within `ackTimeoutMs` is hung or gone,
 * and the quit goes ahead rather than never happening. Once acknowledged
 * there is no timeout: the user may take as long as they like to decide.
 *
 *   ask()  sends the request to the editor; false when there is no editor
 *          to ask, in which case the quit is not held.
 *   quit() carries out the quit.
 */
function createQuitGuard({ ask, quit, ackTimeoutMs = 3000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = 'idle'; // 'idle' | 'asked' | 'deciding' | 'confirmed'
  let timer = null;

  const stopTimer = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };

  return {
    /** Call from before-quit. True: hold the quit, the editor is deciding. */
    shouldHoldQuit() {
      if (state === 'confirmed') return false;
      if (state === 'asked' || state === 'deciding') return true;
      let asked = false;
      try { asked = !!ask(); } catch { asked = false; }
      if (!asked) return false;
      state = 'asked';
      timer = setTimer(() => {
        timer = null;
        if (state !== 'asked') return;
        state = 'confirmed';
        quit();
      }, ackTimeoutMs);
      timer?.unref?.();
      return true;
    },

    /** The editor received the request and is deciding. */
    acknowledged() {
      if (state !== 'asked') return;
      stopTimer();
      state = 'deciding';
    },

    /** The editor says go ahead. */
    proceed() {
      if (state === 'confirmed') return;
      stopTimer();
      state = 'confirmed';
      quit();
    },

    /** The user cancelled; the app keeps running. */
    cancel() {
      if (state === 'confirmed') return;
      stopTimer();
      state = 'idle';
    },

    get state() { return state; },
  };
}

module.exports = { createQuitGuard };
