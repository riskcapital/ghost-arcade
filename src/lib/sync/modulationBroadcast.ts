// Modulation map broadcast: editor → output windows
//
// Why this exists:
//   The OSR / Spout output window mounts its own Canvas and re-runs the
//   render pipeline against state synced from the editor. Audio analysis
//   data already crosses via audioBroadcast, so the OSR window's
//   `audioStore.isActive` is true with live FFT / bands. But the
//   `modulationStore` (which maps "layer N + param X → audio source") was
//   never broadcast, so the OSR window's modulationEngine had nothing to
//   tick over and modulated shader / effect values stayed at their
//   un-modulated baseline. The user-visible symptom: in-app shader
//   reacts to the kick, projector shows the same shader frozen at its
//   manual slider value.
//
//   Fix: editor subscribes to modulationStore and posts the entries
//   (debounced ~33ms — modulation map changes are slider events, not
//   audio-rate). OSR window listens, bulkLoads the entries into its own
//   store, and starts the engine if not already running. Both windows
//   then independently compute the same modulated values from the same
//   modulation rules + audio data, in parallel.
//
//   Cost: a few hundred bytes per change, only when the user actually
//   toggles a modulation source / amount / speed. The per-frame audio
//   data still flows through audioBroadcast.

import { get } from 'svelte/store';
import { modulationStore, modulationEngine, type ParamModulation } from '$lib/audio/modulation';

const CHANNEL_NAME = 'ghostarcade-modulation-sync';

// ---- Editor side ----

let senderChannel: BroadcastChannel | null = null;
let storeUnsub: (() => void) | null = null;
let pendingBroadcast: ReturnType<typeof setTimeout> | null = null;
const BROADCAST_DEBOUNCE_MS = 33;

/** Start broadcasting modulation state. Call once from the editor.
 *  Idempotent. */
export function startModulationBroadcast(): void {
  if (senderChannel) return;
  try {
    senderChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch (err) {
    console.warn('[ModSync] BroadcastChannel unavailable:', err);
    return;
  }
  storeUnsub = modulationStore.subscribe(() => {
    if (pendingBroadcast) return;
    pendingBroadcast = setTimeout(() => {
      pendingBroadcast = null;
      flushBroadcast();
    }, BROADCAST_DEBOUNCE_MS);
  });
  console.log('[ModSync] Editor: broadcasting modulation map');
}

/** Stop broadcasting. Closes the channel and unsubscribes. */
export function stopModulationBroadcast(): void {
  if (storeUnsub) { storeUnsub(); storeUnsub = null; }
  if (pendingBroadcast) { clearTimeout(pendingBroadcast); pendingBroadcast = null; }
  if (senderChannel) { try { senderChannel.close(); } catch { /* */ } senderChannel = null; }
}

function flushBroadcast(): void {
  if (!senderChannel) return;
  const map = get(modulationStore);
  const entries: Array<{ key: string; mod: ParamModulation }> = [];
  for (const [key, mod] of map.entries()) entries.push({ key, mod });
  try {
    senderChannel.postMessage({ type: 'mod-state', entries });
  } catch (err) {
    console.warn('[ModSync] broadcast failed:', err);
  }
}

// ---- Receiver side ----

let receiverChannel: BroadcastChannel | null = null;

/** Start receiving modulation maps. Call once from output / OSR windows.
 *  Returns a stop function. When the first non-empty map arrives, also
 *  starts the local modulationEngine so the OSR window animates in
 *  lockstep with the editor. */
export function startModulationBroadcastReceiver(): () => void {
  if (receiverChannel) return () => {};
  try {
    receiverChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch (err) {
    console.warn('[ModSync] BroadcastChannel unavailable on receiver:', err);
    return () => {};
  }
  const ch = receiverChannel;
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.type !== 'mod-state') return;
    try {
      const entries = Array.isArray(m.entries) ? m.entries : [];
      modulationStore.bulkLoad(entries);
      // Start the engine once we have something to tick. Subsequent
      // bulkLoads keep the engine running — start() is a no-op when
      // already running.
      if (entries.length > 0 && !modulationEngine.running) {
        modulationEngine.start();
      }
    } catch (err) {
      console.error('[ModSync] receiver apply failed:', err);
    }
  };
  console.log('[ModSync] Receiver started');
  return () => {
    try { ch.close(); } catch { /* */ }
    if (receiverChannel === ch) receiverChannel = null;
  };
}
