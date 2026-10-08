import type { InteractiveScene, Interaction } from './interactive';

export type PairedSession = {
  scene: InteractiveScene | null;
  active: boolean;
  paused: boolean;
  native: boolean | null;
  lastSent?: number;
  heartbeat?: ReturnType<typeof setInterval>;
  closed?: () => void;
};

// A session outlives its editor, but must never retain a closed connection.
const sessions = new WeakMap<WebSocket, PairedSession>();

export function pairedSessionFor(socket: WebSocket): PairedSession {
  let session = sessions.get(socket);
  if (!session) {
    session = { scene: null, active: false, paused: false, native: null };
    sessions.set(socket, session);
  }
  return session;
}

function stopHeartbeat(socket: WebSocket, session: PairedSession) {
  clearInterval(session.heartbeat);
  session.heartbeat = undefined;
  if (session.closed) socket.removeEventListener('close', session.closed);
  session.closed = undefined;
}

function maintainSession(socket: WebSocket, session: PairedSession) {
  if (!session.native || !session.active || socket.readyState !== WebSocket.OPEN) {
    stopHeartbeat(socket, session);
    return;
  }
  if (session.heartbeat) return;
  session.closed = () => {
    stopHeartbeat(socket, session);
    sessions.delete(socket);
  };
  socket.addEventListener('close', session.closed, { once: true });
  // Desktop expires remote sources after three seconds without an update.
  // Keep a launched scene alive between editors, without replaying touch input.
  session.heartbeat = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      stopHeartbeat(socket, session);
      sessions.delete(socket);
      return;
    }
    if (session.active && session.scene && performance.now() - (session.lastSent ?? 0) >= 1000) {
      socket.send(JSON.stringify({ type: 'studio_scene', scene: session.scene, inputs: [], active: true, paused: session.paused }));
      session.lastSent = performance.now();
    }
  }, 1000);
}

export function recordPairedScene(socket: WebSocket, scene: InteractiveScene, inputs: Interaction[], active: boolean, paused: boolean, native: boolean): PairedSession {
  const session = pairedSessionFor(socket);
  const wasActive = session.active;
  Object.assign(session, { scene, active, paused, native });
  // Opening an idle editor must not stop an existing desktop source. Explicit
  // active to stopped transitions are sent once; idle drafts stay on this device.
  if (native && socket.readyState === WebSocket.OPEN && (active || wasActive)) {
    socket.send(JSON.stringify({ type: 'studio_scene', scene, inputs, active, paused }));
    session.lastSent = performance.now();
  }
  maintainSession(socket, session);
  return session;
}
