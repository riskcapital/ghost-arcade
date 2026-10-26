import { describe, expect, it } from 'vitest';
import {
  describeNativeCoreFailure,
  nativeCoreLossReason,
  nativeCoreRestartDelay,
  NATIVE_CORE_RESTART_DELAYS_MS,
  stripIpcErrorPrefix,
} from './nativeCoreSupervisor';

describe('native core supervisor', () => {
  it('backs off between automatic restarts, then stops trying', () => {
    expect(NATIVE_CORE_RESTART_DELAYS_MS.map((_, i) => nativeCoreRestartDelay(i))).toEqual([1000, 3000, 8000]);
    expect(nativeCoreRestartDelay(NATIVE_CORE_RESTART_DELAYS_MS.length)).toBeNull();
  });

  it('notices a core that stopped by itself', () => {
    expect(nativeCoreLossReason({ running: false, last_frame_error: 'The render core stopped (code 0xC0000005).',
      core_exited_unexpectedly: true, core_instance: 1 }, 1)).toContain('0xC0000005');
  });

  it('notices a core the broker replaced, which starts without the scene', () => {
    expect(nativeCoreLossReason({ running: true, last_frame_error: null, core_instance: 3 }, 2)).toBe('The render core restarted.');
  });

  it('stays quiet while the core it started keeps running', () => {
    expect(nativeCoreLossReason({ running: true, last_frame_error: null, core_instance: 2 }, 2)).toBeNull();
    expect(nativeCoreLossReason({ running: false, last_frame_error: 'Native render core stopped', core_exited_unexpectedly: false }, 2)).toBeNull();
    expect(nativeCoreLossReason(null, 2)).toBeNull();
  });

  it('keeps only the core message from an Electron IPC error', () => {
    expect(stripIpcErrorPrefix("Error invoking remote method 'native_renderer_start': Error: The render core stopped (code 0xC0000135)."))
      .toBe('The render core stopped (code 0xC0000135).');
  });

  it('leads with the broker hint for a missing Windows component', () => {
    const failure = describeNativeCoreFailure(new Error('x'), {
      running: false,
      last_frame_error: 'The render core stopped (code 0xC0000135).',
      core_exited_unexpectedly: true,
      core_failure_hint: "On Windows N or KN editions, install Microsoft's Media Feature Pack.",
    });
    expect(failure.title).toBe('Render core could not start');
    expect(failure.detail).toContain('0xC0000135');
    expect(failure.hint).toContain('Media Feature Pack');
  });

  it('explains a start that timed out and a missing core binary', () => {
    expect(describeNativeCoreFailure(new Error('Native render core request start timed out after 8000ms'), null).hint)
      .toMatch(/Retry/);
    expect(describeNativeCoreFailure(new Error('Native render core binary missing'), null).hint).toMatch(/Reinstall/);
    expect(describeNativeCoreFailure('boom', null, { stopped: true }).title).toBe('Render core stopped');
  });
});
