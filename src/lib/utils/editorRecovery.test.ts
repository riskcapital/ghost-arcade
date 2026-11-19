import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/** The editor window's crash / hang recovery (electron/editor-recovery.cjs). */
const require = createRequire(import.meta.url);
const { createEditorRecovery, describeReason } = require(join(process.cwd(), 'electron', 'editor-recovery.cjs'));

function harness(overrides: Record<string, unknown> = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const reloads: number[] = [];
  const exhausted: any[] = [];
  const dismissed: number[] = [];
  const lines: string[] = [];
  let flushes = 0;
  let reloadable = true;
  const recovery = createEditorRecovery({
    reload: () => reloads.push(clock),
    canReload: () => reloadable,
    onExhausted: (info: any) => {
      exhausted.push(info);
      return () => dismissed.push(clock);
    },
    diagnostics: () => 'core adapter="Test GPU"',
    log: { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) },
    flush: () => { flushes += 1; },
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimer: (id: number) => { timers.delete(id); },
    graceMs: 10_000,
    maxAttempts: 3,
    stableMs: 60_000,
    ...overrides,
  });
  /** Move the clock on, firing due timers in order. */
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = end;
  };
  return {
    recovery,
    advance,
    reloads,
    exhausted,
    dismissed,
    lines,
    pending: () => timers.size,
    flushes: () => flushes,
    setReloadable: (v: boolean) => { reloadable = v; },
  };
}

describe('editor recovery', () => {
  it('a hang that ends inside the grace period is never reloaded later', () => {
    const h = harness();
    h.recovery.unresponsive();
    expect(h.recovery.state().kind).toBe('unresponsive');
    h.advance(4_000);
    h.recovery.responsive();
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 0 });
    expect(h.pending()).toBe(0);
    h.advance(120_000);
    expect(h.reloads).toEqual([]);
  });

  it('repeated unresponsive events keep one timer', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(3_000);
    h.recovery.unresponsive();
    h.recovery.unresponsive();
    expect(h.pending()).toBe(1);
    h.advance(7_000);
    expect(h.reloads).toEqual([10_000]);
  });

  it('a hang that outlasts the grace period reloads once', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(10_000);
    expect(h.reloads).toEqual([10_000]);
    expect(h.recovery.state()).toMatchObject({ kind: 'recovering', attempts: 1, cause: 'hang' });
    h.recovery.loaded();
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 1 });
  });

  it('a closed window is never reloaded by a pending hang timer', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(5_000);
    h.recovery.closed();
    expect(h.pending()).toBe(0);
    h.advance(60_000);
    expect(h.reloads).toEqual([]);
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    h.recovery.unresponsive();
    h.advance(60_000);
    expect(h.reloads).toEqual([]);
    expect(h.recovery.state().kind).toBe('closed');
  });

  it('a crash during the grace period reloads once, not twice', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(5_000);
    h.recovery.gone({ reason: 'crashed', exitCode: -1073741819 });
    expect(h.reloads).toEqual([5_000]);
    h.advance(60_000);
    expect(h.reloads).toEqual([5_000]);
    expect(h.lines.some((l) => l.includes('exitCode=-1073741819') && l.includes('core adapter="Test GPU"'))).toBe(true);
  });

  it('a page loading by itself cancels the pending hang reload', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.recovery.navigationStarted();
    h.advance(60_000);
    expect(h.reloads).toEqual([]);
    expect(h.recovery.state().kind).toBe('healthy');
  });

  it('no hang reload while the page is crashed or loading', () => {
    const h = harness();
    h.setReloadable(false);
    h.recovery.unresponsive();
    h.advance(10_000);
    expect(h.reloads).toEqual([]);
    expect(h.recovery.state().kind).toBe('healthy');
  });

  it('our own reload starting a navigation does not cancel the recovery', () => {
    const h = harness();
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    h.recovery.navigationStarted();
    expect(h.recovery.state()).toMatchObject({ kind: 'recovering', attempts: 1 });
  });

  it('crash loops stop after three reloads and say so', () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) {
      h.recovery.gone({ reason: 'crashed', exitCode: 5 });
      h.recovery.loaded();
      h.advance(20_000);
    }
    expect(h.reloads).toHaveLength(3);
    h.recovery.gone({ reason: 'oom', exitCode: 7 });
    expect(h.reloads).toHaveLength(3);
    expect(h.recovery.state()).toMatchObject({ kind: 'exhausted', attempts: 3, cause: 'crash', reason: 'oom' });
    expect(h.exhausted).toEqual([{ cause: 'crash', reason: 'oom', exitCode: 7, attempts: 3 }]);
    expect(h.lines.some((l) => l.includes('GAVE UP') && l.includes('reason=oom') && l.includes('exitCode=7') && l.includes('Test GPU'))).toBe(true);
    // Further crashes are logged but never reload or ask again.
    h.recovery.gone({ reason: 'crashed', exitCode: 5 });
    expect(h.reloads).toHaveLength(3);
    expect(h.exhausted).toHaveLength(1);
  });

  it('hang and crash attempts share one budget', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(10_000); // attempt 1 (hang)
    h.recovery.gone({ reason: 'crashed', exitCode: 1 }); // attempt 2 while reloading
    h.recovery.unresponsive(); // the reloaded page hangs
    h.advance(10_000); // attempt 3
    expect(h.reloads).toHaveLength(3);
    h.recovery.unresponsive();
    h.advance(10_000);
    expect(h.reloads).toHaveLength(3);
    expect(h.recovery.state()).toMatchObject({ kind: 'exhausted', cause: 'hang' });
  });

  it('attempts reset once the page has stayed healthy for a minute', () => {
    const h = harness();
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    h.recovery.loaded();
    h.advance(59_000);
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 1 });
    h.advance(1_000);
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 0 });
    expect(h.pending()).toBe(0);
  });

  it('a hang that ends after giving up returns to healthy and closes the message', () => {
    const h = harness({ maxAttempts: 0 });
    h.recovery.unresponsive();
    h.advance(10_000);
    expect(h.recovery.state().kind).toBe('exhausted');
    expect(h.reloads).toEqual([]);
    h.recovery.responsive();
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 0 });
    expect(h.dismissed).toHaveLength(1);
  });

  it('try again from the message gives a fresh set of attempts', () => {
    const h = harness({ maxAttempts: 1 });
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    expect(h.recovery.state().kind).toBe('exhausted');
    h.recovery.retry();
    expect(h.dismissed).toHaveLength(1);
    expect(h.reloads).toHaveLength(2);
    expect(h.recovery.state()).toMatchObject({ kind: 'recovering', attempts: 1, cause: 'user' });
    h.recovery.loaded();
    expect(h.recovery.state().kind).toBe('healthy');
  });

  it('a reload by hand after giving up starts over', () => {
    const h = harness({ maxAttempts: 0 });
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    h.recovery.navigationStarted();
    expect(h.dismissed).toHaveLength(1);
    h.recovery.loaded();
    expect(h.recovery.state()).toEqual({ kind: 'healthy', attempts: 0 });
  });

  it('install mode taking over cancels the pending reload', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.recovery.handedOff('install mode');
    h.advance(60_000);
    expect(h.reloads).toEqual([]);
  });

  it('a throwing reload or diagnostics does not break the machine', () => {
    const h = harness({
      reload: () => { throw new Error('gone'); },
      diagnostics: () => { throw new Error('no gpu info'); },
    });
    h.recovery.gone({ reason: 'crashed', exitCode: 1 });
    expect(h.recovery.state().kind).toBe('recovering');
    expect(h.lines.some((l) => l.includes('reload failed'))).toBe(true);
    expect(h.lines.some((l) => l.includes('diagnostics failed'))).toBe(true);
  });

  it('flushes the log on every failure so a hard kill keeps it', () => {
    const h = harness();
    h.recovery.unresponsive();
    h.advance(10_000);
    expect(h.flushes()).toBeGreaterThanOrEqual(2);
  });

  it('describes reasons in plain words', () => {
    expect(describeReason('oom')).toBe('the editor ran out of memory');
    expect(describeReason('weird')).toBe('the editor stopped (weird)');
  });
});

