/**
 * PJLink class 1 client (TCP 4352).
 *
 * One short TCP session per request: the projector greets with
 *   "PJLINK 0\r"            no authentication, or
 *   "PJLINK 1 <random>\r"   authentication on,
 * the client sends each command as "%1CMND param\r", prefixing the FIRST one
 * with md5(random + password) in lower-case hex when authentication is on,
 * and reads one "%1CMND=reply\r" line per command. A wrong password is
 * answered with "PJLINK ERRA\r".
 *
 * Replies ERR1..ERR4 are undefined command, out of parameter, unavailable
 * time (typically: the projector is warming up or off) and projector failure.
 *
 * Requests to the same projector are serialised: many projectors accept a
 * single connection at a time and drop a second one without a word.
 */

'use strict';

const crypto = require('crypto');
const nodeNet = require('net');

const PJLINK_PORT = 4352;
const ERROR_TEXT = {
  ERR1: 'undefined command',
  ERR2: 'out of parameter',
  ERR3: 'unavailable time',
  ERR4: 'projector failure',
};

function md5hex(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/** Only "XXXX param" with printable ASCII; nothing that could smuggle a CR. */
function validCommand(command) {
  return typeof command === 'string' && /^[A-Z0-9]{4} [\x20-\x7e]{1,128}$/.test(command);
}

/** "%1POWR=OK" -> { command: 'POWR', ok: true, value: 'OK' } */
function parseReply(line) {
  const m = /^%1([A-Z0-9]{4})=(.*)$/.exec(line);
  if (!m) return { command: null, ok: false, value: null, error: `unexpected reply "${line.slice(0, 64)}"` };
  const value = m[2];
  if (ERROR_TEXT[value]) return { command: m[1], ok: false, value, error: ERROR_TEXT[value] };
  return { command: m[1], ok: true, value, error: null };
}

/**
 * Run a list of commands in one session.
 * Resolves { ok, authenticated, responses: [{ command, ok, value, error }], error }.
 * Never rejects: a connection failure comes back as ok: false with error set.
 */
function runSession({ host, port = PJLINK_PORT, password = '', commands = [], timeoutMs = 5000, net = nodeNet } = {}) {
  return new Promise((resolve) => {
    const cmds = (Array.isArray(commands) ? commands : []).map((c) => String(c).trim());
    const bad = cmds.find((c) => !validCommand(c));
    if (!host || typeof host !== 'string') return resolve({ ok: false, authenticated: false, responses: [], sessionError: 'no host', error: 'no host' });
    if (bad !== undefined) return resolve({ ok: false, authenticated: false, responses: [], sessionError: 'invalid command', error: `invalid command "${bad}"` });

    const responses = [];
    let authenticated = false;
    let buffer = '';
    let greeted = false;
    let index = 0;
    let settled = false;
    const socket = net.createConnection({ host, port: Number(port) || PJLINK_PORT });
    socket.setEncoding('latin1');

    // `sessionError` is the connection itself failing (refused, timed out,
    // wrong password); a command the projector answered with ERRn is not.
    const finish = (sessionError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* already gone */ }
      const ok = !sessionError && responses.length === cmds.length && responses.every((r) => r.ok);
      const firstFailure = responses.find((r) => !r.ok);
      resolve({
        ok,
        authenticated,
        responses,
        sessionError: sessionError || null,
        error: sessionError || (firstFailure ? `${firstFailure.command}: ${firstFailure.error}` : null),
      });
    };
    let timer = setTimeout(() => finish('timed out'), timeoutMs);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish('timed out'), timeoutMs);
    };

    let digest = '';
    const sendNext = () => {
      if (index >= cmds.length) return finish(null);
      const line = `${index === 0 ? digest : ''}%1${cmds[index]}\r`;
      socket.write(line, 'latin1');
    };

    const onLine = (line) => {
      bump();
      if (!greeted) {
        greeted = true;
        if (line === 'PJLINK 0') return sendNext();
        const m = /^PJLINK 1 ([0-9a-zA-Z]{1,32})$/.exec(line);
        if (m) {
          if (!password) return finish('authentication required');
          digest = md5hex(m[1] + password);
          authenticated = true;
          return sendNext();
        }
        if (line === 'PJLINK ERRA') return finish('authentication failed');
        return finish(`not a PJLink device ("${line.slice(0, 32)}")`);
      }
      if (line === 'PJLINK ERRA') {
        authenticated = false;
        return finish('authentication failed');
      }
      const reply = parseReply(line);
      responses.push({ ...reply, command: cmds[index].slice(0, 4), sent: cmds[index] });
      index++;
      sendNext();
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\r')) >= 0) {
        const line = buffer.slice(0, at).replace(/^\n+/, '');
        buffer = buffer.slice(at + 1);
        if (line.length) onLine(line);
        if (settled) return;
      }
      if (buffer.length > 4096) finish('reply too long');
    });
    socket.on('error', (err) => finish(err && err.code ? `${err.code}` : String(err && err.message || err)));
    socket.on('close', () => finish(index < cmds.length ? 'connection closed' : null));
  });
}

