// Art-Net / sACN pixel-mapping output for the Electron main process.
//
// The renderer samples the composition and packs whole DMX universes; this
// module validates them, applies the frame-rate cap and backpressure, keeps
// per-universe sequence numbers, and sends everything from one UDP socket.
// Nothing here blocks: sends are queued on the socket and a frame that
// arrives while the previous one is still draining is dropped and counted.
//
// Stopping is explicit. A universe that disappears from the frame (fixture
// disabled or removed) and every universe on stop() receives one black frame;
// sACN universes then receive three Stream_Terminated packets (E1.31 6.2.6)
// so receivers release the source instead of waiting for the timeout.

const net = require('node:net');
const packets = require('./pixelmap-packets.cjs');

const DEFAULT_FPS = 40;
const MAX_FPS = 60;
const MAX_UNIVERSES_PER_FRAME = 1024;
// Token bucket: the long-run rate never exceeds the frame rate, but a
// frame that arrives early after a late one (renderer timer jitter) is
// still accepted. At most two frames of credit are banked.
const RATE_BURST = 2;
const SACN_TERMINATION_PACKETS = 3;

function isValidHost(host) {
  return typeof host === 'string' && net.isIPv4(host) && host !== '0.0.0.0';
}

function clampFps(fps) {
  const value = Number(fps);
  if (!Number.isFinite(value)) return DEFAULT_FPS;
  return Math.max(1, Math.min(MAX_FPS, Math.round(value)));
}

/** Validate a renderer frame. Throws with a user-readable message. */
function normalizeFrame(frame) {
  if (!frame || typeof frame !== 'object') throw new Error('Missing frame');
  const universes = frame.universes;
  if (!Array.isArray(universes)) throw new Error('Frame universes must be an array');
  if (universes.length > MAX_UNIVERSES_PER_FRAME) {
    throw new Error(`At most ${MAX_UNIVERSES_PER_FRAME} universes per frame`);
  }
  const seen = new Set();
  const normalized = [];
  let usesSacn = false;
  for (const entry of universes) {
    const protocol = entry?.protocol;
    const universe = entry?.universe;
    let host = entry?.host ?? null;
    if (protocol === 'artnet') {
      if (!Number.isInteger(universe) || universe < 0 || universe > packets.ARTNET_MAX_UNIVERSE) {
        throw new Error('Art-Net universe must be 0-32767');
      }
      if (!isValidHost(host)) throw new Error('Art-Net needs a node or broadcast IPv4 address');
    } else if (protocol === 'sacn') {
      usesSacn = true;
      if (!Number.isInteger(universe) || universe < packets.SACN_MIN_UNIVERSE || universe > packets.SACN_MAX_UNIVERSE) {
        throw new Error('sACN universe must be 1-63999');
      }
      if (host !== null && !isValidHost(host)) throw new Error('sACN unicast needs an IPv4 address');
    } else {
      throw new Error('Protocol must be artnet or sacn');
    }
    const data = entry.data;
    if (!data || typeof data.length !== 'number' || data.length < 1 || data.length > packets.DMX_SLOTS) {
      throw new Error('DMX data must be 1-512 channels');
    }
    const key = `${protocol}|${host ?? 'multicast'}|${universe}`;
    if (seen.has(key)) throw new Error(`Universe ${universe} appears twice for the same target`);
    seen.add(key);
    normalized.push({ key, protocol, host, universe, data });
  }

  const sacn = {
    priority: packets.SACN_DEFAULT_PRIORITY,
    sourceName: 'Ghost Arcade',
    cid: null,
  };
  if (usesSacn) {
    const priority = frame.sacn?.priority ?? packets.SACN_DEFAULT_PRIORITY;
    if (!Number.isInteger(priority) || priority < 0 || priority > packets.SACN_MAX_PRIORITY) {
      throw new Error('sACN priority must be 0-200');
    }
    sacn.priority = priority;
    if (typeof frame.sacn?.sourceName === 'string') sacn.sourceName = frame.sacn.sourceName;
    packets.parseSacnCid(frame.sacn?.cid);
    sacn.cid = frame.sacn.cid;
  }

  return {
    fps: clampFps(frame.fps),
    artSync: frame.artSync === true,
    sacn,
    universes: normalized,
  };
}

