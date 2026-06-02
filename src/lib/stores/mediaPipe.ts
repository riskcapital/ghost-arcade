// MediaPipe Svelte store. Wraps the singleton source + bus so UI can
// reactively show running state, latest signals, and bindings.

import { writable, get } from 'svelte/store';
import { mediaPipeSource, type MediaPipeStartOptions } from '../mediapipe/mediaPipeSource';
import { mediaPipeBus, type MediaPipeBinding } from '../mediapipe/mediaPipeBus';
import { SIGNAL_DEFS, type SignalFrame, EMPTY_SIGNAL_FRAME } from '../mediapipe/signals';

interface MediaPipeStoreState {
  running: boolean;
  starting: boolean;
  error: string | null;
  /** Latest snapshot (continuous values + gestures + landmarks). */
  frame: SignalFrame;
  bindings: MediaPipeBinding[];
}

const _state = writable<MediaPipeStoreState>({
  running: false,
  starting: false,
  error: null,
  frame: EMPTY_SIGNAL_FRAME,
  bindings: mediaPipeBus.list(),
});

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

  async start(opts: MediaPipeStartOptions = {}): Promise<void> {
    _state.update(s => ({ ...s, starting: true, error: null }));
    try {
      await mediaPipeSource.start(opts);
      _state.update(s => ({ ...s, running: true, starting: false }));
    } catch (e: any) {
      _state.update(s => ({ ...s, running: false, starting: false, error: String(e?.message || e) }));
      throw e;
    }
  },

  async stop(): Promise<void> {
    await mediaPipeSource.stop();
    _state.update(s => ({ ...s, running: false, frame: EMPTY_SIGNAL_FRAME }));
  },

  snapshot(): MediaPipeStoreState { return get(_state); },
};
