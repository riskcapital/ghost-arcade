// MediaPipe Svelte store. Wraps the singleton source + bus so UI can
// reactively show running state, latest signals, and bindings.

import { writable, get } from 'svelte/store';
import { mediaPipeSource, type MediaPipeStartOptions } from '../mediapipe/mediaPipeSource';
import { mediaPipeBus, type MediaPipeBinding } from '../mediapipe/mediaPipeBus';
import { SIGNAL_DEFS, type SignalFrame, EMPTY_SIGNAL_FRAME } from '../mediapipe/signals';

/** The panel's own hold on the camera. */
export const MEDIAPIPE_PANEL_CONSUMER = 'panel';

interface MediaPipeStoreState {
  running: boolean;
  starting: boolean;
  error: string | null;
  /** Who holds the camera, e.g. 'panel' or 'handfx-layers'. */
  consumers: string[];
  /** Turned off from the panel while HandFX layers still want it. */
  heldOff: boolean;
  /** Latest snapshot (continuous values + gestures + landmarks). */
  frame: SignalFrame;
  bindings: MediaPipeBinding[];
}

const _state = writable<MediaPipeStoreState>({
  running: false,
  starting: false,
  error: null,
  consumers: [],
  heldOff: false,
  frame: EMPTY_SIGNAL_FRAME,
  bindings: mediaPipeBus.list(),
});

// Running state comes from the source itself, so a camera started by a
// HandFX layer shows up here too.
mediaPipeSource.subscribeState(run => _state.update(s => ({
  ...s,
  running: run.running,
  starting: run.starting,
  error: run.error,
  consumers: run.consumers,
  heldOff: run.heldOff,
  frame: run.running ? s.frame : EMPTY_SIGNAL_FRAME,
})));
// Subscribe to source frames + bindings list to keep state in sync.
mediaPipeSource.subscribe(frame => _state.update(s => ({ ...s, frame })));
mediaPipeBus.subscribe(bindings => _state.update(s => ({ ...s, bindings })));

export const mediaPipeStore = {
  subscribe: _state.subscribe,
  signalDefs: SIGNAL_DEFS,
  source: mediaPipeSource,
  bus: mediaPipeBus,

  async listVideoInputs(): Promise<{ deviceId: string; label: string }[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 6)}` }));
    } catch { return []; }
  },

  /** Start from the panel. The panel holds the camera until stop(). */
  async start(opts: MediaPipeStartOptions = {}): Promise<void> {
    mediaPipeSource.acquire(MEDIAPIPE_PANEL_CONSUMER);
    try {
      await mediaPipeSource.start(opts);
    } catch (e) {
      mediaPipeSource.release(MEDIAPIPE_PANEL_CONSUMER);
      throw e;
    }
  },

  /** Turn the camera off, also for HandFX layers, until started again. */
  async stop(): Promise<void> {
    await mediaPipeSource.turnOff(MEDIAPIPE_PANEL_CONSUMER);
  },

  snapshot(): MediaPipeStoreState { return get(_state); },
};
