import { describe, expect, it } from 'vitest';
import type { CueAction } from '../../show/cueList';
import { actionWords } from './cueWords';

describe('cue words', () => {
  it('names snapshot and macro slots as they are numbered (1-based)', () => {
    expect(actionWords({ id: 'a', kind: 'snapshot', slot: 1 } as CueAction)).toBe('Snapshot 1');
    expect(actionWords({ id: 'b', kind: 'macro', macro: 1, value: 1, fade: 0 } as CueAction)).toBe('Macro 1');
  });
});
