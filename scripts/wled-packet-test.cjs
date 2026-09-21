const { test } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { buildWLEDRealtimePacket } = require('../electron/wled-packet.cjs');

test('DRGB header, RGB order, timeout, and 490 LED boundary', () => {
  assert.deepEqual([...buildWLEDRealtimePacket([255, 0, 0, 0, 255, 0])], [2, 2, 255, 0, 0, 0, 255, 0]);
  assert.equal(buildWLEDRealtimePacket(new Uint8Array(1470)).length, 1472);
  for (const input of [[], [1], [1, 2, 3, 4], new Uint8Array(1473), null]) {
    assert.throws(() => buildWLEDRealtimePacket(input), /1–490/);
  }
});

test('WLED packet arrives unchanged over UDP', { timeout: 3000 }, async () => {
  const receiver = dgram.createSocket('udp4');
  const sender = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      receiver.once('error', reject);
      receiver.bind(0, '127.0.0.1', resolve);
    });
    const received = new Promise(resolve => receiver.once('message', resolve));
    const packet = buildWLEDRealtimePacket([12, 34, 56]);
    await new Promise((resolve, reject) => sender.send(packet, receiver.address().port, '127.0.0.1', error => error ? reject(error) : resolve()));
    assert.deepEqual(await received, packet);
  } finally {
    receiver.close();
    sender.close();
  }
});
