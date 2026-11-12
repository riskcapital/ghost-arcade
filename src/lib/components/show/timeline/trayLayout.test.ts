/**
 * Tray layout: menus stay inside the window, crossfade marks keep unique
 * keys, and the tray leaves the panels beside it room to work.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TimelineStageClip } from '../../../timeline/stagefx/stageClips';
import { stageRowOverlaps } from './stageFxRowsUi';
import { keepInWindow, trayEditorCap, TRAY_EDITOR_RESERVE, TRAY_MIN_HEIGHT } from './trackLayout';

const source = (file: string) => readFileSync(join(process.cwd(), 'src/lib/components', file), 'utf8');

const block = (id: string, startTime: number, duration: number, row: TimelineStageClip['row'] = 'screenfx'): TimelineStageClip =>
  ({ id, row, startTime, duration, fadeIn: 0, fadeOut: 0 });

describe('Stage FX crossfade marks', () => {
  it('gives every overlapping pair its own key, even when two pairs share a span', () => {
    // Two copies of one block over a long one: three pairs, two of them on
    // the same span. A keyed list with a repeated key stops the whole tray.
    const out = stageRowOverlaps([block('a', 0, 16), block('b', 5, 8), block('c', 5, 8), block('d', 6, 2, 'effects')]);
    expect(out.screenfx.map((o) => [o.start, o.end])).toEqual([[5, 13], [5, 13], [5, 13]]);
    expect(new Set(out.screenfx.map((o) => o.key)).size).toBe(out.screenfx.length);
    expect(out.effects).toEqual([]);
  });
});

describe('tray height leaves the editor room', () => {
  it('keeps the reserve above a self-sized tray on common windows', () => {
    // 900 px tall (a 1440x900 or 1600x900 window): the tray used to reach
    // 72% (648 px) with the pads open, leaving the Media Library grid ~20 px.
    expect(trayEditorCap(900)).toBe(900 - TRAY_EDITOR_RESERVE);
    expect(trayEditorCap(1080)).toBe(1080 - TRAY_EDITOR_RESERVE);
    expect(900 - trayEditorCap(900)).toBeGreaterThanOrEqual(TRAY_EDITOR_RESERVE);
  });
  it('splits a short window in half, never below the tray minimum, never above the share', () => {
    expect(trayEditorCap(533)).toBe(267); // 1280x800 at 150 %
    expect(trayEditorCap(200)).toBe(TRAY_MIN_HEIGHT);
    expect(trayEditorCap(3000)).toBe(Math.round(3000 * 0.72));
  });
});

describe('menus stay inside the window', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => { (globalThis as { window?: unknown }).window = realWindow; });
  function menuAt(left: number, top: number, width: number, height: number) {
    (globalThis as { window?: unknown }).window = { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
    const style: Record<string, string> = { translate: '' };
    const node = {
      style,
      getBoundingClientRect() {
        const [dx, dy] = (style.translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0);
        return { left: left + dx, top: top + dy, right: left + dx + width, bottom: top + dy + height, width, height };
      },
    } as unknown as HTMLElement;
    return { node, style };
  }
  it('shifts a menu that runs past the bottom (an LED row near the window edge) back in', () => {
    const { node, style } = menuAt(143, 836, 150, 154);
    keepInWindow(node).destroy();
    expect(style.translate).toBe('0px -98px');
    expect(node.getBoundingClientRect().bottom).toBe(892);
  });
  it('leaves a menu that fits alone, and fits left and top too', () => {
    const fits = menuAt(100, 100, 150, 154);
    keepInWindow(fits.node).destroy();
    expect(fits.style.translate).toBe('');
    const off = menuAt(1550, -30, 200, 100);
    keepInWindow(off.node).destroy();
    expect(off.node.getBoundingClientRect().right).toBe(1592);
    expect(off.node.getBoundingClientRect().top).toBe(8);
  });
});

describe('tray menus and the hover help card', () => {
  it('every floating Timeline menu turns the help card off and keeps itself in the window', () => {
    const menus: Array<[string, RegExp]> = [
      ['show/timeline/LedRowHeaders.svelte', /data-led-add-menu data-help-disabled/],
      ['show/timeline/ShowTakeoverMenu.svelte', /data-takeover-menu data-help-disabled/],
      ['show/timeline/LineFollowPopover.svelte', /data-line-follow data-help-disabled/],
      ['show/timeline/sound/SoundRowLanes.svelte', /data-sound-menu data-help-disabled/],
      ['show/timeline/sections/SectionsLiveMenu.svelte', /data-sections-live-menu data-help-disabled/],
      ['show/timeline/ShowClipContextMenu.svelte', /data-clip-menu\s+data-help-disabled/],
    ];
    for (const [file, marker] of menus) {
      const text = source(file);
      expect(text, file).toMatch(marker);
      expect(text, file).toMatch(/use:keepInWindow/);
    }
  });
});

describe('Timeline tray layout', () => {
  const tray = source('ShowTimeline.svelte');
  it('the pads strip scrolls instead of hiding pads, and takes the room two rows of lanes leave', () => {
    expect(tray).toMatch(/\.pads-wrap \{[^}]*overflow-y: auto/);
    expect(tray).toMatch(/style:max-height="\{padsMax\}px"/);
  });
  it('a header focused out of view scrolls the grid, not the label column', () => {
    expect(tray).toMatch(/class="lane-labels"[^>]*onscroll=\{labelsScrolled\}/);
    expect(tray).toMatch(/gridEl\.scrollTop \+= dy/);
  });
  it('the idle strip is one short hint; the full guide is the help link in the header', () => {
    expect(tray).toMatch(/insp-idle-hint">Click a block to see its settings here\.</);
    expect(tray).toMatch(/TIMELINE_HELP_URL = 'https:\/\/ghostarcade\.live\/docs\/timeline'/);
    expect(tray).toMatch(/data-timeline-help/);
  });
  it('toasts rise above the open tray instead of covering the block inspector', () => {
    expect(tray).toMatch(/'--ga-tray-toast-lift', open \? `\$\{trayHeight \+ 52\}px` : '0px'/);
    expect(source('ToastContainer.svelte')).toMatch(/bottom: calc\(24px \+ var\(--ga-tray-toast-lift, 0px\)\)/);
  });
});

describe('Stage Sim show transport', () => {
  it('sits between the side panels and wraps there', () => {
    expect(source('stage3d/Stage3DDesigner.svelte')).toMatch(/style:--sst-inset-l=\{panelsHidden \? '16px' : '236px'\} style:--sst-inset-r=\{panelsHidden \? '16px' : '288px'\}/);
    const css = source('stage3d/StageShowTransport.svelte');
    expect(css).toMatch(/left: var\(--sst-inset-l, 16px\);\s+right: var\(--sst-inset-r, 16px\);/);
    expect(css).toMatch(/\.sst \{[^}]*flex-wrap: wrap;/);
  });
});
