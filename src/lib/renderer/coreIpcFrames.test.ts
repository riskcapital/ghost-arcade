import { describe, expect, it } from 'vitest';
import {
  coreIpcBytesWanted,
  coreIpcFramesWanted,
  createCoreOutputReader,
  decodeCoreLine,
  encodeCoreRequest,
  isCoreIpcFramesHello,
  // @ts-expect-error The Electron side is plain ESM JavaScript.
} from '../../../electron/core-ipc-frames.js';
// @ts-expect-error The Electron broker is authored as ESM JavaScript.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

type Frame = { header: number[]; blobs: Buffer[]; json: any };

/** Splits an encoded request the way the core reads it. */
function readFrame(payload: string | Buffer): Frame {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (!bytes.subarray(0, 3).equals(Buffer.from('#B '))) {
    return { header: [], blobs: [], json: JSON.parse(bytes.toString('utf8')) };
  }
  const end = bytes.indexOf(0x0a);
  const header = bytes.subarray(3, end).toString('latin1').split(' ').map(Number);
  let offset = end + 1;
  const blobs = header.map((length) => {
    const blob = bytes.subarray(offset, offset + length);
    offset += length;
    return blob;
  });
  return { header, blobs, json: JSON.parse(bytes.subarray(offset).toString('utf8')) };
}

/** What the core stores for an `initial_f32` JSON array (compute_graph.rs). */
function coreBytesFromJsonFloats(values: Array<number | null>): Buffer {
  const out = new Float32Array(values.length);
  values.forEach((value, index) => {
    const n = typeof value === 'number' ? value : 0;
    out[index] = Math.max(-1e20, Math.min(1e20, n));
  });
  return Buffer.from(out.buffer);
}

const graphBatch = (buffer: Record<string, unknown>): { id: number; method: string; params: { batch: { frame_id: number; commands: Array<{ type: string; buffers: Array<Record<string, unknown>> }> } } } => ({
  id: 4,
  method: 'submit_batch',
  params: { batch: { frame_id: 9, commands: [{ type: 'queue_compute_graph', buffers: [{ id: 'u', kind: 'uniform', ...buffer }] }] } },
});

