import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDE,
  SIDE_MAX_WIDTH,
  SIDE_MIN_WIDTH,
  SIDE_PANEL_WIDTH,
  SIDE_PERFORM_WIDTH,
  parseSide,
  sideStep,
  sideWidth,
  type SideState,
} from './sideColumn';

const closed: SideState = { ...DEFAULT_SIDE, open: false };
const on = (tab: SideState['tab']): SideState => ({ ...DEFAULT_SIDE, open: true, tab });

describe('the Timeline side column', () => {
  it('a tab click opens the column on that tab (and is a no-op when it already shows)', () => {
    expect(sideStep(closed, { kind: 'show', tab: 'media' })).toMatchObject({ open: true, tab: 'media' });
    const s = on('media');
    expect(sideStep(s, { kind: 'show', tab: 'media' })).toBe(s);
    expect(sideStep(s, { kind: 'show', tab: 'perform' })).toMatchObject({ open: true, tab: 'perform' });
  });

  it('the toolbar\'s Perform toggles: opens Perform, closes it when it shows, switches from another tab', () => {
    expect(sideStep(closed, { kind: 'toggle', tab: 'perform' })).toMatchObject({ open: true, tab: 'perform' });
    expect(sideStep(on('perform'), { kind: 'toggle', tab: 'perform' })).toMatchObject({ open: false, tab: 'perform' });
    expect(sideStep(on('inspector'), { kind: 'toggle', tab: 'perform' })).toMatchObject({ open: true, tab: 'perform' });
  });

  it('× closes it (twice is a no-op)', () => {
    const s = sideStep(on('inspector'), { kind: 'close' });
    expect(s.open).toBe(false);
    expect(sideStep(s, { kind: 'close' })).toBe(s);
  });

  it('a new selection brings the Inspector, but never takes the Perform tab away mid-show', () => {
    expect(sideStep(closed, { kind: 'selected' })).toMatchObject({ open: true, tab: 'inspector' });
    expect(sideStep(on('media'), { kind: 'selected' })).toMatchObject({ open: true, tab: 'inspector' });
    const perform = on('perform');
    expect(sideStep(perform, { kind: 'selected' })).toBe(perform);
    const insp = on('inspector');
    expect(sideStep(insp, { kind: 'selected' })).toBe(insp);
  });

  it('a row click brings the Media tab', () => {
    expect(sideStep(closed, { kind: 'rowTarget' })).toMatchObject({ open: true, tab: 'media' });
    expect(sideStep(on('perform'), { kind: 'rowTarget' })).toMatchObject({ open: true, tab: 'media' });
  });

  it('Perform keeps its own (wider) width; resizing changes only the showing tab\'s width, within 300–720', () => {
    expect(sideWidth(on('inspector'))).toBe(SIDE_PANEL_WIDTH);
    expect(sideWidth(on('perform'))).toBe(SIDE_PERFORM_WIDTH);
    expect(sideWidth(closed)).toBe(0);
    const wide = sideStep(on('media'), { kind: 'resize', width: 5000 });
    expect(wide.widths).toEqual({ panel: SIDE_MAX_WIDTH, perform: SIDE_PERFORM_WIDTH });
    const narrow = sideStep(on('perform'), { kind: 'resize', width: 10 });
    expect(narrow.widths).toEqual({ panel: SIDE_PANEL_WIDTH, perform: SIDE_MIN_WIDTH });
    const same = on('inspector');
    expect(sideStep(same, { kind: 'resize', width: SIDE_PANEL_WIDTH })).toBe(same);
    expect(sideStep(same, { kind: 'resize', width: Number.NaN }).widths.panel).toBe(SIDE_PANEL_WIDTH);
  });

  it('reads a saved state back, and anything broken as the default', () => {
    expect(parseSide(JSON.stringify({ open: false, tab: 'perform', widths: { panel: 400, perform: 650 } })))
      .toEqual({ open: false, tab: 'perform', widths: { panel: 400, perform: 650 } });
    expect(parseSide(null)).toEqual(DEFAULT_SIDE);
    expect(parseSide('{nope')).toEqual(DEFAULT_SIDE);
    expect(parseSide(JSON.stringify({ tab: 'elsewhere', widths: { panel: 9999 } }))).toEqual({ open: true, tab: 'inspector', widths: { panel: SIDE_MAX_WIDTH, perform: SIDE_PERFORM_WIDTH } });
  });
});
