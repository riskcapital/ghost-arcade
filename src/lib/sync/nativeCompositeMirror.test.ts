import { afterEach, expect, it, vi } from 'vitest';

vi.mock('$lib/bridge', () => ({ invoke: vi.fn() }));

import { invoke } from '$lib/bridge';
import { acquireNativeCompositeMirror } from './nativeCompositeMirror';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubCanvas() {
  vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1, getContext: () => ({ putImageData() {}, drawImage() {} }) }) });
}

function lastMaxDim(): number | undefined {
  const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'native_renderer_get_frame_snapshot');
  return (calls.at(-1)?.[1] as { max_dim?: number } | undefined)?.max_dim;
}

it('reads at the largest live consumer and drops back when it releases', async () => {
  vi.useFakeTimers();
  stubCanvas();
  vi.mocked(invoke).mockResolvedValue(null);
  const preview = acquireNativeCompositeMirror({ maxDim: 1024, fps: 30 });
  const led = acquireNativeCompositeMirror({ maxDim: 192, fps: 20 });
  await vi.advanceTimersByTimeAsync(40);
  expect(lastMaxDim()).toBe(1024);
  preview.release();
  vi.mocked(invoke).mockClear();
  await vi.advanceTimersByTimeAsync(60);
  // Back to small raw frames: no JPEG encoding asked for.
  expect(lastMaxDim()).toBe(192);
  const call = vi.mocked(invoke).mock.calls.at(-1)?.[1] as { encoding?: string; pixel_bytes?: boolean };
  expect(call.encoding).toBeUndefined();
  // Pixels come back as raw bytes where the core can send them.
  expect(call.pixel_bytes).toBe(true);
  // A larger consumer joining later raises it again.
  const sim = acquireNativeCompositeMirror({ maxDim: 1280, fps: 24 });
  vi.mocked(invoke).mockClear();
  await vi.advanceTimersByTimeAsync(60);
  expect(lastMaxDim()).toBe(1280);
  sim.release();
  led.release();
});