describe('core IPC frames: requests', () => {
  const floats = new Float32Array([1.5, -0, 0, NaN, Infinity, -Infinity, 3e30, -3e30, 1e-40, 0.1, 123456.789]);

  it('sends a Float32Array as the same bytes the core would build from its JSON numbers', () => {
    const json = readFrame(encodeCoreRequest(graphBatch({ initial_f32: floats })).payload);
    const framed = encodeCoreRequest(graphBatch({ initial_f32: floats }), { frames: true });
    const frame = readFrame(framed.payload);
    const jsonBuffer = json.json.params.batch.commands[0].buffers[0];
    const framedBuffer = frame.json.params.batch.commands[0].buffers[0];

    // Without frames: the number array the renderer used to send.
    expect(jsonBuffer.initial_f32).toEqual(JSON.parse(JSON.stringify(Array.from(floats))));
    // With frames: a payload in place of the array, byte for byte what the
    // core makes of that array.
    expect(framedBuffer.initial_f32).toBeUndefined();
    expect(framedBuffer.initial_b64).toEqual({ $blob: 0 });
    expect(frame.blobs[0]).toEqual(coreBytesFromJsonFloats(jsonBuffer.initial_f32));
    expect(framed.bytes).toBe(Buffer.byteLength(framed.payload as Buffer));
    // The rest of the message is untouched.
    expect(frame.json).toMatchObject({ id: 4, method: 'submit_batch', params: { batch: { frame_id: 9 } } });
    expect(framedBuffer).toMatchObject({ id: 'u', kind: 'uniform' });
  });

  it('leaves the caller\'s objects as they were', () => {
    const message = graphBatch({ initial_f32: floats });
    const before = message.params.batch.commands[0].buffers[0];
    encodeCoreRequest(message, { frames: true });
    expect(message.params.batch.commands[0].buffers[0]).toBe(before);
    expect(before.initial_f32).toBe(floats);
  });

  it('keeps a field the core reads first in charge', () => {
    for (const ahead of [{ initial_b64: 'AAAA' }, { initial_file: '/tmp/x' }, { initial_u32: [1] }]) {
      const frame = readFrame(encodeCoreRequest(graphBatch({ ...ahead, initial_f32: new Float32Array([2]) }), { frames: true }).payload);
      expect(frame.blobs).toHaveLength(0);
      expect(frame.json.params.batch.commands[0].buffers[0]).toEqual({ id: 'u', kind: 'uniform', ...ahead, initial_f32: [2] });
    }
  });

  it('frames integer arrays and byte fields, and spells them out without frames', () => {
    const u32 = new Uint32Array([0, 7, 0xffffffff]);
    const i32 = new Int32Array([-5, 9]);
    const bytes = new Uint8Array([1, 2, 250]);
    const message = { id: 1, method: 'm', params: { a: { initial_u32: u32 }, b: [{ initial_i32: i32 }], c: { rgba_b64: bytes } } };

    const plain = readFrame(encodeCoreRequest(message).payload).json.params;
    expect(plain).toEqual({ a: { initial_u32: [0, 7, 0xffffffff] }, b: [{ initial_i32: [-5, 9] }], c: { rgba_b64: 'AQL6' } });

    const frame = readFrame(encodeCoreRequest(message, { frames: true }).payload);
    expect(frame.json.params).toEqual({ a: { initial_b64: { $blob: 0 } }, b: [{ initial_b64: { $blob: 1 } }], c: { rgba_b64: { $blob: 2 } } });
    expect(frame.blobs[0]).toEqual(Buffer.from(u32.buffer));
    expect(frame.blobs[1]).toEqual(Buffer.from(i32.buffer));
    expect(frame.blobs[2]).toEqual(Buffer.from(bytes));
  });

  it('writes a plain line when there is nothing binary to carry', () => {
    const encoded = encodeCoreRequest({ id: 2, method: 'status', params: { a: [1, 2], b: 'x' } }, { frames: true });
    expect(encoded.payload).toBe('{"id":2,"method":"status","params":{"a":[1,2],"b":"x"}}\n');
  });

  it('is off with GA_CORE_IPC=json', () => {
    expect(coreIpcFramesWanted({ GA_CORE_IPC: 'json' })).toBe(false);
    expect(coreIpcFramesWanted({ GA_CORE_IPC: ' JSON ' })).toBe(false);
    expect(coreIpcFramesWanted({})).toBe(true);
  });
});

describe('core IPC frames: replies', () => {
  const collect = () => {
    const seen: any[] = [];
    const reader = createCoreOutputReader((line: string, blobs: Buffer[] | null) => {
      if (line) seen.push(decodeCoreLine(line, blobs));
    });
    return { seen, reader };
  };

  it('reads plain lines, split anywhere, as before', () => {
    const { seen, reader } = collect();
    const text = '{"id":1,"ok":true,"result":"é"}\n{"id":2,"ok":true}\n';
    const bytes = Buffer.from(text);
    for (let i = 0; i < bytes.length; i += 3) reader.push(bytes.subarray(i, i + 3));
    reader.push('{"id":3');
    reader.push(',"ok":false}\n');
    expect(seen).toEqual([{ id: 1, ok: true, result: 'é' }, { id: 2, ok: true }, { id: 3, ok: false }]);
  });

  it('puts lifted base64 back where the core took it from', () => {
    const { seen, reader } = collect();
    const pixels = Buffer.alloc(70000, 7).toString('base64');
    const frame = Buffer.concat([
      Buffer.from(`#B ${pixels.length}\n`), Buffer.from(pixels),
      Buffer.from('{"id":5,"ok":true,"result":{"width":2,"rgba_b64":{"$blob":0}}}\n{"id":6,"ok":true}\n'),
    ]);
    for (let i = 0; i < frame.length; i += 4096) reader.push(frame.subarray(i, i + 4096));
    expect(seen).toEqual([{ id: 5, ok: true, result: { width: 2, rgba_b64: pixels } }, { id: 6, ok: true }]);
  });

  it('hands raw payloads over as Uint8Arrays of exactly their bytes', () => {
    const { seen, reader } = collect();
    const pixels = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) & 255));
    const jpegText = Buffer.alloc(70000, 9).toString('base64');
    const frame = Buffer.concat([
      Buffer.from(`#B ${pixels.length} ${jpegText.length}\n`), pixels, Buffer.from(jpegText),
      Buffer.from('{"id":7,"ok":true,"result":{"rgba_raw":{"$bytes":0},"jpeg_b64":{"$blob":1}}}\n'),
    ]);
    for (let i = 0; i < frame.length; i += 4096) reader.push(frame.subarray(i, i + 4096));
    const result = seen[0].result;
    expect(result.rgba_raw).toBeInstanceOf(Uint8Array);
    // Its own buffer: IPC copies the whole backing store of a view.
    expect(result.rgba_raw.byteOffset).toBe(0);
    expect(result.rgba_raw.buffer.byteLength).toBe(pixels.length);
    expect(Buffer.from(result.rgba_raw).equals(pixels)).toBe(true);
    expect(result.jpeg_b64).toBe(jpegText);
    expect(() => decodeCoreLine('{"id":8,"result":{"rgba_raw":{"$bytes":3}}}', [pixels])).toThrow();
  });

  it('asks for raw bytes unless told not to', () => {
    expect(coreIpcBytesWanted({})).toBe(true);
    expect(coreIpcBytesWanted({ GA_CORE_IPC_BYTES: '0' })).toBe(false);
    expect(coreIpcBytesWanted({ GA_CORE_IPC: 'json' })).toBe(false);
  });

  it('recognises the core\'s hello', () => {
    expect(isCoreIpcFramesHello({ id: 0, ipc_frames: 1 })).toBe(true);
    expect(isCoreIpcFramesHello({ id: 3, ok: true })).toBe(false);
  });
});

