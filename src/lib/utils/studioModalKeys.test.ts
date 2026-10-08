import { describe, it, expect } from 'vitest';
import { isTypingTarget, studioModalKeyAction, type StudioModalKeyEvent } from './studioModalKeys';

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