describe('recovery diagnostics line', () => {
  const { formatRecoveryDiagnostics } = require(join(process.cwd(), 'electron', 'editor-recovery.cjs'));

  it('names the core adapter, driver, Chromium GPU and memory', () => {
    const line = formatRecoveryDiagnostics({
      coreStatus: {
        backend: 'dx12',
        running: true,
        adapter_name: 'NVIDIA GeForce RTX 3050 Ti Laptop GPU',
        adapter_luid: '0000-1234',
        native_caps: { adapter_vendor: 0x10de, adapter_device: 0x25a0, adapter_driver: 'NVIDIA', adapter_driver_info: '566.36' },
        last_frame_error: 'device lost',
      },
      gpuInfo: { gpuDevice: [{ active: false, vendorId: 0x8086, deviceId: 0x9a49 }, { active: true, vendorId: 0x10de, deviceId: 0x25a0, driverVersion: '32.0.15.6636' }] },
      featureStatus: { gpu_compositing: 'enabled', webgl: 'enabled' },
      systemMemory: { total: 16 * 1024 * 1024, free: 512 * 1024 },
      appMetrics: [{ type: 'Browser', memory: { workingSetSize: 200 * 1024 } }, { type: 'GPU', memory: { workingSetSize: 900 * 1024 } }],
    });
    expect(line).toContain('core adapter="NVIDIA GeForce RTX 3050 Ti Laptop GPU" (dx12, vendor=0x10de device=0x25a0 luid=0000-1234)');
    expect(line).toContain('driver="NVIDIA 566.36"');
    expect(line).toContain('last-error="device lost"');
    expect(line).toContain('chromium gpu=0x8086:0x9a49, *0x10de:0x25a0 driver 32.0.15.6636');
    expect(line).toContain('compositing=enabled');
    expect(line).toContain('memory free=512 MB of 16384 MB');
    expect(line).toContain('app=1100 MB (Browser=200 MB GPU=900 MB)');
  });

  it('reads "unknown" when nothing is known yet', () => {
    expect(formatRecoveryDiagnostics({})).toBe('core adapter=unknown | chromium gpu=unknown');
  });
});
