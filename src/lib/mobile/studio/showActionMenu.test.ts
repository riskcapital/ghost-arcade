import { describe, expect, it } from 'vitest';
import { describeShowAction, editShowAction, fromOne, PHONE_SHOW_KINDS, readShowActionMenu, startShowAction } from './showActionMenu';
import { readDesktopCapabilities } from './desktopCapabilities';
import { validateZoneTrigger } from './interactive';

/** What a 2.1.12 desktop sends (phoneWorld.ts phoneShowActions), kinds in its picker's order. */
const DESKTOP = {
  version: 1,
  kinds: [
    { kind: 'look', label: 'Apply a Look' }, { kind: 'preset', label: 'Recall a preset' }, { kind: 'clip', label: 'Launch a VJ clip' },
    { kind: 'clipColumn', label: 'Launch a VJ column' }, { kind: 'section', label: 'Jump to a section' }, { kind: 'go', label: 'GO' },
    { kind: 'cue', label: 'Cue list' }, { kind: 'phrase', label: 'Launch a phrase' }, { kind: 'liveClip', label: 'Fire a Live clip' },
    { kind: 'liveScene', label: 'Fire a Live scene' }, { kind: 'blackout', label: 'Blackout' }, { kind: 'transport', label: 'Timeline transport' },
  ],
  looks: [{ id: 'neon-pulse', name: 'Neon Pulse' }, { id: 'ice-edges', name: 'Ice Edges' }],
  presets: [{ id: '3f2a9c1e-77aa-4b1c-9f00-1234567890ab', name: 'Drop' }],
  sections: [{ id: 'sec-1', name: 'Intro' }, { id: 'sec-2', name: 'Chorus' }],
};

describe('the desktop’s show actions on the phone', () => {
  it('reads the desktop’s menu in its order, and nothing from a desktop without it', () => {
    const menu = readShowActionMenu(DESKTOP)!;
    expect(menu.kinds.map((k) => k.kind)).toEqual(PHONE_SHOW_KINDS);
    expect(menu.kinds[0].label).toBe('Apply a Look');
    expect(menu.presets[0].name).toBe('Drop');
    expect(readDesktopCapabilities({ version: 1, showActions: DESKTOP }).showActions).toEqual(menu);
    expect(readDesktopCapabilities({ version: 1 }).showActions).toBeNull();
    expect(readShowActionMenu({ version: 2, kinds: DESKTOP.kinds })).toBeNull();
    expect(readShowActionMenu({ version: 1, kinds: [{ kind: 'takeover', label: 'Takeover' }] })).toBeNull();
  });

  it('leaves out what it cannot build and ids the desktop would refuse', () => {
    const menu = readShowActionMenu({ ...DESKTOP, kinds: [...DESKTOP.kinds, { kind: 'release' }, { kind: 'look' }], looks: [{ id: 'bad id!', name: 'X' }, { id: 'ok', name: '' }], presets: 'none' })!;
    expect(menu.kinds.filter((k) => k.kind === 'look')).toHaveLength(1);
    expect(menu.kinds.some((k) => k.kind === 'release')).toBe(false);
    expect(menu.looks).toEqual([{ id: 'ok', name: 'ok' }]);
    expect(menu.presets).toEqual([]);
  });

  it('starts every kind as an action the desktop’s own check keeps', () => {
    const menu = readShowActionMenu(DESKTOP)!;
    for (const { kind } of menu.kinds) {
      const action = startShowAction(kind, menu)!;
      expect(action, kind).not.toBeNull();
      const trigger = validateZoneTrigger({ actions: [{ kind: 'show', action }], rearm: 1 });
      expect(trigger.actions[0], kind).toEqual({ kind: 'show', action });
    }
    // A choice there is none of waits.
    expect(startShowAction('preset', { ...menu, presets: [] })).toBeNull();
    expect(startShowAction('section', { ...menu, sections: [] })).toEqual({ kind: 'section', index: 0 });
  });

  it('edits within the desktop’s ranges and names actions as the desktop does', () => {
    const menu = readShowActionMenu(DESKTOP)!;
    expect(editShowAction({ kind: 'clip', deck: 'A', row: 0, column: 0 }, { row: fromOne('3') })).toEqual({ kind: 'clip', deck: 'A', row: 2, column: 0 });
    expect(editShowAction({ kind: 'clip', row: 0, column: 0 }, { row: 999 })).toBeNull();
    expect(fromOne('0')).toBe(0);
    expect(fromOne('400')).toBe(255);
    expect(describeShowAction({ kind: 'look', lookId: 'ice-edges' }, menu)).toBe('Look · Ice Edges');
    expect(describeShowAction({ kind: 'preset', compositionId: '3f2a9c1e-77aa-4b1c-9f00-1234567890ab' }, menu)).toBe('Preset · Drop');
    expect(describeShowAction({ kind: 'section', id: 'sec-2' }, menu)).toBe('Section · Chorus');
    expect(describeShowAction({ kind: 'look', lookId: 'neon-pulse' }, null)).toBe('Look · set on the desktop');
    expect(describeShowAction({ kind: 'cue', op: 'fire', index: 4 }, menu)).toBe('Cue · 5');
  });
});
