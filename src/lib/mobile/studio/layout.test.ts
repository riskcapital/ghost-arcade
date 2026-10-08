import { describe, expect, it } from 'vitest';
import { studioLayout } from './layout';

describe('studioLayout', () => {
  it('names the layout for every device size the app runs at', () => {
    const cases: [number, number, string][] = [
      [393, 852, 'phone'], // iPhone portrait
      [852, 393, 'phone-landscape'], // iPhone landscape
      [375, 667, 'phone'], // iPhone SE portrait
      [667, 375, 'phone-landscape'], // iPhone SE landscape
      [1366, 1024, 'tablet'], // iPad 13-inch landscape
      [1024, 1366, 'tablet-portrait'], // iPad 13-inch portrait
      [1133, 744, 'tablet'], // iPad 11-inch landscape
      [744, 1133, 'tablet-portrait'], // iPad 11-inch portrait
      [507, 1024, 'phone'], // Split View, narrow column
      [694, 1024, 'tablet-portrait'], // Split View, half
      [981, 1024, 'tablet-portrait'], // Split View, wide column
      [1024, 768, 'tablet'], // older 9.7-inch iPad landscape
      [932, 430, 'phone-landscape'], // largest iPhone landscape
      [430, 932, 'phone'],
    ];
    for (const [w, h, name] of cases) expect(studioLayout(w, h).layout, `${w}x${h}`).toBe(name);
  });

  it('keeps Controls beside the deck in tablet landscape and in a sheet on phones', () => {
    expect(studioLayout(1366, 1024).inspector).toBe('side');
    expect(studioLayout(1133, 744).inspector).toBe('side');
    expect(studioLayout(393, 852).inspector).toBe('sheet');
    expect(studioLayout(852, 393).inspector).toBe('sheet');
  });

  it('docks Controls under the deck only when a stacked tablet is tall enough', () => {
    expect(studioLayout(1024, 1366).inspector).toBe('bottom');
    expect(studioLayout(744, 1133).inspector).toBe('bottom');
    expect(studioLayout(694, 1024).inspector).toBe('sheet');
    expect(studioLayout(981, 1024).inspector).toBe('sheet');
  });

  it('docks the mixer on tablets and uses a sheet on phones', () => {
    for (const [w, h] of [[1366, 1024], [1024, 1366], [1133, 744], [744, 1133], [694, 1024], [981, 1024]]) expect(studioLayout(w, h).mixer).toBe('docked');
    for (const [w, h] of [[393, 852], [852, 393], [375, 667], [667, 375], [507, 1024]]) expect(studioLayout(w, h).mixer).toBe('sheet');
  });

  it('puts the tabs where the thumb is: bottom bar, side rail in phone landscape, header on a wide tablet', () => {
    expect(studioLayout(393, 852).nav).toBe('bottom');
    expect(studioLayout(852, 393).nav).toBe('rail');
    expect(studioLayout(744, 1133).nav).toBe('bottom');
    expect(studioLayout(1366, 1024).nav).toBe('top');
  });

  it('starts with the preview collapsed only on short phones', () => {
    expect(studioLayout(375, 667).short).toBe(true);
    expect(studioLayout(393, 852).short).toBe(false);
    expect(studioLayout(507, 1024).short).toBe(false);
    expect(studioLayout(1024, 1366).short).toBe(false);
  });

  it('never changes layout for a one pixel rounding difference at a boundary', () => {
    expect(studioLayout(599.4, 900).layout).toBe('phone');
    expect(studioLayout(600, 900).layout).toBe('tablet-portrait');
    expect(studioLayout(999, 700).layout).toBe('tablet-portrait');
    expect(studioLayout(1000, 700).layout).toBe('tablet');
  });
});
