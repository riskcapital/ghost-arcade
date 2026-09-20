import { createRequire } from 'node:module';
import net from 'node:net';
import { expect, it } from 'vitest';
const { receiveNativeFrame } = createRequire(import.meta.url)('../../../electron/native-frame-stream.cjs');
function send(port: number, token: string, payload: Buffer) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => { socket.write(token); socket.write(payload); });
    socket.on('data', data => { socket.end(); resolve(data.toString()); });
  });
}
it('streams binary frames with backpressure and acknowledgement', async () => {
  const chunks: Buffer[] = []; const pixels = Buffer.alloc(1024 * 1024, 123);
  const result = await receiveNativeFrame({ bytes: pixels.length,
    capture: ({port, token}: any) => send(port, token, pixels),
    write: async (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); await new Promise(r => setTimeout(r, 1)); },
  });
  expect(result).toBe('OK'); expect(Buffer.concat(chunks)).toEqual(pixels);
});
it('rejects stalled captures within a bounded time', async () => {
  await expect(receiveNativeFrame({ bytes: 100, capture: async () => ({}), write: async () => {}, timeoutMs: 30 })).rejects.toThrow('timed out');
});
