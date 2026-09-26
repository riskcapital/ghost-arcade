// Art-Net / sACN DMX input for the Electron main process.
//
// A lighting desk drives the show: this module listens for ArtDmx on UDP
// 6454 and E1.31 on UDP 5568, merges sources per universe, drops sources
// that go quiet, and hands the renderer only the channels that changed,
// at most `rateHz` times a second.
//
// - Off until start() is called; the renderer only calls it when the user
//   switches DMX input on.
// - Parsing is strict (dmx-input-packets.cjs). Malformed, oversized,
//   preview and out-of-order packets are counted and ignored.
// - Universe filter: only listed universes are tracked. With no filter,
//   the first MAX_UNIVERSES universes seen are tracked and the rest are
//   counted as filtered.
// - Merge per universe: HTP (highest value per channel), LTP (the source
//   that last changed a channel owns it) or priority (highest sACN
//   priority wins, ties merge HTP; Art-Net counts as priority 100).
// - A source that sends nothing for `timeoutMs` is dropped and the
//   universe re-merged. sACN Stream_Terminated drops it at once. When the
//   last source goes, the universe holds its last values.

const packets = require('./dmx-input-packets.cjs');

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;
const DMX_SLOTS = 512;
const MAX_UNIVERSES = 64;
const MAX_SOURCES_PER_UNIVERSE = 8;
const MAX_FILTER_UNIVERSES = 64;
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_RATE_HZ = 40;
const STALE_CHECK_MS = 250;
const ARTNET_PRIORITY = 100;
const MERGE_MODES = new Set(['htp', 'ltp', 'priority']);

function isIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function sacnMulticastAddress(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/** Validate and fill defaults. Throws with a user-readable message. */
function normalizeInputConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const bindAddress = config.bindAddress === undefined || config.bindAddress === '' ? '0.0.0.0' : config.bindAddress;
  if (!isIPv4(bindAddress)) throw new Error('Bind address must be an IPv4 address or 0.0.0.0 for all interfaces');
  const artnet = config.artnet !== false;
  const sacn = config.sacn !== false;
  if (!artnet && !sacn) throw new Error('Turn on Art-Net, sACN or both');
  const universes = config.universes ?? [];
  if (!Array.isArray(universes)) throw new Error('Universe filter must be a list');
  if (universes.length > MAX_FILTER_UNIVERSES) throw new Error(`At most ${MAX_FILTER_UNIVERSES} universes in the filter`);
  const filter = [];
  for (const universe of universes) {
    if (!Number.isInteger(universe) || universe < 0 || universe > 63999) {
      throw new Error('Universes must be whole numbers 0-63999');
    }
    if (!filter.includes(universe)) filter.push(universe);
  }
  const mergeMode = config.mergeMode ?? 'htp';
  if (!MERGE_MODES.has(mergeMode)) throw new Error('Merge must be htp, ltp or priority');
  const timeout = Number(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const rate = Number(config.rateHz ?? DEFAULT_RATE_HZ);
  const port = (value, fallback) => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Ports must be 1-65535');
    return value;
  };
  return {
    bindAddress,
    artnet,
    sacn,
    sacnMulticast: config.sacnMulticast !== false,
    universes: filter,
    mergeMode,
    timeoutMs: Number.isFinite(timeout) ? Math.max(250, Math.min(30000, Math.round(timeout))) : DEFAULT_TIMEOUT_MS,
    rateHz: Number.isFinite(rate) ? Math.max(1, Math.min(60, Math.round(rate))) : DEFAULT_RATE_HZ,
    artnetPort: port(config.artnetPort, ARTNET_PORT),
    sacnPort: port(config.sacnPort, SACN_PORT),
  };
}

/**
 * Per-universe merge state. Pure: time comes in as an argument, so tests
 * drive it directly.
 */