describe('broker transport', () => {
  const makeBroker = (env: Record<string, string> = {}) => createNativeRendererBroker({
    appRoot: process.cwd(), resourcesPath: process.cwd(), isPackaged: false, platform: process.platform, env,
  });

  it('frames requests only after the core says it reads them', async () => {
    const broker = makeBroker();
    const writes: Array<string | Buffer> = [];
    broker.child = { killed: false, stdin: { writable: true, write: (payload: string | Buffer) => { writes.push(payload); return true; } } };
    const params = { commands: [{ type: 'queue_compute_graph', buffers: [{ id: 'u', initial_f32: new Float32Array([1, 2]) }] }] };

    const first = broker.send('submit_commands', params);
    expect(typeof writes[0]).toBe('string');
    expect(JSON.parse(writes[0] as string).params.commands[0].buffers[0].initial_f32).toEqual([1, 2]);

    broker.handleStdout('{"id":0,"ipc_frames":1}\n');
    expect(broker.coreIpcFrames).toBe(true);
    const second = broker.send('submit_commands', params);
    const frame = readFrame(writes[1]);
    expect(frame.blobs[0]).toEqual(Buffer.from(new Float32Array([1, 2]).buffer));
    expect(broker.pendingBytes).toBe(Buffer.byteLength(writes[0] as string) + (writes[1] as Buffer).length);

    // Replies resolve as before, in either form.
    broker.handleStdout(`{"id":1,"ok":true,"result":{"applied":1}}\n`);
    const b64 = Buffer.alloc(30000, 1).toString('base64');
    broker.handleStdout(Buffer.concat([Buffer.from(`#B ${b64.length}\n${b64}`), Buffer.from('{"id":2,"ok":true,"result":{"rgba_b64":{"$blob":0}}}\n')]));
    await expect(first).resolves.toEqual({ applied: 1 });
    await expect(second).resolves.toEqual({ rgba_b64: b64 });
    expect(broker.pending.size).toBe(0);
  });

  it('keeps plain JSON with GA_CORE_IPC=json, even if a core says hello', () => {
    const broker = makeBroker({ GA_CORE_IPC: 'json' });
    const writes: Array<string | Buffer> = [];
    broker.child = { killed: false, stdin: { writable: true, write: (payload: string | Buffer) => { writes.push(payload); return true; } } };
    broker.handleStdout('{"id":0,"ipc_frames":1}\n');
    expect(broker.coreIpcFrames).toBe(false);
    broker.notify('submit_commands', { commands: [{ type: 'x', buffers: [{ initial_f32: new Float32Array([3]) }] }] });
    expect(JSON.parse(writes[0] as string).params.commands[0].buffers[0].initial_f32).toEqual([3]);
  });
});
