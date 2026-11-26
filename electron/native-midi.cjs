'use strict';

// Native MIDI host (main process). Owns the midi_addon session and forwards
// its messages and port changes to the renderer windows that started it.
//
// Message times leave here as epoch milliseconds (performance.timeOrigin +
// performance.now() on this process); the renderer subtracts its own
// timeOrigin, so they land on its performance.now() clock like Web MIDI's
// event.timeStamp.

const VIRTUAL_PORT_NAME = 'Ghost Arcade';

function envOptIn(env = process.env) {
  return env.GA_NATIVE_MIDI === '1' || env.GA_NATIVE_MIDI === 'true';
}

/**
 * @param {{
 *   loadAddon: () => any,
 *   loadError?: () => string | null,
 *   epochNow?: () => number,
 *   env?: Record<string, string | undefined>,
 * }} options
 */
function createNativeMidiHost({ loadAddon, loadError = () => null, epochNow, env = process.env }) {
  const now = epochNow || (() => performance.timeOrigin + performance.now());
  /** webContents (or anything with send/isDestroyed) that asked for MIDI. */
  const receivers = new Set();
  let addon = null;
  let running = false;
  let virtualPorts = false;

  const broadcast = (channel, payload) => {
    for (const wc of [...receivers]) {
      if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
        receivers.delete(wc);
        continue;
      }
      try { wc.send(channel, payload); } catch { receivers.delete(wc); }
    }
  };

  const ports = () => {
    if (!running || !addon) return { inputs: [], outputs: [] };
    try { return addon.ports(); } catch { return { inputs: [], outputs: [] }; }
  };

  const onEvent = (kind, payload) => {
    if (kind === 'ports') {
      broadcast('native-midi-ports', ports());
      return;
    }
    if (kind !== 'messages' || !Array.isArray(payload) || payload.length === 0) return;
    // Addon clock -> epoch, measured now: the delay before this ran does not matter.
    const offset = now() - addon.nowMs();
    const messages = new Array(payload.length);
    for (let i = 0; i < payload.length; i++) {
      const m = payload[i];
      messages[i] = { port: m.p, data: Uint8Array.from(m.d), t: m.t + offset };
    }
    broadcast('native-midi-messages', messages);
  };

  return {
    status() {
      const loaded = addon || loadAddon();
      return {
        available: !!loaded,
        error: loaded ? null : (loadError() || 'midi_addon not built'),
        envOptIn: envOptIn(env),
        running,
        virtualPortsSupported: !!loaded?.virtualPortsSupported,
      };
    },

    /** Start (once) and register the caller for events. */
    start(receiver) {
      if (!addon) addon = loadAddon();
      if (!addon) return { ok: false, error: loadError() || 'midi_addon not built' };
      if (receiver) {
        receivers.add(receiver);
        if (typeof receiver.once === 'function') receiver.once('destroyed', () => receivers.delete(receiver));
      }
      if (!running) {
        let result;
        try {
          result = addon.start(onEvent, { virtualName: VIRTUAL_PORT_NAME });
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
        if (!result?.ok) return { ok: false, error: result?.error || 'native MIDI failed to start' };
        running = true;
        virtualPorts = !!result.virtual;
        console.log(`[MIDI] Native backend started${virtualPorts ? ` with "${VIRTUAL_PORT_NAME}" virtual ports` : ''}`);
      }
      return { ok: true, virtual: virtualPorts, ports: ports() };
    },

    ports,

    send(id, data) {
      if (!running || !addon || typeof id !== 'string') return false;
      const bytes = data instanceof Uint8Array ? data : Array.isArray(data) ? Uint8Array.from(data) : null;
      if (!bytes) return false;
      try { return !!addon.send(id, bytes); } catch { return false; }
    },

    stop() {
      receivers.clear();
      if (!running || !addon) return;
      running = false;
      try { addon.stop(); } catch { /* quitting */ }
    },
  };
}

module.exports = { createNativeMidiHost, envOptIn, VIRTUAL_PORT_NAME };
