/**
 * Sends the phone's Flux pad to a paired desktop, which applies the same
 * effect to its outputs. Messages are held to about thirty a second while a
 * finger moves, and a short heartbeat repeats the current state while Flux
 * is on: the desktop switches Flux off by itself if the phone goes quiet, so
 * a dropped connection never leaves an effect stuck on a projector.
 */
import type { FluxState } from './flux';

const SPACING_MS = 33;
const HEARTBEAT_MS = 1500;

export function fluxMessage(state: FluxState) {
  return { type: 'studio_flux', x: state.x, y: state.y, energy: state.energy || 0, mix: state.mix, blend: state.blend || 0, active: state.active && state.modules.length > 0, beat: state.beat, modules: state.modules };
}

export function createFluxLink(socket: Pick<WebSocket, 'readyState' | 'send'>, now: () => number = () => performance.now()) {
  let latest: FluxState | null = null;
  let lastSent = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const push = () => {
    trailing = undefined;
    if (!latest || socket.readyState !== 1) return;
    lastSent = now();
    socket.send(JSON.stringify(fluxMessage(latest)));
  };
  const beat = (on: boolean) => {
    if (on && !heartbeat) heartbeat = setInterval(push, HEARTBEAT_MS);
    if (!on && heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
  };
  return {
    /** The pad or a control changed. */
    send(state: FluxState) {
      latest = state;
      beat(state.active);
      const wait = SPACING_MS - (now() - lastSent);
      // Releasing must never wait behind the rate limit: the effect would hang on for a frame.
      if (wait <= 0 || !state.active) { clearTimeout(trailing); push(); }
      else if (!trailing) trailing = setTimeout(push, wait);
    },
    /** Leaving the page or the connection: Flux goes off on the desktop. */
    stop() {
      clearTimeout(trailing); trailing = undefined; beat(false);
      if (latest?.active) { latest = { ...latest, active: false, latch: false }; push(); }
    },
  };
}
