// Two Link peers on this machine, one process each, to check start/stop sync
// in link_addon.node: events arrive both ways, and both peers agree on when
// the transport starts and where the beat is.
//
//   node electron/native/scripts/link-two-peer-check.mjs <path/to/link_addon.node>
//
// The addon must be built for this Node (cmake-js --runtime=node), not for
// Electron. Exits non-zero when a check fails.
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const self = fileURLToPath(import.meta.url);

if (process.argv[2] === '--peer') {
  // ── A peer ──
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const { LinkSession } = require(path.resolve(process.argv[3]));
  const link = new LinkSession(120);
  link.enableStartStopSync(true);
  link.setEventHandler((ev) => {
    process.send({ kind: 'event', receivedMicros: link.clockMicros(), ev });
  });
  link.enable(true);
  process.on('message', (msg) => {
    const reply = (data) => process.send({ kind: 'reply', id: msg.id, data });
    switch (msg.op) {
      case 'state': return reply(link.getState());
      case 'startAtBar': {
        const s = link.getState();
        const beat = Math.ceil(s.beat / 4) * 4 + 4;
        const at = link.timeAtBeat(beat, 4);
        const sentMicros = link.clockMicros();
        link.setIsPlayingAndRequestBeatAtTime(true, at, beat, 4);
        return reply({ beat, at, sentMicros });
      }
      case 'stop': {
        const sentMicros = link.clockMicros();
        link.setIsPlaying(false);
        return reply({ sentMicros });
      }
      case 'quit':
        link.setEventHandler(null);
        link.enable(false);
        reply({});
        return setTimeout(() => process.exit(0), 50);
    }
  });
  process.send({ kind: 'ready' });
} else {
  // ── The check ──
  const addon = process.argv[2];
  if (!addon) {
    console.error('usage: link-two-peer-check.mjs <link_addon.node>');
    process.exit(2);
  }
  const peers = ['A', 'B'].map((name) => {
    const child = fork(self, ['--peer', addon], { stdio: 'inherit' });
    const p = { name, child, events: [], pending: new Map(), nextId: 1, ready: null };
    p.ready = new Promise((resolve) => child.once('message', resolve));
    child.on('message', (msg) => {
      if (msg.kind === 'event') p.events.push(msg);
      if (msg.kind === 'reply') { p.pending.get(msg.id)?.(msg.data); p.pending.delete(msg.id); }
    });
    p.call = (op) => new Promise((resolve) => { const id = p.nextId++; p.pending.set(id, resolve); child.send({ id, op }); });
    return p;
  });
  const [A, B] = peers;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (pred, ms, what) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { const v = pred(); if (v) return v; await sleep(2); }
    throw new Error(`timed out waiting for ${what}`);
  };
  const failures = [];
  const check = (ok, line) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`); if (!ok) failures.push(line); };
  const nextEvent = (p, type, playing, after) => waitFor(() => p.events.find((e, i) => i >= after && e.ev.type === type && (playing === undefined || e.ev.playing === playing)), 5000, `${p.name} ${type} ${playing}`);

  try {
    await Promise.all(peers.map((p) => p.ready));
    const joined = Date.now();
    await waitFor(() => A.events.some((e) => e.ev.type === 'peers' && e.ev.peers === 1) && B.events.some((e) => e.ev.type === 'peers' && e.ev.peers === 1), 10000, 'the peers to find each other');
    check(true, `peers found each other (peer events pushed) after ${Date.now() - joined} ms`);
    await sleep(300);

    // Phase: both peers' beat at one moment (same machine clock).
    const [sa, sb] = await Promise.all([A.call('state'), B.call('state')]);
    const T = Math.max(sa.micros, sb.micros);
    const beatAt = (s) => s.beat + ((T - s.micros) / 60e6) * s.tempo;
    const phaseDiff = ((beatAt(sa) - beatAt(sb)) % 4 + 6) % 4 - 2; // in beats, -2..2
    const phaseMs = (phaseDiff * 60000) / sa.tempo;
    check(Math.abs(phaseMs) < 3, `beat phase A vs B: ${phaseMs.toFixed(3)} ms (tempo ${sa.tempo})`);

    for (const [lead, follow] of [[A, B], [B, A]]) {
      // Start on a bar from one peer: the other hears it with the same start time.
      let from = follow.events.length;
      const ownFrom = lead.events.length;
      const start = await lead.call('startAtBar');
      const got = await nextEvent(follow, 'startStop', true, from);
      const startDiffMs = (got.ev.playingMicros - start.at) / 1000;
      const onBar = ((got.ev.playingBeat % 4) + 4) % 4;
      const barErr = Math.min(onBar, 4 - onBar);
      check(Math.abs(startDiffMs) < 2, `${lead.name} start -> ${follow.name}: event after ${((got.receivedMicros - start.sentMicros) / 1000).toFixed(2)} ms; start time differs by ${startDiffMs.toFixed(3)} ms; ${((start.at - start.sentMicros) / 1000).toFixed(1)} ms ahead`);
      check(barErr * 60000 / got.ev.tempo < 2, `${follow.name} reads the start ${(barErr * 60000 / got.ev.tempo).toFixed(3)} ms from its bar line (beat ${got.ev.playingBeat.toFixed(4)})`);
      const echo = await nextEvent(lead, 'startStop', true, ownFrom);
      check(!!echo, `${lead.name} also gets its own start as an event`);
      await sleep(200);

      // Stop from the other peer.
      from = lead.events.length;
      const stop = await follow.call('stop');
      const stopped = await nextEvent(lead, 'startStop', false, from);
      check(!stopped.ev.playing, `${follow.name} stop -> ${lead.name}: event after ${((stopped.receivedMicros - stop.sentMicros) / 1000).toFixed(2)} ms`);
      await sleep(200);
    }
  } catch (err) {
    failures.push(String(err?.message || err));
    console.error('FAIL', err?.message || err);
  } finally {
    await Promise.all(peers.map((p) => p.call('quit').catch(() => {})));
  }
  console.log(failures.length ? `${failures.length} check(s) failed` : 'all checks passed');
  process.exit(failures.length ? 1 : 0);
}
