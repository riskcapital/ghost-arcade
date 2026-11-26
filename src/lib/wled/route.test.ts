/**
 * The WLED route (electron/wled-route.cjs): which side sends each
 * controller, and link states moving with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWledRoute } = require('../../../electron/wled-route.cjs');

const controller = (id: string) => ({ id, name: id.toUpperCase(), ip: '10.0.0.5', port: 21324, points: [0.5, 0.5], sampleRadius: 0, samplingMode: 'dominant', testPattern: 'off' });
const PLAN = { fps: 20, forceBlack: false, maxDim: 192, controllers: [controller('a'), controller('b')] };
const coreLink = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ controllerId: id, name: id.toUpperCase(), ip: '10.0.0.5', port: 21324, state, downSince: null, lastOkAt: 5, lastError: null, errors: 0, sent: 7, ...extra });

function fakeLinks(list: unknown[] = []) {
  return {
    list: vi.fn(() => list),
    seed: vi.fn(),
    close: vi.fn(),
    send: vi.fn(async () => ({ ok: true })),
  };
}

let timers: Array<() => void> = [];
afterEach(() => { timers = []; });

function route(core: (command: string, args: any) => unknown, opts: { env?: Record<string, string>; supported?: boolean; list?: unknown[] } = {}) {
  const links = fakeLinks(opts.list);
  const invokeCore = vi.fn(async (command: string, args: unknown) => core(command, args));
  const changes: any[] = [];
  let clock = 100_000;
  const r = createWledRoute({
    links, invokeCore, coreSupported: () => opts.supported ?? true, env: opts.env ?? {}, log: { warn() {} },
    onChange: (info: unknown) => changes.push(info), now: () => clock,
    setTimer: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimer: () => { timers = []; },
  });
  return { r, links, invokeCore, changes, advance: (ms: number) => { clock += ms; } };
}

describe('WLED route between the render core and the app', () => {
  it('gives the core the controllers with their app link states, and closes the app sockets', async () => {
    const appLinks = [{ controllerId: 'a', state: 'down', downSince: 90_000 }, { controllerId: 'z', state: 'up' }];
    const { r, links, invokeCore } = route((command) => (command === 'wled_configure'
      ? { ok: true, configured: true, links: [coreLink('a', 'down', { downSince: 90_000 }), coreLink('b', 'unknown')], released: [] }
      : null), { list: appLinks });
    expect(await r.configure(PLAN)).toEqual({ ok: true });
    expect(invokeCore).toHaveBeenCalledWith('wled_configure', { plan: PLAN, links: [appLinks[0]] });
    expect(links.close).toHaveBeenCalledWith('a');
    expect(links.close).toHaveBeenCalledWith('b');
    expect([...r.coreIds()]).toEqual(['a', 'b']);
    // Install status lists both sides.
    expect(r.list().map((l: any) => [l.controllerId, l.state, l.core === true])).toEqual([['z', 'up', false], ['a', 'down', true], ['b', 'unknown', true]]);
  });

  it('takes one controller back before the app sends it, with the core link state', async () => {
    const calls: any[] = [];
    const { r, links, invokeCore } = route((command, args) => {
      calls.push([command, args]);
      if (command !== 'wled_configure') return null;
      const ids = args.plan.controllers.map((c: { id: string }) => c.id);
      return { ok: true, configured: true, links: ids.map((id: string) => coreLink(id, 'up')), released: ids.includes('b') ? [] : [coreLink('b', 'up')] };
    });
    await r.configure(PLAN);
    await r.send({ controllerId: 'b', ip: '10.0.0.5', port: 21324, packet: Buffer.from([2, 2, 1, 2, 3]) });
    const last = invokeCore.mock.calls.at(-1)!;
    expect(last[0]).toBe('wled_configure');
    expect((last[1] as any).plan.controllers.map((c: { id: string }) => c.id)).toEqual(['a']);
    expect(links.seed).toHaveBeenCalledWith(expect.objectContaining({ controllerId: 'b', state: 'up' }));
    expect(links.send).toHaveBeenCalledTimes(1);
    expect([...r.coreIds()]).toEqual(['a']);
    // Sending the last one stops the core altogether.
    await r.send({ controllerId: 'a', ip: '10.0.0.5', port: 21324, packet: Buffer.from([2, 2, 1, 2, 3]) });
    expect(invokeCore.mock.calls.at(-1)![0]).toBe('wled_stop');
    expect(r.stats()).toEqual({ core: false, coreLost: false });
  });

  it('reports each link change once, from whichever side saw it', async () => {
    let state = 'up';
    const { r, changes, advance } = route((command) => {
      if (command === 'wled_configure') return { ok: true, configured: true, links: [coreLink('a', 'unknown')], released: [] };
      if (command === 'wled_state') return { configured: true, controllers: [coreLink('a', state, state === 'down' ? { downSince: 100_000, lastError: 'EHOSTDOWN' } : {})] };
      return null;
    });
    // The app saw it go down before the move.
    r.linkChange({ controllerId: 'a', name: 'A', ip: '10.0.0.5', port: 21324, state: 'down', error: 'EHOSTDOWN', downSince: 100_000 });
    expect(changes.map((c) => c.state)).toEqual(['down']);
    await r.configure({ ...PLAN, controllers: [controller('a')] });
    state = 'down';
    await r.pollNow();
    expect(changes).toHaveLength(1);
    advance(12_000);
    state = 'up';
    await r.pollNow();
    expect(changes.at(-1)).toMatchObject({ state: 'up', previous: 'down', downForMs: 12_000 });
    // Changes from the app's own link for a controller the core sends are not its to report.
    r.linkChange({ controllerId: 'a', state: 'down', error: 'stale' });
    expect(changes).toHaveLength(2);
  });

  it('keeps the app path with GA_CORE_WLED=0, an old core or a refusal', async () => {
    const off = route(() => ({ configured: true }), { env: { GA_CORE_WLED: '0' } });
    expect(await off.r.configure(PLAN)).toEqual({ ok: false, reason: 'disabled by GA_CORE_WLED=0' });
    expect(off.invokeCore).not.toHaveBeenCalledWith('wled_configure', expect.anything());
    const old = route(() => ({ configured: true }), { supported: false });
    expect((await old.r.configure(PLAN)).ok).toBe(false);
    const refused = route((command) => (command === 'wled_configure' ? { error: 'bad IPv4 address' } : null));
    expect(await refused.r.configure(PLAN)).toEqual({ ok: false, reason: 'bad IPv4 address' });
    expect(refused.links.close).not.toHaveBeenCalled();
  });

  it('notices a core that stops answering, and replans a restarted one', async () => {
    let answer: unknown = { configured: false };
    const { r, invokeCore } = route((command) => (command === 'wled_configure' ? { ok: true, configured: true, links: [coreLink('a', 'up')], released: [] } : answer));
    await r.configure(PLAN);
    await r.pollNow();
    expect(invokeCore.mock.calls.filter(([c]) => c === 'wled_configure')).toHaveLength(2);
    expect(r.stats().core).toBe(true);
    answer = null;
    await r.pollNow();
    expect(r.stats()).toEqual({ core: false, coreLost: true });
    expect([...r.coreIds()]).toEqual([]);
  });
});
