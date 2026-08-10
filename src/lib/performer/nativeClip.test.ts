import { describe, expect, it } from 'vitest';
import type { SVClipAssignment } from '../types';
import {
  createNativePerformerShaderClip,
  performerAssignmentDeck,
  performerTargetDeck,
} from './nativeClip';

describe('performer native clip routing', () => {
  it('uses deck A in single-deck mode', () => {
    expect(performerTargetDeck({
      crossfaderEnabled: false,
      selectedDeck: 'B',
    })).toBe('A');
  });

  it('uses the selected deck in A/B mode', () => {
    expect(performerTargetDeck({
      crossfaderEnabled: true,
      selectedDeck: 'B',
    })).toBe('B');
  });

  it('keeps old keyboard assignments on Deck A', () => {
    expect(performerAssignmentDeck({ type: 'shader' })).toBe('A');
  });

  it('preserves explicit Deck B ownership', () => {
    expect(performerAssignmentDeck({
      type: 'media',
      performerDeck: 'B',
    })).toBe('B');
  });

  it('converts a keyboard shader assignment into a native VJ shader clip', () => {
    const assignment: SVClipAssignment = {
      type: 'shader',
      shaderId: 'shader-1',
      shaderName: 'Crystal',
      shaderSrc: './ISF/crystal.fs',
      shaderThumbnail: 'thumb.png',
      shaderCode: 'void main() {}',
      manifestDefaults: { speed: 1.5 },
    };

    expect(createNativePerformerShaderClip(assignment, 'launch-1')).toEqual({
      id: 'launch-1',
      type: 'shader',
      name: 'Crystal',
      src: './ISF/crystal.fs',
      thumbnail: 'thumb.png',
      shaderCode: 'void main() {}',
      shaderValues: { speed: 1.5 },
      // Performer-driven clips are edited from Performer's SHADER tab; VJ
      // mode uses this flag to suppress its own clip params panel, which
      // would otherwise write to a grid cell this transient clip never fills.
      _performerOwned: true,
    });
  });
});
