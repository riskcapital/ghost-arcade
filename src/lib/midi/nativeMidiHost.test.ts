import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNativeMidiHost, envOptIn } = require('../../../electron/native-midi.cjs');

function fakeAddon() {
  let onEvent: ((kind: string, payload?: unknown) => void) | null = null;
  let clock = 500;
  const addon = {
    virtualPortsSupported: true,
    start: vi.fn((cb: typeof onEvent) => { onEvent = cb; return { ok: true, virtual: true }; }),
    stop: vi.fn(),
    ports: vi.fn(() => ({ inputs: [{ id: 'virtual-in', name: 'Ghost Arcade', manufacturer: 'Ghost Arcade', virtual: true }], outputs: [] })),
    send: vi.fn((_id: string, _data: Uint8Array) => true),
    nowMs: () => clock,
    advance(ms: number) { clock += ms; },
    fire(kind: string, payload?: unknown) { onEvent?.(kind, payload); },
  };
  return addon;
}

function receiver() {
  const sent: [string, any][] = [];
  return { sent, send: (ch: string, payload: any) => sent.push([ch, payload]), isDestroyed: () => false, once: vi.fn() };
}

describe('native MIDI host (main process)', () => {
  it('reads the opt-in from GA_NATIVE_MIDI', () => {
    expect(envOptIn({ GA_NATIVE_MIDI: '1' })).toBe(true);
    expect(envOptIn({})).toBe(false);
  });

  it('starts once, forwards messages with times moved to the epoch clock', () => {
    const addon = fakeAddon();
    let epoch = 1_700_000_000_000;
    const host = createNativeMidiHost({ loadAddon: () => addon, epochNow: () => epoch, env: {} });
    const wc = receiver();
    expect(host.start(wc)).toMatchObject({ ok: true, virtual: true, ports: { inputs: [{ id: 'virtual-in' }] } });
    host.start(wc);
    expect(addon.start).toHaveBeenCalledTimes(1);
    // Captured at addon time 495; handled when the addon clock reads 500 and the epoch reads `epoch`.
    addon.fire('messages', [{ p: 'virtual-in', d: Buffer.from([0x90, 60, 1]), t: 495 }]);
    expect(wc.sent).toHaveLength(1);
    const [channel, messages] = wc.sent[0];
    expect(channel).toBe('native-midi-messages');
    expect(messages[0].port).toBe('virtual-in');
    expect(Array.from(messages[0].data)).toEqual([0x90, 60, 1]);
    expect(messages[0].t).toBe(epoch - 5);
    // Delivered late: the time still says when it arrived.
    addon.advance(40); epoch += 40;
    addon.fire('messages', [{ p: 'virtual-in', d: Buffer.from([0xF8]), t: 497 }]);
    expect(wc.sent[1][1][0].t).toBe(epoch - 43);
    addon.fire('ports');
    expect(wc.sent[2][0]).toBe('native-midi-ports');
  });

  it('sends bytes, reports a missing addon, stops on quit', () => {
    const missing = createNativeMidiHost({ loadAddon: () => null, loadError: () => 'midi_addon.node not built', env: { GA_NATIVE_MIDI: '1' } });
    expect(missing.status()).toMatchObject({ available: false, envOptIn: true, error: 'midi_addon.node not built' });
    expect(missing.start(receiver())).toMatchObject({ ok: false });
    const addon = fakeAddon();
    const host = createNativeMidiHost({ loadAddon: () => addon, env: {} });
    expect(host.send('virtual-out', [0x90, 1, 2])).toBe(false);
    host.start(receiver());
    expect(host.send('virtual-out', [0x90, 1, 2])).toBe(true);
    expect(Array.from(addon.send.mock.calls[0][1] as Uint8Array)).toEqual([0x90, 1, 2]);
    host.stop();
    expect(addon.stop).toHaveBeenCalled();
  });
});