function createUniverseMerge(mergeMode = 'htp') {
  const sources = new Map();
  const merged = new Uint8Array(DMX_SLOTS);
  let mode = mergeMode;
  let stamp = 0;

  function recompute() {
    const live = [...sources.values()];
    if (live.length === 0) return false; // hold last values
    let pool = live;
    if (mode === 'priority') {
      const top = Math.max(...live.map(source => source.priority));
      pool = live.filter(source => source.priority === top);
    }
    let changed = false;
    for (let channel = 0; channel < DMX_SLOTS; channel += 1) {
      let value = 0;
      if (mode === 'ltp') {
        let newest = -1;
        for (const source of pool) {
          if (channel < source.length && source.stamps[channel] > newest) {
            newest = source.stamps[channel];
            value = source.data[channel];
          }
        }
      } else {
        for (const source of pool) {
          if (channel < source.length && source.data[channel] > value) value = source.data[channel];
        }
      }
      if (merged[channel] !== value) {
        merged[channel] = value;
        changed = true;
      }
    }
    return changed;
  }

  return {
    merged,
    sources,
    setMode(next) {
      if (!MERGE_MODES.has(next) || next === mode) return false;
      mode = next;
      return recompute();
    },
    /**
     * Apply one packet. Returns { accepted, changed, reason? }.
     * `key` identifies the source (sACN CID, or Art-Net address:port).
     */
    receive(key, packet, time, info = {}) {
      let source = sources.get(key);
      if (!source) {
        if (sources.size >= MAX_SOURCES_PER_UNIVERSE) return { accepted: false, changed: false, reason: 'too-many-sources' };
        source = {
          key,
          protocol: packet.protocol,
          data: new Uint8Array(DMX_SLOTS),
          stamps: new Float64Array(DMX_SLOTS).fill(-1),
          length: 0,
          priority: ARTNET_PRIORITY,
          sequence: null,
          name: '',
          address: info.address ?? '',
          lastSeen: time,
          fresh: true,
        };
        sources.set(key, source);
      } else if (packet.protocol === 'sacn' && packets.isSacnSequenceStale(source.sequence, packet.sequence)) {
        return { accepted: false, changed: false, reason: 'out-of-order' };
      }
      if (packet.terminated) {
        sources.delete(key);
        return { accepted: true, changed: recompute(), terminated: true };
      }
      stamp += 1;
      const length = Math.min(DMX_SLOTS, packet.data.length);
      for (let channel = 0; channel < length; channel += 1) {
        if (source.fresh || source.data[channel] !== packet.data[channel]) {
          source.data[channel] = packet.data[channel];
          source.stamps[channel] = stamp;
        }
      }
      // A shorter packet than before zeroes the channels it no longer sends.
      for (let channel = length; channel < source.length; channel += 1) source.data[channel] = 0;
      source.length = length;
      source.fresh = false;
      source.sequence = packet.sequence;
      source.priority = packet.protocol === 'sacn' ? packet.priority : ARTNET_PRIORITY;
      source.name = packet.sourceName ?? info.name ?? '';
      source.address = info.address ?? source.address;
      source.lastSeen = time;
      return { accepted: true, changed: recompute() };
    },
    /** Drop sources silent for longer than timeoutMs. Returns { dropped, changed }. */
    expire(time, timeoutMs) {
      let dropped = 0;
      for (const [key, source] of sources) {
        if (time - source.lastSeen > timeoutMs) {
          sources.delete(key);
          dropped += 1;
        }
      }
      return { dropped, changed: dropped > 0 ? recompute() : false };
    },
  };
}

