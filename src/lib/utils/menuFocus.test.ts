import { describe, expect, it, vi } from 'vitest';
import { menuFocusHandlers } from './menuFocus';

const menu = () => ({ tagName: 'SELECT', blur: vi.fn() }) as unknown as EventTarget & { blur: ReturnType<typeof vi.fn> };

describe('a menu gives its focus back after a choice', () => {
  it('blurs a select chosen with the mouse, so the letter keys play notes', () => {
    const h = menuFocusHandlers();
    const m = menu();
    h.pointerdown({ target: m });
    h.change({ target: m });
    expect(m.blur).toHaveBeenCalledTimes(1);
  });

  it('keeps the focus of a select worked from the keyboard, until the mouse is used again', () => {
    const h = menuFocusHandlers();
    const m = menu();
    h.keydown({ target: m });
    h.change({ target: m });
    expect(m.blur).not.toHaveBeenCalled();
    h.pointerdown({ target: m });
    h.change({ target: m });
    expect(m.blur).toHaveBeenCalledTimes(1);
  });

  it('leaves other fields alone', () => {
    const h = menuFocusHandlers();
    const input = { tagName: 'INPUT', blur: vi.fn() } as unknown as EventTarget & { blur: ReturnType<typeof vi.fn> };
    h.change({ target: input });
    expect(input.blur).not.toHaveBeenCalled();
  });
});
