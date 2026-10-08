import { describe, it, expect } from 'vitest';
import { defaultInteractive } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { discoverKeyframeableParams } from './paramDiscovery';
import type { Layer } from '../types';
const stack = (...kinds: Parameters<typeof makeEffect>[0][]) => ({ ...defaultInteractive(), effects: kinds.map(kind => makeEffect(kind)) });

describe('Interactive desktop timeline groups', () => {
  it('gives two effects of one style their own keyframe timeline group', () => {
    const scene = stack('architecture', 'architecture');
    const layer = { source: { effectSource: { interactiveScene: scene } } } as unknown as Layer;
    const groupsOf = () => [...new Set(discoverKeyframeableParams(layer).map((p) => p.group))].filter((group) => group?.startsWith('Interactive'));
    expect(groupsOf()).toEqual(['Interactive · Living Architecture 1', 'Interactive · Living Architecture 2']);
    scene.effects![0].name = 'Floor';
    expect(groupsOf()).toEqual(['Interactive · Floor', 'Interactive · Living Architecture']);
  });
});
