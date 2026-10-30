/**
 * The visual voice library and each set's visual scenes.
 *
 * A scene is a stack of visual voices on deck A, one per row, each following
 * its own sound, all drawn in the set's palette: one ink and one accent.
 * Voices draw light on black and every row screen-blends, so they add up the
 * same whichever row is on top. Loading a scene puts each voice on its row,
 * sets what it follows and its look, and stops the rows it does not use.
 */

import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { showToast } from '../stores/errorToast';
import { parseISF } from '../isf/parser';
import { setLayerVisual } from './noteShaders';
import { VOICE_AUTO_INPUT, VOICE_SOURCE_INPUT, voiceSourceIndex, type VoiceSourceId } from './visualVoices';
import type { StudioSet } from './studioSets';

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
  { file: 'VX-Feedback.fs', name: 'Feedback', family: 'analog', blurb: 'Camera-into-monitor feedback, seeded by hits' },
];

export const voiceShaderByFile = (file: string): VoiceShader | undefined => VOICE_SHADERS.find((v) => v.file === file);

type RGB = [number, number, number];

/** Each set's palette: one ink and one accent. */
export const SET_PALETTES: Record<StudioSet, { ink: RGB; accent: RGB }> = {
  bath: { ink: [0.72, 0.82, 1.0], accent: [1.0, 0.8, 0.45] },
  berlin: { ink: [0.94, 0.95, 0.97], accent: [1.0, 0.16, 0.1] },
  dub: { ink: [1.0, 0.72, 0.36], accent: [0.25, 0.9, 0.62] },
  analog: { ink: [0.75, 1.0, 0.92], accent: [1.0, 0.45, 0.12] },
};

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
  /** One voice per deck A row, from row 1. */
  voices: SceneVoice[];
}

export const VISUAL_SCENES: readonly VisualScene[] = [
  { id: 'berlin-data', name: 'Data', set: 'berlin', voices: [
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

/** Set one input on the clip playing on a deck A row, the way the clip panel does. */
export function setVoiceValue(layer: number, name: string, value: unknown): void {
  const state = get(vjClipLauncher).layerStates[layer];
  if (!state?.activeClip || state.activeColumn === null || state.activeColumn === undefined) return;
  vjClipLauncher.updateClipShaderValue(layer, state.activeColumn, name, value, 'A');
}

/**
 * Put a voice on a deck A row in the set's palette, following `source`
 * (or, without one, the sound the voice was drawn for).
 */
export async function loadVoice(layer: number, voice: Omit<SceneVoice, 'source'> & { source?: VoiceSourceId }, set: StudioSet): Promise<void> {
  const shader = voiceShaderByFile(voice.file);
  if (!shader) return;
  await setLayerVisual(layer, shader.file, shader.name);
  const palette = SET_PALETTES[set];
  if (voice.source) setVoiceValue(layer, VOICE_SOURCE_INPUT, voiceSourceIndex(voice.source));
  setVoiceValue(layer, VOICE_AUTO_INPUT, true);
  setVoiceValue(layer, 'ink', [...palette.ink, 1]);
  setVoiceValue(layer, 'accent', [...palette.accent, 1]);
  for (const [name, value] of Object.entries(voice.params ?? {})) setVoiceValue(layer, name, value);
  // Voices draw on black: screen adds each one's light to the others.
  vjClipLauncher.setLayerBlendMode(layer, 'screen', 'A');
  vjClipLauncher.setLayerOpacity(layer, voice.level ?? 1, 'A');
  if (get(vjClipLauncher).layerStates[layer]?.mute) vjClipLauncher.toggleLayerMute(layer, 'A');
}

/** Load a scene onto deck A, adding rows if it needs more, and stopping the rows it does not use. */
export async function loadVisualScene(scene: VisualScene): Promise<void> {
  while (get(vjClipLauncher).layerStates.length < scene.voices.length) {
    const before = get(vjClipLauncher).layerStates.length;
    vjClipLauncher.addLayer();
    if (get(vjClipLauncher).layerStates.length === before) break;
  }
  const rows = get(vjClipLauncher).layerStates.length;
  for (let i = 0; i < Math.min(rows, scene.voices.length); i++) await loadVoice(i, scene.voices[i], scene.set);
  for (let i = scene.voices.length; i < rows; i++) {
    if (get(vjClipLauncher).layerStates[i]?.activeClip) vjClipLauncher.stopLayer(i, 'A');
  }
}

/** Add a voice on the first empty deck A row (adding a row when every one is in use). */
export async function addVoiceRow(file: string, source: VoiceSourceId, set: StudioSet): Promise<void> {
  const freeRow = () => get(vjClipLauncher).layerStates.findIndex((row) => !row.activeClip);
  let layer = freeRow();
  if (layer < 0) {
    vjClipLauncher.addLayer();
    layer = freeRow();
  }
  if (layer < 0) {
    showToast('Every deck row is in use. Clear one to add another visual.', 'warning');
    return;
  }
  await loadVoice(layer, { file, source }, set);
}
