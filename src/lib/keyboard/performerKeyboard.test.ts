import { describe, expect, it } from 'vitest';
import {
  PERFORMER_CLIP_KEYS,
  performerClipIndexForCode,
  resolvePerformerKeyboardAction,
} from './performerKeyboard';

describe('performer keyboard routing', () => {
  it('maps every displayed clip key to its exact slot', () => {
    expect(PERFORMER_CLIP_KEYS).toHaveLength(36);
    PERFORMER_CLIP_KEYS.forEach((clip, index) => {
      expect(performerClipIndexForCode(clip.code)).toBe(index);
      expect(resolvePerformerKeyboardAction({ code: clip.code })).toEqual({
        type: 'clip',
        clipPosition: index,
      });
    });
  });

  it('reserves shifted clip keys for performer actions', () => {
    expect(resolvePerformerKeyboardAction({ code: 'KeyB', shiftKey: true })).toEqual({ type: 'blackout' });
    expect(resolvePerformerKeyboardAction({ code: 'KeyC', shiftKey: true })).toEqual({ type: 'randomize' });
    expect(resolvePerformerKeyboardAction({ code: 'KeyM', shiftKey: true })).toEqual({ type: 'glitch' });
    expect(resolvePerformerKeyboardAction({ code: 'KeyN', shiftKey: true })).toEqual({ type: 'invert' });
    expect(resolvePerformerKeyboardAction({ code: 'KeyX', shiftKey: true })).toEqual({ type: 'drift' });
  });

  it('does not launch clips while assignments are being edited', () => {
    expect(resolvePerformerKeyboardAction({ code: 'Digit1' }, true)).toBeNull();
    expect(resolvePerformerKeyboardAction({ code: 'KeyQ' }, true)).toBeNull();
  });

  it('ignores repeats and command modifiers', () => {
    expect(resolvePerformerKeyboardAction({ code: 'Digit1', repeat: true })).toBeNull();
    expect(resolvePerformerKeyboardAction({ code: 'Digit1', metaKey: true })).toBeNull();
    expect(resolvePerformerKeyboardAction({ code: 'Digit1', ctrlKey: true })).toBeNull();
    expect(resolvePerformerKeyboardAction({ code: 'Digit1', altKey: true })).toBeNull();
  });

  it('routes the non-clip performance controls', () => {
    expect(resolvePerformerKeyboardAction({ code: 'Tab' })).toEqual({ type: 'randomize' });
    expect(resolvePerformerKeyboardAction({ code: 'ArrowLeft' })).toEqual({ type: 'xfade', delta: -0.05 });
    expect(resolvePerformerKeyboardAction({ code: 'ArrowRight' })).toEqual({ type: 'xfade', delta: 0.05 });
    expect(resolvePerformerKeyboardAction({ code: 'Semicolon' })).toEqual({ type: 'space', delta: -1 });
    expect(resolvePerformerKeyboardAction({ code: 'Quote' })).toEqual({ type: 'space', delta: 1 });
    expect(resolvePerformerKeyboardAction({ code: 'Comma' })).toEqual({ type: 'world', delta: -1 });
    expect(resolvePerformerKeyboardAction({ code: 'Period' })).toEqual({ type: 'world', delta: 1 });
    expect(resolvePerformerKeyboardAction({ code: 'Space' })).toEqual({ type: 'spaceFx' });
    expect(resolvePerformerKeyboardAction({ code: 'Backquote' })).toEqual({ type: 'focus' });
    expect(resolvePerformerKeyboardAction({ code: 'Escape' })).toEqual({ type: 'resetMomentaries' });
  });
});
