import { describe, expect, it, vi } from 'vitest';
import { guardAltRelease, noteAltArrow } from './altArrowGuard';

const release = (key = 'Alt') => {
  const preventDefault = vi.fn();
  guardAltRelease({ key, preventDefault });
  return preventDefault;
};

describe('Alt release after Alt+arrow', () => {
  it('is kept from the window once, after an Alt+arrow nudge', () => {
    noteAltArrow({ altKey: true });
    expect(release('ArrowLeft')).not.toHaveBeenCalled();
    expect(release()).toHaveBeenCalledTimes(1);
    expect(release()).not.toHaveBeenCalled();
  });

  it('leaves a lone Alt alone', () => {
    noteAltArrow({ altKey: false });
    expect(release()).not.toHaveBeenCalled();
  });
});
