/**
 * The visual voice library and each set's visual scenes.
 *
 * A scene is a stack of visual voices, each following its own sound, all
 * drawn in the set's palette: one ink and one accent. Voices draw light on
 * black and screen-blend, so they add up the same in any order. Scenes load
 * into a Music Studio instance (studioPlugin.ts, studioTarget.ts): a clip in
 * a VJ cell or a mapping layer, never across the deck's rows.
 */

import { parseISF } from '../isf/parser';
import { VOICE_SOURCE_INPUT, type VoiceSourceId } from './visualVoices';
import type { StudioSet } from './studioSets';
import { STUDIO_PALETTES } from './studioPlugin';

export interface VoiceShader {
  file: string;
  name: string;
  /** The set it was drawn for. Any voice works in any set. */
  family: StudioSet;
  /** One line on what it is. */
  blurb: string;
}

export const VOICE_SHADERS: readonly VoiceShader[] = [
  { file: 'VX-Barcode.fs', name: 'Barcode', family: 'berlin', blurb: 'Black and white data stripes that re-roll on every hit' },
  { file: 'VX-LightLines.fs', name: 'Light Lines', family: 'berlin', blurb: 'Frames of light rushing down a dark corridor' },
  { file: 'VX-Panels.fs', name: 'Panels', family: 'berlin', blurb: 'Architectural light panels that fire in patterns' },
  { file: 'VX-Glyphs.fs', name: 'Glyphs', family: 'berlin', blurb: 'A readout of the notes as they play' },
  { file: 'VX-EchoRings.fs', name: 'Echo Rings', family: 'dub', blurb: 'Rings that repeat like a tape echo' },
  { file: 'VX-Smoke.fs', name: 'Smoke', family: 'dub', blurb: 'Smoke rising from where each bass note lands' },
  { file: 'VX-Scope.fs', name: 'Scope', family: 'dub', blurb: 'The notes drawn as oscilloscope figures' },
  { file: 'VX-Nebula.fs', name: 'Nebula', family: 'bath', blurb: 'Deep veils of light that open as pads swell' },
  { file: 'VX-Cymatics.fs', name: 'Cymatics', family: 'bath', blurb: 'Sand settling into the figure of each note' },
  { file: 'VX-Aurora.fs', name: 'Aurora', family: 'bath', blurb: 'A curtain of light for every note of the chord' },
  { file: 'VX-VideoSynth.fs', name: 'Video Synth', family: 'analog', blurb: 'Oscillators in the raster, tuned to the notes' },
  { file: 'VX-Wobbulator.fs', name: 'Wobbulator', family: 'analog', blurb: 'Scan lines bent by the sound itself' },
  { file: 'VX-ScanField.fs', name: 'Scan Field', family: 'analog', blurb: 'A scan-processor landscape that ripples on each hit' },
  { file: 'VX-Feedback.fs', name: 'Feedback', family: 'analog', blurb: 'Camera-into-monitor feedback, seeded by hits' },  { file: 'VX-Automaton.fs', name: 'Automaton', family: 'berlin', blurb: 'A cellular automaton that prints one row per hit' },
  { file: 'VX-Compression.fs', name: 'Compression', family: 'berlin', blurb: 'Codec blocks rebuilt from a few patterns' },
  { file: 'VX-Datamosh.fs', name: 'Datamosh', family: 'berlin', blurb: 'A picture smeared along its own motion' },
  { file: 'VX-DataPlot.fs', name: 'Data Plot', family: 'berlin', blurb: 'The notes as scientific plots in hairlines' },
  { file: 'VX-DataStream.fs', name: 'Data Stream', family: 'berlin', blurb: 'Rows of bits streaming across the frame' },
  { file: 'VX-Spectra.fs', name: 'Spectra', family: 'berlin', blurb: 'A one-bit spectrum of the sounding notes' },
  { file: 'VX-TestPattern.fs', name: 'Test Pattern', family: 'berlin', blurb: 'Test signal zones that step on each hit' },
  { file: 'VX-BitCounter.fs', name: 'Bit Counter', family: 'berlin', blurb: 'Every note written out in binary columns' },
  { file: 'VX-GlitchCollage.fs', name: 'Glitch Collage', family: 'berlin', blurb: 'Panels of a picture cut and re-cut on hits' },
  { file: 'VX-LedGrid.fs', name: 'LED Grid', family: 'berlin', blurb: 'A wall of LEDs playing the rhythm' },
  { file: 'VX-Monolith.fs', name: 'Monolith', family: 'berlin', blurb: 'Stone monoliths under two hard lights' },
  { file: 'VX-Oscillogram.fs', name: 'Oscillogram', family: 'berlin', blurb: 'A scrolling trace of the playing note' },
  { file: 'VX-PixelSort.fs', name: 'Pixel Sort', family: 'berlin', blurb: 'A picture whose pixels sort into streaks' },
  { file: 'VX-PointCloud.fs', name: 'Point Cloud', family: 'berlin', blurb: 'A turning cloud of points on a torus' },
  { file: 'VX-PulseBars.fs', name: 'Pulse Bars', family: 'berlin', blurb: 'Tall light bars fired one after another' },
  { file: 'VX-Scanner.fs', name: 'Scanner', family: 'berlin', blurb: 'A bar of light swept across on each hit' },
  { file: 'VX-SignalTear.fs', name: 'Signal Tear', family: 'berlin', blurb: 'Bands of a figure torn sideways on hits' },
  { file: 'VX-TunnelLines.fs', name: 'Tunnel Lines', family: 'berlin', blurb: 'Hairline rings receding to a point' },
  { file: 'VX-HazeBeams.fs', name: 'Haze Beams', family: 'dub', blurb: 'Narrow beams through smoke, one per note' },
  { file: 'VX-RippleTank.fs', name: 'Ripple Tank', family: 'dub', blurb: 'Contour lines of water rung by each hit' },
  { file: 'VX-SpeakerCone.fs', name: 'Speaker Cone', family: 'dub', blurb: 'A big driver pushing with the bass' },
  { file: 'VX-SpeakerStack.fs', name: 'Speaker Stack', family: 'dub', blurb: 'A sound-system stack seen from low down' },
  { file: 'VX-Spring.fs', name: 'Spring', family: 'dub', blurb: 'Waves running down a spring reverb' },
  { file: 'VX-TapeLoop.fs', name: 'Tape Loop', family: 'dub', blurb: 'A multi-head tape echo as a diagram' },
  { file: 'VX-Vinyl.fs', name: 'Vinyl', family: 'dub', blurb: 'A dubplate turning under the stylus' },
  { file: 'VX-Breath.fs', name: 'Breath', family: 'bath', blurb: 'One fine ring that opens as the sound swells' },
  { file: 'VX-Caustics.fs', name: 'Caustics', family: 'bath', blurb: 'Light on the floor of still water' },
  { file: 'VX-Horizon.fs', name: 'Horizon', family: 'bath', blurb: 'A still horizon over calm water' },
  { file: 'VX-InkBloom.fs', name: 'Ink Bloom', family: 'bath', blurb: 'Ink dropped into still water' },
  { file: 'VX-Moon.fs', name: 'Moon', family: 'bath', blurb: 'A moon whose phase is the chord' },
  { file: 'VX-RoseCurves.fs', name: 'Rose Curves', family: 'bath', blurb: 'A harmonograph swung by the chord' },
  { file: 'VX-Starfield.fs', name: 'Starfield', family: 'bath', blurb: 'A deep field of stars that streak on hits' },
  { file: 'VX-FrameStore.fs', name: 'Frame Store', family: 'analog', blurb: 'An early digital frame buffer, written on hits' },
  { file: 'VX-Moire.fs', name: 'Moire', family: 'analog', blurb: 'Interfering gratings, one per note' },
  { file: 'VX-OscBank.fs', name: 'Osc Bank', family: 'analog', blurb: 'One oscillator trace per sounding note' },
  { file: 'VX-ScopeGrid.fs', name: 'Scope Grid', family: 'analog', blurb: 'A wall of small oscilloscopes' },
  { file: 'VX-Stairs.fs', name: 'Stairs', family: 'analog', blurb: 'A staircase wavefolder in light' },
  { file: 'VX-SyncRoll.fs', name: 'Sync Roll', family: 'analog', blurb: 'A test picture that rolls when it loses sync' },
  { file: 'VX-VectorText.fs', name: 'Vector Text', family: 'analog', blurb: 'Note names written in beam strokes' },
  { file: 'VX-Colorizer.fs', name: 'Colorizer', family: 'analog', blurb: 'A light field sliced into colour bands' },
];

