import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitToolbar, toolbarScale } from './toolbarFit';

const measure = (room: number, scalable = 1500, fixed = 200) => ({ room, fixed, scalable });

describe('toolbarScale', () => {
  it('stays at full size when everything fits', () => {
    expect(toolbarScale(measure(1920), 1)).toBe(1);
    expect(toolbarScale(measure(1700), 1)).toBe(1);
  });

  it('shrinks straight away to the largest step that fits', () => {
    // 1200 px for 1500 px of groups: 0.8 exactly.
    const scale = toolbarScale(measure(1400), 1);
    expect(scale).toBe(0.8);
    expect(1500 * scale).toBeLessThanOrEqual(1200);
    // 1190 px: 0.7933.. rounds down to the 0.78 step, never up past the edge.
    expect(toolbarScale(measure(1390), 1)).toBe(0.78);
  });

  it('never goes below the smallest scale', () => {
    expect(toolbarScale(measure(600), 1)).toBe(0.6);
    expect(toolbarScale(measure(600), 1, { smallest: 0.5 })).toBe(0.5);
  });

  it('does not grow back for a few pixels of room', () => {
    const shrunk = toolbarScale(measure(1390), 1); // 0.78
    // A control loses 6 px: there is a little room, but not enough to matter.
    expect(toolbarScale(measure(1390, 1494), shrunk)).toBe(shrunk);
    // ...and gains them back: still fits at the same scale.
    expect(toolbarScale(measure(1390, 1500), shrunk)).toBe(shrunk);
  });

  it('is stable: measuring the same bar again keeps the same scale', () => {
    let scale = 1;
    for (const room of [1600, 1500, 1420, 1390, 1385, 1390, 1395, 1390]) {
      const next = toolbarScale(measure(room), scale);
      const again = toolbarScale(measure(room), next);
      expect(again).toBe(next);
      scale = next;
    }
  });

  it('grows back once there is clear room to spare', () => {
    const shrunk = toolbarScale(measure(1390), 1); // 0.78
    // 60 px wider: (1250 - 24) / 1500 = 0.817 -> 0.8.
    expect(toolbarScale(measure(1450), shrunk)).toBe(0.8);
    // Wide enough for full size plus slack: straight back to 1.
    expect(toolbarScale(measure(1724), shrunk)).toBe(1);
  });

  it('does not flap between two scales when a width wobbles', () => {
    // The recording timer adds and removes a few px each second.
    let scale = toolbarScale(measure(1390), 1);
    const seen = new Set<number>([scale]);
    for (let i = 0; i < 20; i++) {
      scale = toolbarScale(measure(1390, i % 2 ? 1504 : 1498), scale);
      seen.add(scale);
    }
    expect(seen.size).toBeLessThanOrEqual(2);
    // It may step down once for the wider width but never climbs back.
    const values = [...seen].sort();
    expect(values[values.length - 1]).toBe(0.78);
  });

  it('treats nothing to scale as full size', () => {
    expect(toolbarScale({ room: 800, fixed: 100, scalable: 0 }, 0.7)).toBe(1);
    expect(toolbarScale({ room: 0, fixed: 100, scalable: 1000 }, 0.7)).toBe(1);
  });
});

describe('fitToolbar', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A bar with a fixed File group and two scaled groups, too wide for its window. */
  function toolbar(log: string[]) {
    const element = (width: number, children: unknown[] = [], attributes: string[] = []) => ({
      children,
      style: { setProperty() {}, removeProperty() {} },
      hasAttribute: (name: string) => attributes.includes(name),
      getBoundingClientRect: () => ({ width }),
    });
    const classes = new Set<string>();
    const groups = [
      element(120, [element(120)], ['data-tb-fixed']),
      element(500, [element(100), element(100), element(100), element(100), element(100)]),
      element(400, [element(200), element(200)]),
    ];
    const header = {
      ...element(0, groups),
      parentElement: element(900),
      classList: {
        add: (...names: string[]) => { names.forEach((name) => classes.add(name)); log.push(`add ${names.join(' ')}`); },
        remove: (...names: string[]) => { names.forEach((name) => classes.delete(name)); log.push(`remove ${names.join(' ')}`); },
      },
      get offsetWidth() { log.push('layout'); return 900; },
    };
    return { header: header as unknown as HTMLElement, classes };
  }

  it('stretches the centre buttons back before transitions return', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('getComputedStyle', () => ({ display: 'flex', position: 'static', paddingLeft: '14px', paddingRight: '14px', columnGap: '10px' }));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });

    const log: string[] = [];
    const { header, classes } = toolbar(log);
    const fit = fitToolbar(header);
    while (frames.length) frames.shift()!(0);

    // Measured with transitions held. The stretch comes back and is laid out
    // before they return: animated back in, it resized the buttons, which
    // fitted the bar again, over and over.
    expect(log[0]).toBe('add tb-still tb-measuring');
    expect(log.slice(log.indexOf('remove tb-measuring'))).toEqual(['remove tb-measuring', 'layout', 'remove tb-still']);
    expect(classes.size).toBe(0);
    fit.destroy();
  });
});
