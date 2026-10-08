import { describe, it, expect } from 'vitest';
import { consumesKeyPress, editorKeyCommands, type EditorKeyPress } from './editorKeyboard';

const press = (key: string, extra: Partial<EditorKeyPress> = {}): EditorKeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  fromControl: false,
  ...extra,
});

describe('editor key map', () => {
  it('deletes the selected shape with Delete or Backspace', () => {
    expect(editorKeyCommands(press('Delete'))).toEqual(['remove-surface']);
    expect(editorKeyCommands(press('Backspace'))).toEqual(['remove-surface']);
  });

  it('undoes with Cmd+Z and Ctrl+Z', () => {
    expect(editorKeyCommands(press('z', { metaKey: true }))).toEqual(['undo']);
    expect(editorKeyCommands(press('z', { ctrlKey: true }))).toEqual(['undo']);
    expect(editorKeyCommands(press('z'))).toEqual([]);
  });

  it('returns to Select with Escape and lets the key travel on', () => {
    expect(editorKeyCommands(press('Escape'))).toEqual(['select-mode']);
    expect(consumesKeyPress('select-mode')).toBe(false);
    expect(consumesKeyPress('undo')).toBe(true);
    expect(consumesKeyPress('remove-surface')).toBe(true);
  });

  it('ignores keys pressed on a control', () => {
    expect(editorKeyCommands(press('Delete', { fromControl: true }))).toEqual([]);
    expect(editorKeyCommands(press('z', { metaKey: true, fromControl: true }))).toEqual([]);
    expect(editorKeyCommands(press('Escape', { fromControl: true }))).toEqual([]);
  });
});
