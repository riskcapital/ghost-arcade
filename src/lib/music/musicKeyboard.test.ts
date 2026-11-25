import { describe, expect, it } from 'vitest';
import { isTypingTarget, takesTypedNotes } from './musicKeyboard';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as Element;

describe('which focused controls keep the note keys', () => {
  it('text fields keep them, a sound menu does not (its letters would jump to another sound)', () => {
    expect(takesTypedNotes(el('INPUT', { type: 'text' }))).toBe(true);
    expect(takesTypedNotes(el('TEXTAREA'))).toBe(true);
    expect(takesTypedNotes(el('SELECT'))).toBe(false);
    expect(takesTypedNotes(el('INPUT', { type: 'range' }))).toBe(false);
    expect(takesTypedNotes(null)).toBe(false);
    // The app's other shortcuts still treat a menu as typing.
    expect(isTypingTarget(el('SELECT'))).toBe(true);
  });
});
