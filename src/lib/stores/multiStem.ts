// Multi-stem audio source state store. The MultiStemAnalyzer is a
// singleton (one stream-from-device shared by every visualizer), so
// this store mirrors its lifecycle and exposes start/stop + device
// enumeration helpers the panel UI binds to.

import { writable, get } from 'svelte/store';
import { multiStemAnalyzer, STEM_LAYOUTS, type StemLayout } from '../audio/multiStemAnalyzer';

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  /** True when the label contains a marker we recognise as a virtual
   *  multi-channel device (BlackHole, Loopback, etc.) — used by the UI
   *  to sort recommended devices first. */
  isVirtual: boolean;
}

interface MultiStemState {
  running: boolean;
  deviceId: string | null;
  layoutId: string | null;
  error: string | null;
}

const _state = writable<MultiStemState>({
  running: false,
  deviceId: null,
  layoutId: null,
  error: null,
});

function classifyVirtual(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('blackhole') || l.includes('loopback') || l.includes('soundflower') || l.includes('vb-audio');
}

export const multiStemStore = {
  subscribe: _state.subscribe,

  /** Get the singleton analyser for direct stem access (level meters etc.). */
  analyzer: multiStemAnalyzer,
  layouts: STEM_LAYOUTS,

  /** Enumerate available audio input devices. Sorts virtual multi-channel
   *  devices (BlackHole, Loopback) to the top — those are what someone
   *  setting up stem routing actually wants. */
  async listInputDevices(): Promise<AudioInputDevice[]> {
    try {
      // First call without permission usually returns devices with empty
      // labels. We let the caller deal with the prompt UX; we simply
      // surface what the browser gives us.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter(d => d.kind === 'audioinput')
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Input ${d.deviceId.slice(0, 6)}`,
          isVirtual: classifyVirtual(d.label),
        }));
      // Stable sort: virtual first, then alphabetical.
      inputs.sort((a, b) => {
        if (a.isVirtual !== b.isVirtual) return a.isVirtual ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
      return inputs;
    } catch {
      return [];
    }
  },

  /** Start the multi-stem analyser with the chosen device + layout. */
  async start(deviceId: string, layoutId: string): Promise<void> {
    const layout = STEM_LAYOUTS.find(l => l.id === layoutId);
    if (!layout) throw new Error(`Unknown stem layout: ${layoutId}`);
    try {
      await multiStemAnalyzer.start(deviceId, layout);
      _state.set({ running: true, deviceId, layoutId, error: null });
    } catch (e: any) {
      const msg = String(e?.message || e);
      _state.update(s => ({ ...s, error: msg, running: false }));
      throw e;
    }
  },

  async stop(): Promise<void> {
    await multiStemAnalyzer.stop();
    _state.set({ running: false, deviceId: null, layoutId: null, error: null });
  },

  /** Convenience accessor without subscribing. */
  snapshot(): MultiStemState { return get(_state); },

  /** Active layout (or null). Convenience for components that need the
   *  stem list without subscribing to the singleton analyser directly. */
  getLayout(): StemLayout | null { return multiStemAnalyzer.getLayout(); },
};
