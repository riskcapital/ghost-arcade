import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFluxLink } from './fluxLink';
import { defaultFlux } from './flux';

describe('Flux link to the desktop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const rig = () => {
    const sent: any[] = [];
    let clock = 1000;
    const link = createFluxLink({ readyState: 1, send: (text: string) => sent.push(JSON.parse(text)) }, () => clock);
    return { sent, link, advance: (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); } };
  };
  it('limits how often a moving finger sends, and always sends the last position', () => {
    const { sent, link, advance } = rig();
    const on = { ...defaultFlux(), active: true };
    link.send({ ...on, x: 0.1 });
    link.send({ ...on, x: 0.2 });
    link.send({ ...on, x: 0.3 });
    expect(sent.map(m => m.x)).toEqual([0.1]);
    advance(40);
    expect(sent.map(m => m.x)).toEqual([0.1, 0.3]);
    expect(sent[0]).toMatchObject({ type: 'studio_flux', active: true, modules: ['warp', 'prism'] });
  });
  it('sends a release at once and stops the heartbeat', () => {
    const { sent, link, advance } = rig();
    const on = { ...defaultFlux(), active: true };
    link.send(on);
    link.send({ ...on, active: false });
    expect(sent.map(m => m.active)).toEqual([true, false]);
    advance(5000);
    expect(sent).toHaveLength(2);
  });
  it('repeats the state while Flux is on, and switches off when the page is left', () => {
    const { sent, link, advance } = rig();
    link.send({ ...defaultFlux(), active: true, latch: true });
    advance(3100);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    link.stop();
    expect(sent.at(-1).active).toBe(false);
    const count = sent.length;
    advance(5000);
    expect(sent).toHaveLength(count);
  });
  it('never claims Flux is on with no module selected', () => {
    const { sent, link } = rig();
    link.send({ ...defaultFlux(), active: true, modules: [] });
    expect(sent[0].active).toBe(false);
  });
});
