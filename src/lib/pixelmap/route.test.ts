import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPixelMapRoute } = require('../../../electron/pixelmap-route.cjs');

const PLAN = { fps: 40, artSync: false, sacn: { priority: 100, sourceName: 'Ghost Arcade', cid: '5f1b1c2e-8d3a-4c6b-9e0f-1a2b3c4d5e6f' }, maxDim: 384, fixtures: [] };
const HANDOVER = { sequences: [['artnet|10.0.0.1|0', 9]], active: [{ key: 'artnet|10.0.0.1|0', protocol: 'artnet', host: '10.0.0.1', universe: 0, length: 512 }] };

function fakeOutput() {
  return {
    sendFrame: vi.fn(async () => ({ ok: true, sent: 1, stats: {} })),
    stop: vi.fn(() => ({ ok: true, terminated: 0, stats: {} })),
    handOver: vi.fn(() => HANDOVER),
    takeOver: vi.fn(),
    stats: vi.fn(() => ({ framesSent: 3 })),
    localPort: vi.fn(() => 50000),
  };
}

function route(core: (command: string, args: unknown) => unknown, env: Record<string, string> = {}, supported = true) {
  const output = fakeOutput();
  const invokeCore = vi.fn(async (command: string, args: unknown) => core(command, args));
  const r = createPixelMapRoute({ output, invokeCore, coreSupported: () => supported, env, log: { warn() {} } });
  return { r, output, invokeCore };
}

describe('pixel-map route between the render core and the app', () => {
  it('hands the app sender state to the core, and back on the next app frame', async () => {
    const { r, output, invokeCore } = route((command) => {
      if (command === 'pixelmap_configure') return { ok: true, configured: true, local_port: 61000 };
      if (command === 'pixelmap_stop') return { ok: true, handover: { sequences: [['artnet|10.0.0.1|0', 40]], active: [] } };
      return null;
    });
    expect(await r.configure(PLAN)).toEqual({ ok: true });
    expect(invokeCore).toHaveBeenCalledWith('pixelmap_configure', { plan: PLAN, handover: HANDOVER });
    expect(r.localPort()).toBe(61000);
    expect(r.coreActive()).toBe(true);

    await r.sendFrame({ universes: [] });
    expect(invokeCore).toHaveBeenLastCalledWith('pixelmap_stop', { handover: true });
    expect(output.takeOver).toHaveBeenCalledWith({ sequences: [['artnet|10.0.0.1|0', 40]], active: [] }, PLAN.sacn);
    expect(output.sendFrame).toHaveBeenCalledTimes(1);
    expect(r.coreActive()).toBe(false);
    expect(r.localPort()).toBe(50000);
  });

  it('keeps the app sender when the core refuses, is too old or is switched off', async () => {
    const refused = route(() => null);
    expect((await refused.r.configure(PLAN)).ok).toBe(false);
    expect(refused.output.takeOver).toHaveBeenCalledWith(HANDOVER, PLAN.sacn);
    expect(refused.r.coreActive()).toBe(false);

    const old = route(() => ({ configured: true }), {}, false);
    expect(await old.r.configure(PLAN)).toMatchObject({ ok: false });
    expect(old.invokeCore).not.toHaveBeenCalled();

    const off = route(() => ({ configured: true }), { GA_CORE_PIXELMAP: '0' });
    expect(await off.r.configure(PLAN)).toMatchObject({ ok: false, reason: expect.stringContaining('GA_CORE_PIXELMAP') });
    expect(off.invokeCore).not.toHaveBeenCalled();
  });

  it('stops the core with a black frame and termination, and the app sender too', async () => {
    const { r, output, invokeCore } = route((command) => (command === 'pixelmap_configure' ? { configured: true } : { ok: true, terminated: 4 }));
    await r.configure(PLAN);
    const result = await r.stop();
    expect(invokeCore).toHaveBeenLastCalledWith('pixelmap_stop', {});
    expect(output.stop).toHaveBeenCalled();
    expect(result.terminated).toBe(4);
    expect(r.coreActive()).toBe(false);
  });

  it('reports core stats, re-sends the plan to a restarted core and gives up on a silent one', async () => {
    let state: unknown = { configured: true, stats: { framesSent: 99, fps: 40 }, fixture_id: 'a', fixture_rgb: [1, 2, 3] };
    const { r, invokeCore } = route((command) => (command === 'pixelmap_configure' ? { configured: true } : state));
    await r.configure(PLAN);
    expect(await r.stats({ fixtureId: 'a' })).toMatchObject({ core: true, framesSent: 99, fixturePixels: [1, 2, 3] });
    expect(invokeCore).toHaveBeenLastCalledWith('pixelmap_state', { fixture_id: 'a' });

    state = { configured: false, stats: {} };
    expect(await r.stats()).toMatchObject({ core: true });
    expect(invokeCore).toHaveBeenLastCalledWith('pixelmap_configure', { plan: PLAN });

    state = null;
    expect(await r.stats()).toMatchObject({ core: false, coreLost: true });
    expect(r.coreActive()).toBe(false);
  });
});
