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
      [{ key: 's' }, 'split'],
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
      [{ key: 'n' }, 'toggleSnap'],
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
    expect(classifyShowKey({ key: 's' }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'd', metaKey: true }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'v', metaKey: true }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'ArrowLeft' }, bare)).toBeNull();
    expect(classifyShowKey({ key: 'Escape' }, bare)).toBeNull();
    expect(classifyShowKey({ key: 's' }, { ...bare, hasTracks: true, engaged: false })).toBeNull();
  });

  it('L takes the focused track over live; R returns everything, Shift+R instantly', () => {
    const ctx = { open: true, engaged: true, hasSelection: false, hasTracks: true };
    expect(classifyShowKey({ key: 'l' }, ctx)).toBe('takeover');
    expect(classifyShowKey({ key: 'L', shiftKey: true }, ctx)).toBeNull();
    expect(classifyShowKey({ key: 'l' }, { ...ctx, hasTracks: false })).toBeNull();
    expect(classifyShowKey({ key: 'r' }, ctx)).toBeNull();
    expect(classifyShowKey({ key: 'r' }, { ...ctx, takeoverActive: true })).toBe('returnAll');
    expect(classifyShowKey({ key: 'R', shiftKey: true }, { ...ctx, takeoverActive: true })).toBe('returnAllInstant');
    expect(classifyShowKey({ key: 'r', metaKey: true }, { ...ctx, takeoverActive: true })).toBeNull();
    expect(classifyShowKey({ key: 'l' }, { ...ctx, engaged: false })).toBeNull();
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
