import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyShowKey, handleShowKeydown, setShowKeyHandler } from './showKeyboard';
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
});
