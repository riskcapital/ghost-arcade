import { describe, expect, it } from 'vitest';
import { claimWarpKeys, ownsWarpKeys } from './warpKeyOwner';

describe('warp key owner', () => {
  it('gives the arrow keys to one overlay at a time', () => {
    // Nothing touched yet: both listen.
    expect(ownsWarpKeys('master')).toBe(true);
    expect(ownsWarpKeys('screen')).toBe(true);

    claimWarpKeys('master');
    expect(ownsWarpKeys('master')).toBe(true);
    expect(ownsWarpKeys('screen')).toBe(false);

    claimWarpKeys('screen');
    expect(ownsWarpKeys('screen')).toBe(true);
    expect(ownsWarpKeys('master')).toBe(false);
  });
});