function createDmxInput({
  dgram,
  now = () => Date.now(),
  log = console,
  onChanges = () => {},
  onStatus = () => {},
  isOwnPacket = () => false,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  platform = process.platform,
} = {}) {
  if (!dgram) throw new Error('createDmxInput needs dgram');

  let config = null;
  let running = false;
  const sockets = new Map(); // protocol -> socket
  const listening = { artnet: false, sacn: false };
  const errors = { artnet: null, sacn: null };
  const universes = new Map(); // `${protocol}:${universe}` -> { protocol, universe, merge, sent, live }
  let flushTimer = null;
  let staleTimer = null;
  let lastFlushAt = -Infinity;
  const stats = {
    received: 0,
    accepted: 0,
    malformed: 0,
    ignored: 0,
    filtered: 0,
    outOfOrder: 0,
    own: 0,
    flushes: 0,
    lastReason: null,
  };

  function statusSnapshot() {
    return {
      running,
      bindAddress: config?.bindAddress ?? null,
      artnet: { enabled: !!config?.artnet, listening: listening.artnet, error: errors.artnet, port: config?.artnetPort ?? ARTNET_PORT },
      sacn: { enabled: !!config?.sacn, listening: listening.sacn, error: errors.sacn, port: config?.sacnPort ?? SACN_PORT },
      mergeMode: config?.mergeMode ?? 'htp',
      universeFilter: config?.universes ?? [],
      stats: { ...stats },
      universes: [...universes.values()].map(entry => ({
        protocol: entry.protocol,
        universe: entry.universe,
        live: entry.merge.sources.size > 0,
        sources: [...entry.merge.sources.values()].map(source => ({
          name: source.name,
          address: source.address,
          priority: source.priority,
          length: source.length,
          ageMs: Math.max(0, now() - source.lastSeen),
        })),
      })),
    };
  }

  function emitStatus() {
    try { onStatus(statusSnapshot()); } catch (error) { log.warn?.('[DMX in] status listener failed:', error?.message ?? error); }
  }

  function scheduleFlush() {
    if (flushTimer || !running) return;
    const interval = 1000 / (config?.rateHz ?? DEFAULT_RATE_HZ);
    const wait = Math.max(0, lastFlushAt + interval - now());
    flushTimer = setTimeoutFn(flush, wait);
  }

  /** Send only the channels that differ from what the renderer last got. */
  function flush() {
    flushTimer = null;
    lastFlushAt = now();
    const batch = [];
    for (const entry of universes.values()) {
      const { merged } = entry.merge;
      let changes = null;
      for (let channel = 0; channel < DMX_SLOTS; channel += 1) {
        if (merged[channel] !== entry.sent[channel]) {
          if (!changes) changes = [];
          changes.push(channel, merged[channel]);
          entry.sent[channel] = merged[channel];
        }
      }
      if (changes) batch.push({ protocol: entry.protocol, universe: entry.universe, changes });
    }
    if (batch.length === 0) return;
    stats.flushes += 1;
    try { onChanges({ universes: batch }); } catch (error) { log.warn?.('[DMX in] change listener failed:', error?.message ?? error); }
  }

  function universeEntry(protocol, universe) {
    const key = `${protocol}:${universe}`;
    let entry = universes.get(key);
    if (entry) return entry;
    if (config.universes.length > 0 && !config.universes.includes(universe)) return null;
    if (universes.size >= MAX_UNIVERSES) return null;
    entry = { protocol, universe, merge: createUniverseMerge(config.mergeMode), sent: new Uint8Array(DMX_SLOTS) };
    universes.set(key, entry);
    return entry;
  }

  function handleMessage(protocol, message, rinfo) {
    if (!running) return;
    stats.received += 1;
    if (isOwnPacket(rinfo)) {
      stats.own += 1;
      return;
    }
    const parsed = protocol === 'artnet' ? packets.parseArtDmx(message) : packets.parseE131(message);
    if (!parsed.ok) {
      // Other Art-Net opcodes, sACN sync/discovery and preview data are
      // legitimate traffic this listener does not act on.
      if (['artnet-opcode', 'sacn-extended', 'preview', 'start-code'].includes(parsed.reason)) stats.ignored += 1;
      else stats.malformed += 1;
      stats.lastReason = parsed.reason;
      return;
    }
    const entry = universeEntry(protocol, parsed.universe);
    if (!entry) {
      stats.filtered += 1;
      return;
    }
    const address = `${rinfo?.address ?? '?'}:${rinfo?.port ?? 0}`;
    const sourceKey = parsed.protocol === 'sacn' ? `cid:${parsed.cid}` : `ip:${address}`;
    const hadSources = entry.merge.sources.size;
    const result = entry.merge.receive(sourceKey, parsed, now(), { address: rinfo?.address ?? '' });
    if (!result.accepted) {
      if (result.reason === 'out-of-order') stats.outOfOrder += 1;
      else stats.ignored += 1;
      return;
    }
    stats.accepted += 1;
    if (result.changed) scheduleFlush();
    if (entry.merge.sources.size !== hadSources) emitStatus();
  }

  function expireSources() {
    if (!running) return;
    const time = now();
    let changed = false;
    let dropped = 0;
    for (const entry of universes.values()) {
      const result = entry.merge.expire(time, config.timeoutMs);
      dropped += result.dropped;
      changed = changed || result.changed;
    }
    if (changed) scheduleFlush();
    if (dropped > 0) emitStatus();
  }

  function openSocket(protocol) {
    const port = protocol === 'artnet' ? config.artnetPort : config.sacnPort;
    const joinGroups = protocol === 'sacn' && config.sacnMulticast && config.universes.some(universe => universe >= 1);
    // On macOS and Linux a socket bound to a unicast address never sees
    // multicast, so a filtered interface joins its groups on 0.0.0.0 and
    // picks the interface through the membership instead.
    const bindAddress = joinGroups && platform !== 'win32' ? '0.0.0.0' : config.bindAddress;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sockets.set(protocol, socket);
    return new Promise((resolve) => {
      let settled = false;
      socket.on('error', (error) => {
        errors[protocol] = error?.message ?? String(error);
        listening[protocol] = false;
        log.warn?.(`[DMX in] ${protocol} socket error:`, errors[protocol]);
        if (sockets.get(protocol) === socket) {
          sockets.delete(protocol);
          try { socket.close(); } catch {}
        }
        emitStatus();
        if (!settled) { settled = true; resolve(false); }
      });
      socket.on('message', (message, rinfo) => handleMessage(protocol, message, rinfo));
      socket.bind({ port, address: bindAddress, exclusive: false }, () => {
        listening[protocol] = true;
        errors[protocol] = null;
        if (joinGroups) {
          const iface = config.bindAddress === '0.0.0.0' ? undefined : config.bindAddress;
          for (const universe of config.universes) {
            if (universe < 1) continue;
            try { socket.addMembership(sacnMulticastAddress(universe), iface); } catch (error) {
              errors.sacn = `Could not join sACN multicast for universe ${universe}: ${error?.message ?? error}`;
            }
          }
        }
        if (!settled) { settled = true; resolve(true); }
      });
    });
  }

  function closeSockets() {
    for (const socket of sockets.values()) {
      try { socket.close(); } catch {}
    }
    sockets.clear();
    listening.artnet = false;
    listening.sacn = false;
  }

  async function start(rawConfig) {
    let next;
    try {
      next = normalizeInputConfig(rawConfig);
    } catch (error) {
      return { ok: false, error: error.message, status: statusSnapshot() };
    }
    stop({ silent: true });
    config = next;
    running = true;
    errors.artnet = null;
    errors.sacn = null;
    const opened = [];
    if (config.artnet) opened.push(openSocket('artnet'));
    if (config.sacn) opened.push(openSocket('sacn'));
    const results = await Promise.all(opened);
    if (!running || config !== next) return { ok: false, error: 'Stopped while starting', status: statusSnapshot() };
    staleTimer = setIntervalFn(expireSources, STALE_CHECK_MS);
    emitStatus();
    const ok = results.some(Boolean);
    return ok
      ? { ok: true, status: statusSnapshot() }
      : { ok: false, error: errors.artnet ?? errors.sacn ?? 'Could not open a DMX input socket', status: statusSnapshot() };
  }

  function stop({ silent = false } = {}) {
    const wasRunning = running;
    running = false;
    closeSockets();
    if (flushTimer) { clearTimeoutFn(flushTimer); flushTimer = null; }
    if (staleTimer) { clearIntervalFn(staleTimer); staleTimer = null; }
    universes.clear();
    lastFlushAt = -Infinity;
    for (const key of Object.keys(stats)) stats[key] = key === 'lastReason' ? null : 0;
    if (wasRunning && !silent) emitStatus();
    return { ok: true, status: statusSnapshot() };
  }

  /** Merge settings that apply without reopening sockets. */
  function update(rawPatch = {}) {
    if (!config) return { ok: false, error: 'DMX input is not running' };
    let next;
    try {
      next = normalizeInputConfig({ ...config, ...rawPatch, bindAddress: config.bindAddress, artnet: config.artnet, sacn: config.sacn, universes: config.universes, sacnMulticast: config.sacnMulticast });
    } catch (error) {
      return { ok: false, error: error.message };
    }
    config = { ...config, mergeMode: next.mergeMode, timeoutMs: next.timeoutMs, rateHz: next.rateHz };
    let changed = false;
    for (const entry of universes.values()) changed = entry.merge.setMode(config.mergeMode) || changed;
    if (changed) scheduleFlush();
    emitStatus();
    return { ok: true, status: statusSnapshot() };
  }

  /** Forget what the renderer was sent, so the next flush resends every non-zero channel. */
  function resync() {
    for (const entry of universes.values()) entry.sent.fill(0);
    let pending = false;
    for (const entry of universes.values()) if (entry.merge.merged.some(value => value !== 0)) pending = true;
    if (pending) scheduleFlush();
    return { ok: true };
  }

  /** Full merged universe, for the monitor. */
  function snapshot({ protocol, universe } = {}) {
    const entry = universes.get(`${protocol}:${universe}`);
    return entry ? Array.from(entry.merge.merged) : null;
  }

  return {
    start,
    stop,
    update,
    resync,
    snapshot,
    status: statusSnapshot,
    /** Test hook: feed a datagram as if it arrived on a socket. */
    _receive: handleMessage,
    _flush: flush,
    _expire: expireSources,
  };
}

module.exports = {
  ARTNET_PORT,
  SACN_PORT,
  MAX_UNIVERSES,
  MAX_SOURCES_PER_UNIVERSE,
  MAX_FILTER_UNIVERSES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_RATE_HZ,
  normalizeInputConfig,
  createUniverseMerge,
  createDmxInput,
};
