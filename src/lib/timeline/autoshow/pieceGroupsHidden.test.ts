import { describe, expect, it } from 'vitest';
import type { Layer } from '../../types';
import { pieceInfos } from './pieceGroups';

const quad = (id: string, visible = true): Layer => ({
  id, type: 'video', visible,
  corners: { topLeft: { x: 0.1, y: 0.9 }, topRight: { x: 0.3, y: 0.9 }, bottomRight: { x: 0.3, y: 0.7 }, bottomLeft: { x: 0.1, y: 0.7 } },
} as unknown as Layer);

describe('auto show pieces', () => {
  it('leaves a hidden piece out', () => {
    expect(pieceInfos([quad('a'), quad('b', false)]).map((p) => p.id)).toEqual(['a']);
  });
});
