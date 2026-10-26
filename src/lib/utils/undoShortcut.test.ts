import { describe, expect, it } from 'vitest';
import { isTextEntryTarget, undoShortcut } from './undoShortcut';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra });

describe('isTextEntryTarget', () => {
  it('is true where Cmd/Ctrl+Z should undo the typing', () => {
    expect(isTextEntryTarget(el('INPUT'))).toBe(true);
    for (const type of ['text', 'number', 'search', 'email', 'url', 'password', 'date']) {
      expect(isTextEntryTarget(el('INPUT', { type })), type).toBe(true);
    }
    expect(isTextEntryTarget(el('TEXTAREA'))).toBe(true);
    expect(isTextEntryTarget(el('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('is false where it should undo the project', () => {
    for (const type of ['range', 'checkbox', 'radio', 'button', 'color', 'file']) {
      expect(isTextEntryTarget(el('INPUT', { type })), type).toBe(false);
    }
    expect(isTextEntryTarget(el('SELECT'))).toBe(false);
    expect(isTextEntryTarget(el('BUTTON'))).toBe(false);
    expect(isTextEntryTarget(el('CANVAS'))).toBe(false);
    expect(isTextEntryTarget(el('INPUT', { readOnly: true }))).toBe(false);
    expect(isTextEntryTarget(el('TEXTAREA', { disabled: true }))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(globalThis)).toBe(false);
  });
});

describe('undoShortcut', () => {
  it('reads Cmd and Ctrl, with Shift+Z and Y as redo', () => {
    expect(undoShortcut({ key: 'z', metaKey: true })).toBe('undo');
    expect(undoShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(undoShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
    expect(undoShortcut({ key: 'y', ctrlKey: true })).toBe('redo');
  });

  it('ignores the keys without a modifier, or with Alt', () => {
    expect(undoShortcut({ key: 'z' })).toBeNull();
    expect(undoShortcut({ key: 'z', metaKey: true, altKey: true })).toBeNull();
    expect(undoShortcut({ key: 'x', metaKey: true })).toBeNull();
  });
});
