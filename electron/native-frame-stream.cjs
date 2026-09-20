// Persistent, bounded loopback transport: no raw files or renderer pixel IPC.
const net = require('node:net');
const { randomBytes, timingSafeEqual } = require('node:crypto');
async function createNativeFrameSink({ write, timeoutMs = 15000 }) {
  const token = randomBytes(32).toString('hex');
  const sockets = new Set();
  let owner = null, pending = null, closed = false;
  const fail = error => { if (pending) { pending.reject(error); pending = null; } };
  const server = net.createServer(socket => {
    if (closed || owner || sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    (async () => {
      let header = Buffer.alloc(0), authenticated = false;
      try {
        for await (let chunk of socket) {
          if (!authenticated) {
            const need = 64 - header.length;
            header = Buffer.concat([header, chunk.subarray(0, need)]);
            chunk = chunk.subarray(need);
            if (header.length < 64) continue;
            if (!timingSafeEqual(header, Buffer.from(token)) || owner) throw new Error('Invalid frame stream token');
            owner = socket; authenticated = true;
          }
          if (!chunk.length) continue;
          const request = pending;
          if (!request || chunk.length > request.remaining) throw new Error('Unexpected native frame bytes');
          await write(chunk);
          request.remaining -= chunk.length;
          if (!request.remaining) { pending = null; socket.write('OK'); request.resolve(); }
        }
        if (authenticated) throw new Error('Native frame stream closed');
      } catch (error) { socket.destroy(); if (authenticated) fail(error); }
      finally { if (owner === socket) owner = null; }
    })();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    async capture(bytes, capture) {
      if (closed || pending || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid or busy frame stream');
      let timer;
      const done = new Promise((resolve, reject) => { pending = { remaining: bytes, resolve, reject }; });
      done.catch(() => {});
      try {
        timer = setTimeout(() => fail(new Error('Native frame stream timed out')), timeoutMs);
        const [result] = await Promise.all([capture({ port: server.address().port, token }), done]);
        return result;
      } catch (error) {
        fail(error); for (const socket of sockets) socket.destroy(); throw error;
      } finally { clearTimeout(timer); }
    },
    async close() {
      if (closed) return;
      closed = true; fail(new Error('Native frame stream cancelled'));
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
async function receiveNativeFrame({ bytes, capture, write, timeoutMs }) {
  const sink = await createNativeFrameSink({ write, timeoutMs });
  try { return await sink.capture(bytes, capture); } finally { await sink.close(); }
}
module.exports = { createNativeFrameSink, receiveNativeFrame };
