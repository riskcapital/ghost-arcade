import { describe, it, expect } from 'vitest';
import { isTypingTarget, studioEditorPassesKey, studioModalKeyAction, type StudioModalKeyEvent } from './studioModalKeys';

const down = (key: string, extra: Partial<StudioModalKeyEvent> = {}): StudioModalKeyEvent => ({
  type: 'keydown',
  key,
  code: key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key,
  ...extra,
});
const idle = { typing: false, timelineOpen: false };

describe('keys while the Interactive Studio is open', () => {
  it('blocks every app shortcut the review saw leak through the modal', () => {
    const leaked: StudioModalKeyEvent[] = [
      down('Backspace'),
      down('Delete'),
      down('z', { metaKey: true }),
      down('z', { ctrlKey: true }),
      down('y', { ctrlKey: true }),
      down('n', { metaKey: true }),
      down('o', { metaKey: true }),
      down('s', { metaKey: true }),
      down('c', { metaKey: true }),
      down('v', { metaKey: true }),
      down('d', { metaKey: true }),
      down(',', { metaKey: true }),
      down('m', { ctrlKey: true }),
      down('t'),
      down('T'),
      down('?'),
      down('1'),
      down('0'),
      down('F1'),
      down('Escape'),
      down(' '),
    ];
    for (const event of leaked) expect(studioModalKeyAction(event, idle), event.key).toBe('block');
  });

  it('keeps B as the emergency blackout, but only as a deliberate single press', () => {
    expect(studioModalKeyAction(down('b'), idle)).toBe('blackout');
    expect(studioModalKeyAction(down('B'), idle)).toBe('blackout');
    expect(studioModalKeyAction(down('b', { repeat: true }), idle)).toBe('block');
    expect(studioModalKeyAction(down('b', { metaKey: true }), idle)).toBe('block');
    expect(studioModalKeyAction(down('b'), { typing: true, timelineOpen: false })).toBe('block');
    expect(studioModalKeyAction({ ...down('b'), type: 'keyup' }, idle)).toBe('block');
  });

  it('gives Space to the Studio timeline only while that timeline is open', () => {
    const open = { typing: false, timelineOpen: true };
    expect(studioModalKeyAction(down(' '), open)).toBe('timeline-transport');
    expect(studioModalKeyAction(down(' ', { repeat: true }), open)).toBe('block');
    expect(studioModalKeyAction(down(' '), { typing: true, timelineOpen: true })).toBe('block');
  });

  it('never acts twice on a key a Studio control already handled', () => {
    expect(studioModalKeyAction(down('b', { defaultPrevented: true }), idle)).toBe('block');
  });

  it('treats text fields, sliders, selects and editable regions as typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('the Studio editor lets the blackout key through to the gate', () => {
  const button = { tagName: 'BUTTON' };
  const field = { tagName: 'INPUT' };
  it('passes B (either case) pressed on the stage, a button or the page', () => {
    for (const key of ['b', 'B']) {
      expect(studioEditorPassesKey(down(key), button)).toBe(true);
      expect(studioEditorPassesKey(down(key), null)).toBe(true);
      // ...and the gate then blacks out on that same key.
      expect(studioModalKeyAction(down(key), { typing: isTypingTarget(button), timelineOpen: false })).toBe('blackout');
    }
  });
  it('keeps every other key, B while typing, repeats and B with a modifier', () => {
    expect(studioEditorPassesKey(down('b'), field)).toBe(false);
    expect(studioEditorPassesKey(down('b', { repeat: true }), button)).toBe(false);
    expect(studioEditorPassesKey(down('b', { metaKey: true }), button)).toBe(false);
    expect(studioEditorPassesKey(down('Backspace'), button)).toBe(false);
    expect(studioEditorPassesKey(down('t'), button)).toBe(false);
    expect(studioEditorPassesKey(down(' '), button)).toBe(false);
  });
});
