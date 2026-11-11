'use strict';

/**
 * WLED links: one UDP socket per LED controller, that keeps sending through
 * a controller dropping off the network and picks it up again on its own.
 *
 * Each socket is connected to its controller (UDP connect only fixes the
 * destination; nothing is sent to set it up). A connected socket hears the
 * network's answer when nobody is there: "port unreachable" from a host
 * that is up but not listening, "host down" when the controller is powered
 * off or out of Wi-Fi range. That gives each controller a state:
 *
 *   unknown  nothing sent yet
 *   up       frames have gone out for `confirmMs` without an error
 *   down     a send failed; the socket is closed and made again after a
 *            short backoff (1 s, 2 s, 4 s, then every 5 s), which also
 *            picks up a changed local address after the network came back
 *
 * Sends keep coming from the renderer all the time (an unchanged frame is
 * repeated every second), so a controller that comes back gets frames
 * within a second or two and leaves its own effect for realtime mode again.
 *
 * A controller on another subnet, behind a router, gives no such answers:
 * it always looks up. Frames still go out and reach it when it is back.
 */

const nodeDgram = require('dgram');

const BACKOFF_MS = [1000, 2000, 4000, 5000];

function createWledLinks({ dgram = nodeDgram, now = () => Date.now(), onChange = null, confirmMs = 3000, maxInFlight = 2, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const links = new Map();

  function notify(link, extra = {}) {
    if (typeof onChange !== 'function') return;
    try {
      onChange({
        controllerId: link.controllerId,
        name: link.name,
        ip: link.ip,
        port: link.port,
        state: link.state,
        error: link.lastError,
        downSince: link.downSince,
        ...extra,
      });
    } catch { /* a listener failing must not stop the LEDs */ }
  }

  function closeSocket(link) {
    const sock = link.sock;
    link.sock = null;
    link.connected = false;
    link.inFlight = 0;
    if (sock) {
      try { sock.removeAllListeners('error'); sock.on('error', () => {}); } catch { /* ignore */ }
      try { sock.close(); } catch { /* already closed */ }
    }
  }

  function openSocket(link) {
    closeSocket(link);
    const sock = dgram.createSocket('udp4');
    link.sock = sock;
    link.connected = false;
    link.okSince = 0;
    sock.on('error', (err) => markError(link, sock, err));
    try {
      sock.connect(link.port, link.ip, (err) => {
        if (link.sock !== sock) return;
        if (err) { markError(link, sock, err); return; }
        link.connected = true;
      });
    } catch (err) {
      markError(link, sock, err);
    }
  }

  function markError(link, sock, err) {
    // An old socket (already closed after its first error, or replaced), or
    // a link closed meanwhile: its late errors count for nothing.
    if (link.sock !== sock || links.get(link.controllerId) !== link) return;
    const t = now();
    link.errors += 1;
    link.lastError = (err && (err.code || err.message)) || 'send failed';
    link.lastErrorAt = t;
    link.okSince = 0;
    closeSocket(link);
    if (link.state !== 'down') {
      link.state = 'down';
      link.downSince = t;
      link.attempt = 0;
      notify(link);
    }
    const delay = BACKOFF_MS[Math.min(link.attempt, BACKOFF_MS.length - 1)];
    link.attempt += 1;
    link.retryAt = t + delay;
    if (link.retryTimer) clearTimer(link.retryTimer);
    link.retryTimer = setTimer(() => {
      link.retryTimer = null;
      if (links.get(link.controllerId) === link && !link.sock) openSocket(link);
    }, delay);
    link.retryTimer?.unref?.();
  }

  function markOk(link) {
    const t = now();
    link.sent += 1;
    link.lastOkAt = t;
    if (!link.okSince) link.okSince = t;
    if (link.state !== 'up' && t - link.okSince >= confirmMs) {
      const was = link.state;
      const downFor = link.downSince ? t - link.downSince : 0;
      link.state = 'up';
      link.attempt = 0;
      notify(link, { previous: was, downForMs: downFor });
      link.downSince = 0;
    }
  }

  function ensure(controllerId, ip, port, name) {
    let link = links.get(controllerId);
    if (link && (link.ip !== ip || link.port !== port)) {
      // Address changed: a fresh link, as if new.
      close(controllerId);
      link = null;
    }
    if (!link) {
      link = {
        controllerId, name: name || controllerId, ip, port,
        sock: null, connected: false, inFlight: 0,
        state: 'unknown', downSince: 0, okSince: 0, lastOkAt: 0,
        lastError: null, lastErrorAt: 0, errors: 0, sent: 0,
        attempt: 0, retryAt: 0, retryTimer: null,
      };
      links.set(controllerId, link);
      openSocket(link);
    }
    if (name) link.name = name;
    return link;
  }

  /** Send one packet. Resolves { ok } and never rejects. */
  function send({ controllerId, ip, port, name, packet }) {
    const link = ensure(controllerId, ip, port, name);
    if (!link.sock) return Promise.resolve({ ok: false, error: link.lastError || 'reconnecting', reconnecting: true });
    if (!link.connected) return Promise.resolve({ ok: false, dropped: true });
    // Backpressure: dropping a realtime LED frame is invisible; a backlog is not.
    if (link.inFlight >= maxInFlight) return Promise.resolve({ ok: false, dropped: true });
    const sock = link.sock;
    link.inFlight += 1;
    return new Promise((resolve) => {
      try {
        sock.send(packet, (err) => {
          if (link.sock === sock) link.inFlight = Math.max(0, link.inFlight - 1);
          if (err) {
            markError(link, sock, err);
            resolve({ ok: false, error: err.code || err.message });
          } else {
            if (link.sock === sock) markOk(link);
            resolve({ ok: true });
          }
        });
      } catch (err) {
        markError(link, sock, err);
        resolve({ ok: false, error: (err && (err.code || err.message)) || 'send failed' });
      }
    });
  }

  function close(controllerId) {
    const link = links.get(controllerId);
    if (!link) return;
    if (link.retryTimer) clearTimer(link.retryTimer);
    closeSocket(link);
    links.delete(controllerId);
  }

  function closeAll() {
    for (const id of Array.from(links.keys())) close(id);
  }

  function list() {
    return Array.from(links.values()).map((l) => ({
      controllerId: l.controllerId,
      name: l.name,
      ip: l.ip,
      port: l.port,
      state: l.state,
      downSince: l.downSince || null,
      lastOkAt: l.lastOkAt || null,
      lastError: l.lastError,
      errors: l.errors,
      sent: l.sent,
    }));
  }

  return { send, close, closeAll, list, size: () => links.size };
}

module.exports = { createWledLinks, BACKOFF_MS };
