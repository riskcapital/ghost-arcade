import { describe, expect, it } from 'vitest';
import { readResponseBuffer } from './plyLoader';

function streamed(chunks: Uint8Array[], length: number | null): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  const headers = new Headers();
  if (length !== null) headers.set('content-length', String(length));
  return new Response(body, { headers });
}

describe('readResponseBuffer', () => {
  it('reports read progress as the bytes arrive', async () => {
    const chunks = Array.from({ length: 4 }, (_, i) => new Uint8Array(256).fill(i + 1));
    const seen: number[] = [];
    const buffer = await readResponseBuffer(streamed(chunks, 1024), (s) => seen.push(s.progress));
    const bytes = new Uint8Array(buffer);
    expect(bytes.byteLength).toBe(1024);
    expect([bytes[0], bytes[300], bytes[600], bytes[1023]]).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([0.25, 0.5, 0.75, 1, 1]);
  });

  it('copes with a stated length that is wrong', async () => {
    const chunks = [new Uint8Array(100).fill(7), new Uint8Array(100).fill(9)];
    const long = new Uint8Array(await readResponseBuffer(streamed(chunks, 50), () => {}));
    expect(long.byteLength).toBe(200);
    expect(long[199]).toBe(9);
    const short = new Uint8Array(await readResponseBuffer(streamed(chunks, 500), () => {}));
    expect(short.byteLength).toBe(200);
  });

  it('reads whole when the size is unknown', async () => {
    const seen: number[] = [];
    const bytes = new Uint8Array(await readResponseBuffer(streamed([new Uint8Array(10).fill(3)], null), (s) => seen.push(s.progress)));
    expect(bytes.byteLength).toBe(10);
    expect(seen).toEqual([1]);
  });
});
