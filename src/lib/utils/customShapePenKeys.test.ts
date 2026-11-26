import { describe, expect, it } from 'vitest';
import { penModeForKey } from './customShapePenKeys';

describe('custom shape pen shortcuts', () => {
  it('V, + and - pick the tools the toolbar tooltips name', () => {
    expect(penModeForKey({ key: 'v' })).toBe('edit');
    expect(penModeForKey({ key: 'V' })).toBe('edit');
    expect(penModeForKey({ key: '+' })).toBe('add');
    expect(penModeForKey({ key: '=' })).toBe('add');
    expect(penModeForKey({ key: '-' })).toBe('remove');
  });

  it('leaves modified keys (Cmd + / - zoom, Cmd V paste) and other keys alone', () => {
    expect(penModeForKey({ key: 'v', metaKey: true })).toBeNull();
    expect(penModeForKey({ key: '-', ctrlKey: true })).toBeNull();
    expect(penModeForKey({ key: '=', altKey: true })).toBeNull();
    expect(penModeForKey({ key: 'x' })).toBeNull();
  });
});
