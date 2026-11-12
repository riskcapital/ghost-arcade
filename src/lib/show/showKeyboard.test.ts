import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyShowKey, handleShowKeydown, installShowKeyCapture, setShowKeyHandler } from './showKeyboard';
import { showDropEffect } from './showDrop';

const engaged = { open: true, engaged: true, hasSelection: true };

function keyEvent(key: string, extra: Record<string, unknown> = {}) {
  let prevented = false;
  return {
    key,
    target: null,
    ...extra,
    get defaultPrevented() { return prevented; },
    preventDefault() { prevented = true; },
  } as unknown as KeyboardEvent;
}

describe('show keyboard', () => {
  afterEach(() => setShowKeyHandler(null));

  it('takes Delete and Backspace only while the tray is engaged with a selection', () => {
    expect(classifyShowKey({ key: 'Delete' }, engaged)).toBe('delete');
    expect(classifyShowKey({ key: 'Backspace' }, engaged)).toBe('delete');
    expect(classifyShowKey({ key: 'Delete' }, { ...engaged, engaged: false })).toBeNull();
    expect(classifyShowKey({ key: 'Delete' }, { ...engaged, open: false })).toBeNull();
    expect(classifyShowKey({ key: 'Delete' }, { ...engaged, hasSelection: false })).toBeNull();
    expect(classifyShowKey({ key: 'Delete', metaKey: true }, engaged)).toBeNull();
    expect(classifyShowKey({ key: 'c', metaKey: true }, engaged)).toBeNull();
  });

  it('Enter is GO on a Timeline with sections (once per press), nothing otherwise', () => {
    const ctx = { open: true, engaged: true, hasSelection: false, hasSections: true };
    expect(classifyShowKey({ key: 'Enter' }, ctx)).toBe('go');
    expect(classifyShowKey({ key: 'Enter', repeat: true }, ctx)).toBeNull();
    expect(classifyShowKey({ key: 'Enter' }, { ...ctx, hasSections: false })).toBeNull();
    expect(classifyShowKey({ key: 'Enter', target: { tagName: 'INPUT' } as unknown as EventTarget }, ctx)).toBeNull();
  });

  it('leaves keys typed into a field alone', () => {
    expect(classifyShowKey({ key: 'Delete', target: { tagName: 'INPUT' } as unknown as EventTarget }, engaged)).toBeNull();
    expect(classifyShowKey({ key: 'Backspace', target: { isContentEditable: true } as unknown as EventTarget }, engaged)).toBeNull();
  });

  it('marks a taken key handled so the app-wide Delete does not also run', () => {
    const del = vi.fn();
    setShowKeyHandler((e) => {
      if (classifyShowKey(e, engaged) !== 'delete') return false;
      del();
      return true;
    });
    const e = keyEvent('Delete');
    expect(handleShowKeydown(e)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
    expect(del).toHaveBeenCalledTimes(1);

    const other = keyEvent('x');
    expect(handleShowKeydown(other)).toBe(false);
    expect(other.defaultPrevented).toBe(false);
  });

  it('does nothing without a registered tray, or for an event already handled', () => {
    expect(handleShowKeydown(keyEvent('Delete'))).toBe(false);
    const handler = vi.fn(() => true);
    setShowKeyHandler(handler);
    const e = keyEvent('Delete');
    e.preventDefault();
    expect(handleShowKeydown(e)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('only the current tray unregisters itself', () => {
    const a = () => true;
    const b = () => true;
    const offA = setShowKeyHandler(a);
    setShowKeyHandler(b);
    offA();
    expect(handleShowKeydown(keyEvent('Delete'))).toBe(true);
  });
});

describe('showDropEffect', () => {
  it('follows what the drag source allows', () => {
    expect(showDropEffect('move')).toBe('move');
    expect(showDropEffect('copy')).toBe('copy');
    expect(showDropEffect('copyMove')).toBe('copy');
    expect(showDropEffect('all')).toBe('copy');
    expect(showDropEffect('uninitialized')).toBe('copy');
    expect(showDropEffect('linkMove')).toBe('move');
    expect(showDropEffect('link')).toBe('link');
    expect(showDropEffect('none')).toBe('none');
    expect(showDropEffect(undefined)).toBe('copy');
  });

  it('maps the timeline edit keys while the tray is engaged', () => {
    const full = { open: true, engaged: true, hasSelection: true, hasClipSelection: true, canPaste: true, hasTracks: true };
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ key: 's' }, 'toggleSnap'],
      [{ key: 'k', metaKey: true }, 'split'],
      [{ key: 'k', ctrlKey: true }, 'split'],
      [{ key: 'd', metaKey: true }, 'duplicate'],
      [{ key: 'c', metaKey: true }, 'copy'],
      [{ key: 'x', metaKey: true }, 'cut'],
      [{ key: 'v', metaKey: true }, 'paste'],
      [{ key: 'a', metaKey: true }, 'selectAll'],
      [{ key: 'Delete', shiftKey: true }, 'rippleDelete'],
      [{ key: 'Backspace', shiftKey: true }, 'rippleDelete'],
      [{ key: 'ArrowLeft' }, 'nudgeLeft'],
      [{ key: 'ArrowRight', shiftKey: true }, 'nudgeBarRight'],
      [{ key: 'M' }, 'marker'],
      [{ key: 'Home' }, 'home'],
      [{ key: 'End' }, 'end'],
      [{ key: 'Escape' }, 'clearSelection'],
      [{ key: 'b' }, null],
      [{ key: 't' }, null],
      [{ key: ' ' }, null],
      [{ key: 'z', metaKey: true }, null],
      [{ key: 's', metaKey: true }, null],
      [{ key: 's', altKey: true }, null],
    ];
    for (const [e, want] of cases) expect(classifyShowKey(e as { key: string }, full), JSON.stringify(e)).toBe(want);
  });

  it('only offers clip actions when there is something to act on', () => {
    const bare = { open: true, engaged: true, hasSelection: false };
    expect(classifyShowKey({ key: 'k', metaKey: true }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'd', metaKey: true }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'v', metaKey: true }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'c' }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'q' }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'Escape' }, bare)).toBeNull();
    // With nothing selected the arrows step the playhead a frame.
    expect(classifyShowKey({ key: 'ArrowLeft' }, bare)).toBe('frameBack');
    expect(classifyShowKey({ key: 's' }, { ...bare, hasTracks: true, engaged: false })).toBeNull();
  });

  it('uses the keys of a video editor: J K L, I O, razor, trims, edit points, zoom', () => {
    const ctx = { open: true, engaged: true, hasSelection: false, hasTracks: true };
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ key: 'j' }, 'shuttleBack'],
      [{ key: 'k' }, 'shuttleStop'],
      [{ key: 'l' }, 'shuttleForward'],
      [{ key: 'i' }, 'markIn'],
      [{ key: 'o' }, 'markOut'],
      [{ key: 'I', shiftKey: true }, 'goIn'],
      [{ key: 'O', shiftKey: true }, 'goOut'],
      [{ key: 'x', ctrlKey: true, shiftKey: true }, 'clearInOut'],
      [{ key: 'ArrowUp' }, 'prevEdit'],
      [{ key: 'ArrowDown' }, 'nextEdit'],
      [{ key: 'ArrowRight' }, 'frameForward'],
      [{ key: '=' }, 'zoomIn'],
      [{ key: '+' }, 'zoomIn'],
      [{ key: '-' }, 'zoomOut'],
      [{ key: '\\' }, 'zoomFit'],
      [{ key: 'q' }, 'trimStart'],
      [{ key: 'w' }, 'trimEnd'],
      [{ key: 'c' }, 'razor'],
      [{ key: 'v' }, 'selectTool'],
      [{ key: 'u' }, 'toggleLines'],
      [{ key: 'n' }, 'rollTool'],
      [{ key: 'y' }, 'slipTool'],
      [{ key: 'B', shiftKey: true }, 'rippleTool'],
      [{ key: 'b' }, null],
      [{ key: 's' }, 'toggleSnap'],
    ];
    for (const [e, want] of cases) expect(classifyShowKey(e as any, ctx), JSON.stringify(e)).toBe(want);
  });

  it('Shift+L takes the focused track over live; R returns everything, Shift+R instantly', () => {
    const ctx = { open: true, engaged: true, hasSelection: false, hasTracks: true };
    expect(classifyShowKey({ key: 'L', shiftKey: true }, ctx)).toBe('takeover');
    expect(classifyShowKey({ key: 'l' }, ctx)).toBe('shuttleForward');
    expect(classifyShowKey({ key: 'L', shiftKey: true }, { ...ctx, hasTracks: false })).toBeNull();
    expect(classifyShowKey({ key: 'r' }, ctx)).toBeNull();
    expect(classifyShowKey({ key: 'r' }, { ...ctx, takeoverActive: true })).toBe('returnAll');
    expect(classifyShowKey({ key: 'R', shiftKey: true }, { ...ctx, takeoverActive: true })).toBe('returnAllInstant');
    expect(classifyShowKey({ key: 'r', metaKey: true }, { ...ctx, takeoverActive: true })).toBeNull();
    expect(classifyShowKey({ key: 'l' }, { ...ctx, engaged: false })).toBeNull();
  });

  it('a held Shift+L or R (key repeat) is taken but does nothing more', () => {
    const ctx = { open: true, engaged: true, hasSelection: false, hasTracks: true, takeoverActive: true };
    expect(classifyShowKey({ key: 'L', shiftKey: true, repeat: true }, ctx)).toBe('heldTakeoverKey');
    expect(classifyShowKey({ key: 'r', repeat: true }, ctx)).toBe('heldTakeoverKey');
    expect(classifyShowKey({ key: 'R', shiftKey: true, repeat: true }, ctx)).toBe('heldTakeoverKey');
    expect(classifyShowKey({ key: 'L', shiftKey: true, repeat: true }, { ...ctx, hasTracks: false })).toBeNull();
  });

  it('takes its keys ahead of every other window listener', () => {
    const listeners: Array<{ fn: (e: Event) => void; capture: boolean }> = [];
    const target = {
      addEventListener: (_: string, fn: (e: Event) => void, capture: boolean) => listeners.push({ fn, capture }),
      removeEventListener: () => { listeners.length = 0; },
    };
    const uninstall = installShowKeyCapture(target as unknown as Window);
    expect(listeners[0].capture).toBe(true);
    setShowKeyHandler((e) => e.key === 'k');
    const stop = vi.fn();
    const taken = { ...keyEvent('k', { metaKey: true }), stopPropagation: stop } as unknown as KeyboardEvent;
    listeners[0].fn(taken);
    expect(stop).toHaveBeenCalledTimes(1);
    const other = { ...keyEvent('j'), stopPropagation: stop } as unknown as KeyboardEvent;
    listeners[0].fn(other);
    expect(stop).toHaveBeenCalledTimes(1);
    uninstall();
    expect(listeners).toHaveLength(0);
  });
});