function createPixelMapOutput({
  dgram,
  artnetPort = packets.ARTNET_PORT,
  sacnPort = packets.SACN_PORT,
  now = () => Date.now(),
  log = console,
} = {}) {
  if (!dgram) throw new Error('createPixelMapOutput needs dgram');

  let socket = null;
  let socketReady = null;
  let lastFrameAt = -Infinity;
  let rateCredit = 1;
  const sequences = new Map();
  // key -> { protocol, host, universe, length, sacn }
  let active = new Map();
  let artSyncActive = false;
  const recentFrames = [];
  const stats = {
    framesSent: 0,
    packetsSent: 0,
    framesDropped: 0,
    droppedBusy: 0,
    droppedRate: 0,
    sendErrors: 0,
    lastError: null,
  };

  function snapshot() {
    const cutoff = now() - 1000;
    while (recentFrames.length > 0 && recentFrames[0] < cutoff) recentFrames.shift();
    return {
      ...stats,
      fps: recentFrames.length,
      universes: active.size,
      sending: active.size > 0,
    };
  }

  function ensureSocket() {
    if (socketReady) return socketReady;
    const sock = dgram.createSocket({ type: 'udp4' });
    sock._gaPending = 0;
    sock._gaClosing = false;
    sock.on('error', (error) => {
      stats.lastError = error?.message ?? String(error);
      log.warn?.('[PixelMap] socket error:', stats.lastError);
    });
    socket = sock;
    socketReady = new Promise((resolve, reject) => {
      const onError = (error) => {
        if (socket === sock) {
          socket = null;
          socketReady = null;
        }
        reject(error);
      };
      sock.once('error', onError);
      // stop() can close the socket before bind completes; never leave a
      // sendFrame awaiting a socket that will not become ready.
      sock.once('close', () => reject(new Error('Pixel map socket closed')));
      sock.bind(0, () => {
        sock.off('error', onError);
        // Art-Net broadcast targets need SO_BROADCAST.
        try { sock.setBroadcast(true); } catch {}
        sock._gaReady = true;
        resolve(sock);
      });
    });
    return socketReady;
  }

  function closeWhenDrained(sock) {
    if (!sock || sock._gaClosed) return;
    sock._gaClosing = true;
    if (sock._gaPending > 0) return;
    sock._gaClosed = true;
    try { sock.close(); } catch {}
  }

  function sendPacket(sock, packet, port, host) {
    sock._gaPending += 1;
    stats.packetsSent += 1;
    sock.send(packet, 0, packet.length, port, host, (error) => {
      sock._gaPending = Math.max(0, sock._gaPending - 1);
      if (error) {
        stats.sendErrors += 1;
        stats.lastError = error.message;
      }
      if (sock._gaClosing) closeWhenDrained(sock);
    });
  }

  function nextSequence(target) {
    const previous = sequences.get(target.key);
    const sequence = target.protocol === 'artnet'
      ? packets.nextArtNetSequence(previous ?? 0)
      : packets.nextSacnSequence(previous);
    sequences.set(target.key, sequence);
    return sequence;
  }

  function sendUniverse(sock, target, data, sacn, terminated = false) {
    const sequence = nextSequence(target);
    if (target.protocol === 'artnet') {
      sendPacket(sock, packets.buildArtDmxPacket({ universe: target.universe, sequence, data }), artnetPort, target.host);
      return;
    }
    const packet = packets.buildE131DataPacket({
      universe: target.universe,
      sequence,
      priority: sacn.priority,
      sourceName: sacn.sourceName,
      cid: sacn.cid,
      data,
      terminated,
    });
    sendPacket(sock, packet, sacnPort, target.host ?? packets.sacnMulticastAddress(target.universe));
  }

  /** One black frame, then Stream_Terminated for sACN. */
  function sendTerminal(sock, target) {
    const black = new Uint8Array(target.length);
    sendUniverse(sock, target, black, target.sacn);
    if (target.protocol === 'sacn') {
      for (let index = 0; index < SACN_TERMINATION_PACKETS; index += 1) {
        sendUniverse(sock, target, black, target.sacn, true);
      }
    }
    sequences.delete(target.key);
  }

  function sendArtSync(sock, hosts) {
    const sync = packets.buildArtSyncPacket();
    for (const host of hosts) sendPacket(sock, sync, artnetPort, host);
  }

  async function sendFrame(input) {
    let frame;
    try {
      frame = normalizeFrame(input);
    } catch (error) {
      stats.lastError = error.message;
      return { ok: false, error: error.message, stats: snapshot() };
    }

    const time = now();
    const credit = Number.isFinite(lastFrameAt)
      ? Math.min(RATE_BURST, rateCredit + ((time - lastFrameAt) * frame.fps) / 1000)
      : 1;
    if (credit < 1 - 1e-9) {
      stats.framesDropped += 1;
      stats.droppedRate += 1;
      return { ok: true, dropped: true, reason: 'rate', stats: snapshot() };
    }
    if (socket && socket._gaPending > 0) {
      stats.framesDropped += 1;
      stats.droppedBusy += 1;
      return { ok: true, dropped: true, reason: 'busy', stats: snapshot() };
    }
    lastFrameAt = time;
    rateCredit = Math.max(0, credit - 1);

    let sock;
    try {
      sock = await ensureSocket();
    } catch (error) {
      stats.sendErrors += 1;
      stats.lastError = error.message;
      return { ok: false, error: error.message, stats: snapshot() };
    }

    const next = new Map();
    for (const universe of frame.universes) {
      next.set(universe.key, {
        key: universe.key,
        protocol: universe.protocol,
        host: universe.host,
        universe: universe.universe,
        length: universe.data.length,
        sacn: frame.sacn,
      });
    }

    const syncHosts = new Set();
    for (const [key, target] of active) {
      if (next.has(key)) continue;
      sendTerminal(sock, target);
      if (target.protocol === 'artnet') syncHosts.add(target.host);
    }
    try {
      for (const universe of frame.universes) {
        sendUniverse(sock, next.get(universe.key), universe.data, frame.sacn);
        if (universe.protocol === 'artnet') syncHosts.add(universe.host);
      }
    } catch (error) {
      stats.sendErrors += 1;
      stats.lastError = error.message;
      return { ok: false, error: error.message, stats: snapshot() };
    }
    if (frame.artSync && syncHosts.size > 0) sendArtSync(sock, syncHosts);

    active = next;
    artSyncActive = frame.artSync;
    stats.framesSent += 1;
    recentFrames.push(time);
    return { ok: true, sent: frame.universes.length, stats: snapshot() };
  }

  /** Black out every active universe, terminate sACN streams, release the socket. */
  function stop() {
    const sock = socket;
    let terminated = 0;
    if (sock && sock._gaReady && active.size > 0) {
      const syncHosts = new Set();
      for (const target of active.values()) {
        sendTerminal(sock, target);
        terminated += 1;
        if (target.protocol === 'artnet') syncHosts.add(target.host);
      }
      if (artSyncActive && syncHosts.size > 0) sendArtSync(sock, syncHosts);
    }
    active = new Map();
    sequences.clear();
    lastFrameAt = -Infinity;
    rateCredit = 1;
    artSyncActive = false;
    recentFrames.length = 0;
    if (sock) {
      socket = null;
      socketReady = null;
      closeWhenDrained(sock);
    }
    return { ok: true, terminated, stats: snapshot() };
  }

  return {
    sendFrame,
    stop,
    stats: snapshot,
  };
}

module.exports = {
  DEFAULT_FPS,
  MAX_FPS,
  MAX_UNIVERSES_PER_FRAME,
  createPixelMapOutput,
  normalizeFrame,
};
