import { describe, expect, it } from 'vitest';
import {
  GHOST_AUDIO_UNIFORM_LAYOUT,
  ghostAudioCommandFieldsFromVisualAudio,
  packGhostAudioUniformVectors,
} from './ghostAudioUniform';
import type { VisualAudioState } from './visualAudio';

function visualAudio(overrides: Partial<VisualAudioState> = {}): VisualAudioState {
  return {
    isActive: true,
    bands: {
      sub: 0.1,
      bass: 0.2,
      lowMid: 0.3,
      mid: 0.35,
      highMid: 0.4,
      treble: 0.45,
      air: 0.5,
      presence: 0.52,
      high: 0.55,
    },
    level: 0.25,
    energy: 0.3,
    peak: 0.5,
    bass: 0.2,
    bassFast: 0.6,
    mid: 0.35,
    treble: 0.45,
    high: 0.55,
    sub: 0.1,
    lowMid: 0.3,
    highMid: 0.4,
    air: 0.5,
    presence: 0.52,
    beat: 0.65,
    beatPhase: 0.75,
    lfoBeat: 0.8,
    lfoHalf: 0.7,
    lfoBar: 0.6,
    bpm: 128,
    centroid: 0.42,
    kick: 0.8,
    snare: 0.15,
    ...overrides,
  };
}

describe('ghost audio uniform layout', () => {
  it('documents the canonical three-vec4 slot order', () => {
    expect(GHOST_AUDIO_UNIFORM_LAYOUT).toEqual({
      schema_version: 1,
      audio0: ['level', 'bass', 'mid', 'treble'],
      audio1: ['high', 'beat', 'beat_phase', 'bpm'],
      audio2: ['centroid', 'kick', 'snare', 'active'],
    });
  });

  it('packs visual audio into the native/WGSL layout', () => {
    const fields = ghostAudioCommandFieldsFromVisualAudio(visualAudio());
    expect(fields.bass).toBeCloseTo(0.54);
    expect(packGhostAudioUniformVectors(fields)).toEqual({
      audio0: [0.25, 0.54, 0.35, 0.45],
      audio1: [0.55, 0.65, 0.75, 128],
      audio2: [0.42, 0.8, 0.15, 1],
    });
  });

  it('clamps invalid input without changing the slot layout', () => {
    const fields = ghostAudioCommandFieldsFromVisualAudio(visualAudio({
      isActive: false,
      level: 12,
      bass: Number.NaN,
      bassFast: 2,
      beatPhase: -1,
      bpm: 900,
    }));
    expect(packGhostAudioUniformVectors(fields)).toMatchObject({
      audio0: [1, 1, 0.35, 0.45],
      audio1: [0.55, 0.65, 0, 300],
      audio2: [0.42, 0.8, 0.15, 0],
    });
  });
});
