import { describe, expect, it } from 'vitest';
import { IDLE, isRunning, renderStep, type RenderEvent, type RenderFlow } from './renderFlow';

const run = (events: RenderEvent[], from: RenderFlow = IDLE) => events.reduce(renderStep, from);
const preparing: RenderFlow = { kind: 'preparing', step: 'output', stopping: false };
const rendering: RenderFlow = { kind: 'rendering', frame: 10, total: 100, stopping: false };
const encoding: RenderFlow = { kind: 'encoding', step: 'video', progress: 0.5, stopping: false };
const terminal: RenderFlow[] = [IDLE, { kind: 'done' }, { kind: 'cancelled' }, { kind: 'error', message: 'x' }];
const running: RenderFlow[] = [preparing, rendering, encoding];

describe('render flow', () => {
  it('runs idle → preparing → rendering → encoding → done', () => {
    const flow = run([
      { type: 'start' },
      { type: 'prepare', step: 'sound' },
      { type: 'frame', frame: 0, total: 3 },
      { type: 'frame', frame: 3, total: 3 },
      { type: 'encode', step: 'sound', progress: 0.8 },
      { type: 'encode', step: 'saving', progress: 1 },
      { type: 'finish' },
    ]);
    expect(flow).toEqual({ kind: 'done' });
  });

  it('start: from idle or any end, never over a running render', () => {
    for (const f of terminal) expect(renderStep(f, { type: 'start' })).toEqual(preparing);
    for (const f of running) expect(renderStep(f, { type: 'start' })).toBe(f);
  });

  it('prepare: only while preparing (or between segments), not mid-frame', () => {
    expect(renderStep(preparing, { type: 'prepare', step: 'sound' })).toEqual({ kind: 'preparing', step: 'sound', stopping: false });
    expect(renderStep(rendering, { type: 'prepare', step: 'sound' })).toBe(rendering);
    expect(renderStep(encoding, { type: 'prepare', step: 'encoder' }).kind).toBe('preparing');
    for (const f of terminal) expect(renderStep(f, { type: 'prepare', step: 'sound' })).toBe(f);
  });

  it('frame: from any running state, clamped to the total', () => {
    for (const f of running) expect(renderStep(f, { type: 'frame', frame: 5, total: 4 })).toEqual({ kind: 'rendering', frame: 4, total: 4, stopping: false });
    for (const f of terminal) expect(renderStep(f, { type: 'frame', frame: 1, total: 4 })).toBe(f);
  });

  it('encode: after frames (the browser fallback alternates), never before', () => {
    expect(renderStep(rendering, { type: 'encode', step: 'video', progress: 2 })).toEqual({ kind: 'encoding', step: 'video', progress: 1, stopping: false });
    expect(renderStep(encoding, { type: 'encode', step: 'sound' })).toEqual({ kind: 'encoding', step: 'sound', progress: 0, stopping: false });
    expect(renderStep(preparing, { type: 'encode', step: 'video' })).toBe(preparing);
    expect(renderStep(encoding, { type: 'frame', frame: 1, total: 2 }).kind).toBe('rendering');
    for (const f of terminal) expect(renderStep(f, { type: 'encode', step: 'video' })).toBe(f);
  });

  it('finish: from rendering or encoding only', () => {
    expect(renderStep(rendering, { type: 'finish' })).toEqual({ kind: 'done' });
    expect(renderStep(encoding, { type: 'finish' })).toEqual({ kind: 'done' });
    expect(renderStep(preparing, { type: 'finish' })).toBe(preparing);
    for (const f of terminal) expect(renderStep(f, { type: 'finish' })).toBe(f);
  });

  it('stop marks a running render stopping and keeps it running until it has cleaned up', () => {
    for (const f of running) {
      const stopping = renderStep(f, { type: 'stop' });
      expect(isRunning(stopping) && stopping.stopping).toBe(true);
      // Progress keeps the mark; a new start is still refused.
      const later = renderStep(renderStep(stopping, { type: 'frame', frame: 11, total: 100 }), { type: 'start' });
      expect(isRunning(later) && later.stopping).toBe(true);
      expect(renderStep(stopping, { type: 'stopped' })).toEqual({ kind: 'cancelled' });
    }
    for (const f of terminal) {
      expect(renderStep(f, { type: 'stop' })).toBe(f);
      expect(renderStep(f, { type: 'stopped' })).toBe(f);
    }
  });

  it('fail: from a running state, with a message', () => {
    for (const f of running) expect(renderStep(f, { type: 'fail', message: 'disk full' })).toEqual({ kind: 'error', message: 'disk full' });
    expect(renderStep(rendering, { type: 'fail', message: '' })).toEqual({ kind: 'error', message: 'The render failed' });
    for (const f of terminal) expect(renderStep(f, { type: 'fail', message: 'x' })).toBe(f);
  });

  it('reset: back to idle from an end, never while running', () => {
    for (const f of terminal) expect(renderStep(f, { type: 'reset' })).toEqual(IDLE);
    for (const f of running) expect(renderStep(f, { type: 'reset' })).toBe(f);
  });
});
