import { describe, it, expect } from 'vitest';
import { editorKey, type EditorKeyContext, type EditorKeyPress, type KeyTarget } from './editorKeyboard';

const press = (key: string, extra: Partial<EditorKeyPress> = {}): EditorKeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: 'other',
  ...extra,
});
const context = (extra: Partial<EditorKeyContext> = {}): EditorKeyContext => ({
  mode: 'edit',
  placingEmitter: false,
  draftPoints: 0,
  hasSelection: true,
  confirming: false,
  fullScreen: false,
  cleanPreview: false,
  ...extra,
});
const command = (p: EditorKeyPress, c = context()) => editorKey(p, c).command;
const everyTarget: KeyTarget[] = ['text', 'adjust', 'button', 'other'];

describe('editor key map: undo and redo', () => {
  it('undoes with Cmd+Z and Ctrl+Z from anywhere but a typing field', () => {
    for (const target of ['adjust', 'button', 'other'] as const) {
      expect(command(press('z', { metaKey: true, target }))).toEqual({ type: 'undo' });
      expect(command(press('z', { ctrlKey: true, target }))).toEqual({ type: 'undo' });
    }
    expect(editorKey(press('z', { metaKey: true }), context()).preventDefault).toBe(true);
  });

  it('redoes with Shift+Cmd+Z, Shift+Ctrl+Z and Ctrl+Y', () => {
    expect(command(press('Z', { metaKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
    expect(command(press('z', { ctrlKey: true, shiftKey: true, target: 'button' }))).toEqual({ type: 'redo' });
    expect(command(press('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
  });

  it('leaves text undo to the typing field', () => {
    const result = editorKey(press('z', { metaKey: true, target: 'text' }), context());
    expect(result).toEqual({ command: null, preventDefault: false });
  });

  it('a plain z does nothing', () => {
    expect(command(press('z'))).toBeNull();
  });
});

describe('editor key map: delete', () => {
  it('removes the selected shape with Delete or Backspace, also from a focused button', () => {
    for (const key of ['Delete', 'Backspace'])
      for (const target of ['adjust', 'button', 'other'] as const)
        expect(command(press(key, { target }))).toEqual({ type: 'remove-surface' });
  });

  it('never deletes while typing', () => {
    expect(editorKey(press('Backspace', { target: 'text' }), context())).toEqual({
      command: null,
      preventDefault: false,
    });
    expect(command(press('Delete', { target: 'text' }))).toBeNull();
  });

  it('does nothing without a selection or outside Select mode', () => {
    expect(command(press('Delete'), context({ hasSelection: false }))).toBeNull();
    expect(command(press('Delete'), context({ mode: 'perform' }))).toBeNull();
    expect(command(press('Backspace'), context({ mode: 'draw', draftPoints: 4 }))).toBeNull();
    expect(command(press('Delete'), context({ placingEmitter: true }))).toBeNull();
  });
});

describe('editor key map: arrows', () => {
  it('nudges the selected shape, Shift for the big step', () => {
    expect(command(press('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0, big: false });
    expect(command(press('ArrowRight', { target: 'button' }))).toEqual({ type: 'nudge', dx: 1, dy: 0, big: false });
    expect(command(press('ArrowUp', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: -1, big: true });
    expect(command(press('ArrowDown'))).toEqual({ type: 'nudge', dx: 0, dy: 1, big: false });
    expect(editorKey(press('ArrowDown'), context()).preventDefault).toBe(true);
  });

  it('leaves arrows to sliders, selects and typing fields', () => {
    expect(editorKey(press('ArrowLeft', { target: 'adjust' }), context())).toEqual({
      command: null,
      preventDefault: false,
    });
    expect(command(press('ArrowLeft', { target: 'text' }))).toBeNull();
  });

  it('does not nudge without a selection, in Draw or Play, or with Cmd held', () => {
    expect(command(press('ArrowLeft'), context({ hasSelection: false }))).toBeNull();
    expect(command(press('ArrowLeft'), context({ mode: 'draw' }))).toBeNull();
    expect(command(press('ArrowLeft'), context({ mode: 'perform' }))).toBeNull();
    expect(command(press('ArrowLeft', { metaKey: true }))).toBeNull();
  });
});

describe('editor key map: Escape and Enter', () => {
  it('backs out one thing at a time and closes the editor last', () => {
    const all = context({
      confirming: true,
      placingEmitter: true,
      mode: 'draw',
      cleanPreview: true,
      fullScreen: true,
    });
    expect(command(press('Escape', { target: 'text' }), all)).toEqual({ type: 'cancel-confirm' });
    expect(command(press('Escape', { target: 'text' }), { ...all, confirming: false })).toEqual({
      type: 'leave-field',
    });
    expect(command(press('Escape'), { ...all, confirming: false })).toEqual({ type: 'exit-placing' });
    expect(command(press('Escape'), { ...all, confirming: false, placingEmitter: false })).toEqual({
      type: 'exit-draw',
    });
    expect(command(press('Escape'), context({ cleanPreview: true, fullScreen: true }))).toEqual({
      type: 'exit-clean-preview',
    });
    expect(command(press('Escape'), context({ fullScreen: true }))).toEqual({ type: 'exit-fullscreen' });
    expect(command(press('Escape'), context())).toEqual({ type: 'close' });
    expect(command(press('Escape'), context({ mode: 'perform' }))).toEqual({ type: 'close' });
  });

  it('Escape works from a focused button and always stops the browser default', () => {
    for (const target of everyTarget)
      expect(editorKey(press('Escape', { target }), context()).preventDefault).toBe(true);
    expect(command(press('Escape', { target: 'button' }), context({ mode: 'draw' }))).toEqual({ type: 'exit-draw' });
  });

  it('Enter finishes a drawn shape with three or more points', () => {
    expect(command(press('Enter'), context({ mode: 'draw', draftPoints: 3 }))).toEqual({ type: 'finish-shape' });
    expect(command(press('Enter'), context({ mode: 'draw', draftPoints: 2 }))).toBeNull();
    expect(command(press('Enter'), context({ mode: 'edit', draftPoints: 0 }))).toBeNull();
  });

  it('Enter still activates a focused button or field', () => {
    for (const target of ['text', 'adjust', 'button'] as const)
      expect(editorKey(press('Enter', { target }), context({ mode: 'draw', draftPoints: 5 }))).toEqual({
        command: null,
        preventDefault: false,
      });
  });
});

describe('editor key map: everything else', () => {
  it('has no single-letter shortcuts (B, T, Space belong to the app behind)', () => {
    for (const key of ['b', 't', ' ', '1', 'f', 'n'])
      for (const target of everyTarget)
        expect(editorKey(press(key, { target }), context())).toEqual({ command: null, preventDefault: false });
    expect(command(press('n', { metaKey: true }))).toBeNull();
    expect(command(press('s', { ctrlKey: true }))).toBeNull();
  });
});
