import type { VisualAudioState } from './visualAudio';

export type GhostAudioVec4 = [number, number, number, number];

export interface GhostAudioUniformVectors {
  audio0: GhostAudioVec4;
  audio1: GhostAudioVec4;
  audio2: GhostAudioVec4;
}

export interface GhostAudioCommandFields {
  active: boolean;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  high: number;
  beat: number;
  beat_phase: number;
  bpm: number;
  centroid: number;
  kick: number;
  snare: number;
}

export const GHOST_AUDIO_UNIFORM_LAYOUT = Object.freeze({
  schema_version: 1,
  audio0: ['level', 'bass', 'mid', 'treble'] as const,
  audio1: ['high', 'beat', 'beat_phase', 'bpm'] as const,
  audio2: ['centroid', 'kick', 'snare', 'active'] as const,
});

function clampFinite(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

export function ghostAudioCommandFieldsFromVisualAudio(audio: VisualAudioState): GhostAudioCommandFields {
  return {
    active: !!audio.isActive,
    level: clampFinite(audio.level, 0, 1),
    bass: Math.max(clampFinite(audio.bass, 0, 1), clampFinite(audio.bassFast * 0.9, 0, 1)),
    mid: clampFinite(audio.mid, 0, 1),
    treble: clampFinite(audio.treble, 0, 1),
    high: clampFinite(audio.high, 0, 1),
    beat: clampFinite(audio.beat, 0, 1),
    beat_phase: clampFinite(audio.beatPhase, 0, 1),
    bpm: clampFinite(audio.bpm, 0, 300),
    centroid: clampFinite(audio.centroid, 0, 1),
    kick: clampFinite(audio.kick, 0, 1),
    snare: clampFinite(audio.snare, 0, 1),
  };
}

export function packGhostAudioUniformVectors(fields: GhostAudioCommandFields): GhostAudioUniformVectors {
  return {
    audio0: [fields.level, fields.bass, fields.mid, fields.treble],
    audio1: [fields.high, fields.beat, fields.beat_phase, fields.bpm],
    audio2: [fields.centroid, fields.kick, fields.snare, fields.active ? 1 : 0],
  };
}