/** Map a decoded status query into something a UI can show. */
function parseStatus(responses) {
  const by = {};
  for (const r of responses || []) if (r && r.command) by[r.command] = r;
  const val = (c) => (by[c] && by[c].ok ? by[c].value : null);
  const powr = val('POWR');
  const power = powr === '0' ? 'off' : powr === '1' ? 'on' : powr === '2' ? 'cooling' : powr === '3' ? 'warming' : 'unknown';
  const avmt = val('AVMT');
  const shutter = avmt === '11' || avmt === '31' ? 'closed' : avmt === '10' || avmt === '30' || avmt === '20' || avmt === '21' ? 'open' : 'unknown';
  const erst = val('ERST');
  const levels = ['ok', 'warning', 'error'];
  const errors = erst && /^[0-2]{6}$/.test(erst)
    ? {
        fan: levels[+erst[0]], lamp: levels[+erst[1]], temperature: levels[+erst[2]],
        cover: levels[+erst[3]], filter: levels[+erst[4]], other: levels[+erst[5]],
      }
    : null;
  const lamp = val('LAMP');
  const lampHours = lamp ? Number(lamp.split(' ')[0]) : null;
  return {
    power,
    shutter,
    input: val('INPT'),
    errors,
    lampHours: Number.isFinite(lampHours) ? lampHours : null,
    name: val('NAME'),
  };
}

const STATUS_COMMANDS = ['POWR ?', 'AVMT ?', 'INPT ?', 'ERST ?', 'LAMP ?', 'NAME ?'];

/** Commands for the actions the app exposes. */
function commandsFor(action, input) {
  switch (action) {
    case 'power-on': return ['POWR 1'];
    case 'power-off': return ['POWR 0'];
    case 'shutter-close': return ['AVMT 31'];
    case 'shutter-open': return ['AVMT 30'];
    case 'input': return /^[1-9][0-9A-Z]$/.test(String(input || '')) ? [`INPT ${input}`] : null;
    case 'status': return STATUS_COMMANDS;
    default: return null;
  }
}

/**
 * `credentials` (electron/pjlink-credentials.cjs) supplies the password by
 * projector id, so callers pass `projectorId` and never a password. An
 * explicit `password` is only honoured when no credential store is wired
 * (tests of the wire protocol).
 */
function createPjlinkClient({ net = nodeNet, credentials = null } = {}) {
  const queues = new Map();
  function enqueue(key, job) {
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.then(job, job);
    queues.set(key, next.catch(() => {}));
    return next;
  }
  return {
    /** { projectorId, host, port, action, input, timeoutMs } */
    async run({ projectorId, host, port = PJLINK_PORT, password: explicitPassword = '', action, input, commands, timeoutMs = 5000 } = {}) {
      const password = credentials ? (projectorId ? credentials.get(projectorId) : '') : explicitPassword;
      const cmds = commands || commandsFor(action, input);
      if (!cmds) return { ok: false, authenticated: false, responses: [], sessionError: 'unknown action', error: `unknown action "${action}"` };
      const result = await enqueue(`${host}:${port}`, () => runSession({ host, port, password, commands: cmds, timeoutMs, net }));
      if (action === 'status') {
        // A poll succeeds when the projector answered at all: a laser model
        // replying ERR1 to LAMP ? is still a perfectly good status.
        return { ...result, ok: !result.sessionError, status: parseStatus(result.responses) };
      }
      return result;
    },
  };
}

module.exports = { PJLINK_PORT, md5hex, parseReply, parseStatus, runSession, commandsFor, createPjlinkClient, STATUS_COMMANDS };