export const voiceShaderByFile = (file: string): VoiceShader | undefined => VOICE_SHADERS.find((v) => v.file === file);

/** Each set's palette: one ink and one accent. */
export const SET_PALETTES = STUDIO_PALETTES;

export interface SceneVoice {
  file: string;
  source: VoiceSourceId;
  /** Look inputs to set, by name. */
  params?: Record<string, number>;
  /** How much of it shows, 0-1. */
  level?: number;
}

export interface VisualScene {
  id: string;
  name: string;
  set: StudioSet;
  /** The voices, bottom to top. */
  voices: SceneVoice[];
}

export const VISUAL_SCENES: readonly VisualScene[] = [
  { id: 'berlin-data', name: 'Readout', set: 'berlin', voices: [
    { file: 'VX-ScanField.fs', source: 'bass', params: { relief: 0.3, ripple: 0.85, flow: 0.25 } },
    { file: 'VX-Panels.fs', source: 'snare' },
    { file: 'VX-Barcode.fs', source: 'hats', params: { bands: 3, density: 0.35 }, level: 0.6 },
    { file: 'VX-Glyphs.fs', source: 'lead' },
  ] },
  { id: 'berlin-corridor', name: 'Corridor', set: 'berlin', voices: [
    { file: 'VX-LightLines.fs', source: 'kick' },
    { file: 'VX-Barcode.fs', source: 'hats', level: 0.7 },
    { file: 'VX-Panels.fs', source: 'snare', level: 0.8 },
    { file: 'VX-Glyphs.fs', source: 'bass', level: 0.8 },
  ] },
  { id: 'berlin-bits', name: 'Data', set: 'berlin', voices: [
    { file: 'VX-DataStream.fs', source: 'hats', level: 0.8 },
    { file: 'VX-Barcode.fs', source: 'kick', level: 0.6 },
    { file: 'VX-BitCounter.fs', source: 'bass' },
    { file: 'VX-DataPlot.fs', source: 'lead', level: 0.8 },
  ] },
  { id: 'berlin-glitch', name: 'Glitch', set: 'berlin', voices: [
    { file: 'VX-GlitchCollage.fs', source: 'kick', level: 0.8 },
    { file: 'VX-SignalTear.fs', source: 'snare' },
    { file: 'VX-PixelSort.fs', source: 'bass', level: 0.7 },
    { file: 'VX-TestPattern.fs', source: 'hats', level: 0.5 },
  ] },
  { id: 'berlin-monolith', name: 'Monolith', set: 'berlin', voices: [
    { file: 'VX-Monolith.fs', source: 'kick', level: 0.8 },
    { file: 'VX-PulseBars.fs', source: 'hats', level: 0.7 },
    { file: 'VX-Scanner.fs', source: 'snare' },
    { file: 'VX-TunnelLines.fs', source: 'bass', level: 0.8 },
  ] },
  { id: 'dub-chamber', name: 'Echo chamber', set: 'dub', voices: [
    { file: 'VX-Smoke.fs', source: 'bass' },
    { file: 'VX-EchoRings.fs', source: 'kick' },
    { file: 'VX-Scope.fs', source: 'chords' },
    { file: 'VX-Feedback.fs', source: 'fx' },
  ] },
  { id: 'dub-system', name: 'Sound system', set: 'dub', voices: [
    { file: 'VX-ScanField.fs', source: 'kick', params: { relief: 0.2, ripple: 1, ring: 0.8 } },
    { file: 'VX-Smoke.fs', source: 'bass', level: 0.8 },
    { file: 'VX-EchoRings.fs', source: 'snare' },
    { file: 'VX-Scope.fs', source: 'played' },
  ] },
  { id: 'dub-yard', name: 'Yard', set: 'dub', voices: [
    { file: 'VX-SpeakerStack.fs', source: 'kick', level: 0.8 },
    { file: 'VX-SpeakerCone.fs', source: 'bass' },
    { file: 'VX-HazeBeams.fs', source: 'chords', level: 0.7 },
    { file: 'VX-TapeLoop.fs', source: 'snare', level: 0.8 },
  ] },
  { id: 'dub-plate', name: 'Dubplate', set: 'dub', voices: [
    { file: 'VX-Vinyl.fs', source: 'bass', level: 0.8 },
    { file: 'VX-Spring.fs', source: 'snare' },
    { file: 'VX-RippleTank.fs', source: 'kick', level: 0.7 },
  ] },
  { id: 'dub-glitch', name: 'Glitch', set: 'dub', voices: [
    { file: 'VX-Datamosh.fs', source: 'bass', level: 0.7 },
    { file: 'VX-SignalTear.fs', source: 'snare' },
    { file: 'VX-TapeLoop.fs', source: 'fx', level: 0.8 },
  ] },
  { id: 'bath-night', name: 'Night sky', set: 'bath', voices: [
    { file: 'VX-Nebula.fs', source: 'pad', level: 0.65 },
    { file: 'VX-Aurora.fs', source: 'chords' },
    // Bowls and drone count as pads.
    { file: 'VX-Cymatics.fs', source: 'pad' },
    { file: 'VX-Scope.fs', source: 'lead', level: 0.7 },
  ] },
  { id: 'bath-water', name: 'Still water', set: 'bath', voices: [
    { file: 'VX-Nebula.fs', source: 'pad', level: 0.8 },
    { file: 'VX-ScanField.fs', source: 'played', params: { relief: 0.15, ripple: 0.6, ring: 0.95, flow: 0.08, lines: 120 } },
    { file: 'VX-Cymatics.fs', source: 'chords' },
  ] },
  { id: 'bath-moon', name: 'Moonrise', set: 'bath', voices: [
    { file: 'VX-Horizon.fs', source: 'pad', level: 0.8 },
    { file: 'VX-Moon.fs', source: 'chords' },
    { file: 'VX-Starfield.fs', source: 'lead', level: 0.6 },
  ] },
  { id: 'bath-pool', name: 'Pool', set: 'bath', voices: [
    { file: 'VX-Caustics.fs', source: 'pad', level: 0.7 },
    { file: 'VX-InkBloom.fs', source: 'played' },
    { file: 'VX-Breath.fs', source: 'chords', level: 0.8 },
  ] },
  { id: 'bath-pendulum', name: 'Pendulum', set: 'bath', voices: [
    { file: 'VX-RoseCurves.fs', source: 'chords' },
    { file: 'VX-Breath.fs', source: 'pad', level: 0.7 },
    { file: 'VX-Starfield.fs', source: 'played', level: 0.5 },
  ] },
  { id: 'analog-patch', name: 'Patch bay', set: 'analog', voices: [
    { file: 'VX-VideoSynth.fs', source: 'played' },
    { file: 'VX-Wobbulator.fs', source: 'bass' },
    { file: 'VX-Feedback.fs', source: 'fx' },
    { file: 'VX-ScanField.fs', source: 'kick', level: 0.7 },
  ] },
  { id: 'analog-signal', name: 'Signal', set: 'analog', voices: [
    { file: 'VX-Feedback.fs', source: 'played' },
    { file: 'VX-Wobbulator.fs', source: 'bass' },
    { file: 'VX-Scope.fs', source: 'chords' },
  ] },  { id: 'analog-lab', name: 'Test bench', set: 'analog', voices: [
    { file: 'VX-ScopeGrid.fs', source: 'played', level: 0.8 },
    { file: 'VX-OscBank.fs', source: 'chords' },
    { file: 'VX-SyncRoll.fs', source: 'kick', level: 0.6 },
    { file: 'VX-VectorText.fs', source: 'lead' },
  ] },
  { id: 'analog-colour', name: 'Colour', set: 'analog', voices: [
    { file: 'VX-Colorizer.fs', source: 'pad', level: 0.8 },
    { file: 'VX-Moire.fs', source: 'chords', level: 0.7 },
    { file: 'VX-Stairs.fs', source: 'bass' },
  ] },
  { id: 'analog-store', name: 'Frame store', set: 'analog', voices: [
    { file: 'VX-FrameStore.fs', source: 'kick', level: 0.8 },
    { file: 'VX-Wobbulator.fs', source: 'bass', level: 0.8 },
    { file: 'VX-Stairs.fs', source: 'hats', level: 0.6 },
  ] },
];

export const scenesForSet = (set: StudioSet): VisualScene[] => VISUAL_SCENES.filter((s) => s.set === set);

/** Inputs a voice shader declares, parsed once per source. */
const inputCache = new Map<string, ShaderInput[]>();

export interface ShaderInput {
  NAME: string;
  LABEL?: string;
  TYPE: string;
  DEFAULT?: unknown;
  MIN?: number;
  MAX?: number;
  VALUES?: number[];
  LABELS?: string[];
}

export function shaderInputs(code: string): ShaderInput[] {
  const cached = inputCache.get(code);
  if (cached) return cached;
  let inputs: ShaderInput[] = [];
  try {
    inputs = (parseISF(code).metadata.INPUTS ?? []) as ShaderInput[];
  } catch {
    inputs = [];
  }
  if (inputCache.size > 100) inputCache.clear();
  inputCache.set(code, inputs);
  return inputs;
}

export function isVoiceShader(code: string | undefined): boolean {
  return !!code && shaderInputs(code).some((i) => i.NAME === VOICE_SOURCE_INPUT);
}
