/**
 * A fake PJLink class 1 projector for tests. Listens on 127.0.0.1 only.
 *
 *   const server = await startFakePjlink({ password: 'secret' });
 *   server.port; server.received; server.state; await server.close();
 *
 * Or from a shell, for driving the app by hand:
 *   node scripts/fake-pjlink-server.cjs --port 14352 --password secret
 * which prints one JSON line per command it receives.
 *
 * Behaviour: greets with "PJLINK 1 <random>" when a password is set (else
 * "PJLINK 0"); answers a wrong digest with "PJLINK ERRA" and hangs up;
 * implements POWR, AVMT, INPT, ERST, LAMP, NAME, CLSS; answers an unknown
 * command ERR1, a bad parameter ERR2, and an input change while powered
 * off ERR3, like real hardware does.
 */

'use strict';

const net = require('net');
const crypto = require('crypto');

function startFakePjlink({ password = '', port = 0, name = 'Fake Projector', inputs = ['11', '31', '32'], random } = {}) {
  const state = { power: 0, avmt: '30', input: inputs[1] || '31', lampHours: 1234, errors: '000000' };
  const received = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('latin1');
    const nonce = random || crypto.randomBytes(4).toString('hex');
    const needsAuth = !!password;
    let authed = !needsAuth;
    let first = true;
    socket.write(needsAuth ? `PJLINK 1 ${nonce}\r` : 'PJLINK 0\r');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\r')) >= 0) {
        let line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (first && needsAuth) {
          first = false;
          const digest = line.slice(0, 32);
          line = line.slice(32);
          const expected = crypto.createHash('md5').update(nonce + password).digest('hex');
          if (digest !== expected) {
            received.push({ line, authenticated: false, rejected: true, at: Date.now() });
            socket.end('PJLINK ERRA\r');
            return;
          }
          authed = true;
        }
        first = false;
        const m = /^%1([A-Z0-9]{4}) (.*)$/.exec(line);
        const entry = { line, command: m ? m[1] : null, param: m ? m[2] : null, authenticated: authed && needsAuth, at: Date.now() };
        received.push(entry);
        if (process.env.FAKE_PJLINK_LOG === '1') process.stdout.write(JSON.stringify(entry) + '\n');
        if (!m) { socket.write('%1ERR1\r'); continue; }
        socket.write(`%1${m[1]}=${reply(m[1], m[2])}\r`);
      }
    });
    socket.on('error', () => {});
  });

  function reply(cmd, param) {
    switch (cmd) {
      case 'POWR':
        if (param === '?') return String(state.power);
        if (param === '1') { state.power = 1; return 'OK'; }
        if (param === '0') { state.power = 0; return 'OK'; }
        return 'ERR2';
      case 'AVMT':
        if (param === '?') return state.avmt;
        if (!['10', '11', '20', '21', '30', '31'].includes(param)) return 'ERR2';
        if (state.power !== 1) return 'ERR3';
        state.avmt = param;
        return 'OK';
      case 'INPT':
        if (param === '?') return state.power === 1 ? state.input : 'ERR3';
        if (!inputs.includes(param)) return 'ERR2';
        if (state.power !== 1) return 'ERR3';
        state.input = param;
        return 'OK';
      case 'ERST': return param === '?' ? state.errors : 'ERR2';
      case 'LAMP': return param === '?' ? `${state.lampHours} ${state.power}` : 'ERR2';
      case 'NAME': return param === '?' ? name : 'ERR2';
      case 'CLSS': return param === '?' ? '1' : 'ERR2';
      case 'INST': return param === '?' ? inputs.join(' ') : 'ERR2';
      default: return 'ERR1';
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        received,
        state,
        close: () => new Promise((done) => {
          for (const s of sockets) s.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

module.exports = { startFakePjlink };

if (require.main === module) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  process.env.FAKE_PJLINK_LOG = '1';
  startFakePjlink({ port: Number(arg('port', '14352')), password: arg('password', '') }).then((s) => {
    process.stdout.write(JSON.stringify({ listening: s.port }) + '\n');
  });
}
