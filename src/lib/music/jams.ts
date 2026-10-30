/**
 * Ready-made starting points: a beat, its visuals and the cables between them.
 */

import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { macros } from '../stores/macros';
import { createPattern, type DrumPattern } from './drumPattern';
import { musicStudio } from './musicStudioStore';
import { DUB_SHADERS, GLITCH_SHADERS, NOTE_SHADERS, setLayerVisual, type ShippedShader } from './noteShaders';
import { launchLoop, startSequencer, stopAllLoops } from './musicRuntime';
import type { Cable, StudioSet } from './studioSets';

/** A driving 4/4: kick on every beat, clap on two and four, hats on the offbeats with ghosts between. */
export function technoPattern(): DrumPattern {
  const p = createPattern(16);
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) p.tracks.kick[i] = 1;
    if (i % 4 === 2) p.tracks.hatClosed[i] = 0.75;
    else if (i % 2 === 1) p.tracks.hatClosed[i] = 0.3;
  }
  p.tracks.clap[4] = 0.85;
  p.tracks.clap[12] = 0.85;
  p.tracks.hatOpen[6] = 0.5;
  p.tracks.hatOpen[14] = 0.5;
  p.tracks.rim[3] = 0.45;
  p.tracks.rim[11] = 0.45;
  p.tracks.tom[15] = 0.4;
  p.swing = 0.08;
  return p;
}

const SHIPPED: readonly ShippedShader[] = [...GLITCH_SHADERS, ...DUB_SHADERS, ...NOTE_SHADERS];
const byFile = (file: string) => SHIPPED.find((g) => g.file === file)!;

/** Put each visual on its own deck A layer, bottom to top, and return how many fit. */
async function stackLayers(files: string[]): Promise<number> {
  const layers = Math.min(files.length, get(vjClipLauncher).layerStates.length);
  for (let i = 0; i < layers; i++) {
    const visual = byFile(files[i]);
    await setLayerVisual(i, visual.file, visual.name);
    // Dark visuals stack by brightness.
    vjClipLauncher.setLayerBlendMode(i, i === 0 ? 'normal' : 'screen', 'A');
    vjClipLauncher.setLayerOpacity(i, 1, 'A');
    if (get(vjClipLauncher).layerStates[i]?.mute) vjClipLauncher.toggleLayerMute(i, 'A');
  }
  return layers;
}

/** Patch a set, leaving out cables to layers the deck does not have. */
function patch(set: StudioSet, cables: Cable[], layers: number): void {
  musicStudio.setCables(set, cables.filter((c) => !c.to.startsWith('dest:layer:') || Number(c.to.slice(11)) < layers));
}

/** Layer by layer, bottom to top: the glitch look of the Berlin jam. */
export const BERLIN_JAM_LAYERS = ['BG-Threshold.fs', 'BG-SlitScan.fs', 'BG-Scanlines.fs', 'BG-KickStrobe.fs'];

/**
 * The Berlin glitch jam: a techno beat and the acid line, four black and
 * white layers, and the cables that make each drum drive its own layer.
 * The threshold bed stays up; the acid filter opens the slit-scan, the hats
 * tear the scanlines, the kick fires the strobe, the snare turns CHAOS.
 */
export async function loadBerlinJam(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('berlin');
  musicStudio.setPattern(technoPattern());
  const layers = await stackLayers(BERLIN_JAM_LAYERS);
  const chaos = get(macros).macros[1]?.id;
  const cables: Cable[] = [
    { id: 'jam-acid-fx', from: 'audio:acid', to: 'fx:in' },
    { id: 'jam-drums-fx', from: 'audio:drums', to: 'fx:in' },
    { id: 'jam-acid-slit', from: 'cv:acid.cutoff', to: 'dest:layer:1' },
    { id: 'jam-hat-scan', from: 'cv:drum.hatClosed', to: 'dest:layer:2' },
    { id: 'jam-kick-strobe', from: 'cv:drum.kick', to: 'dest:layer:3' },
  ];
  if (chaos) cables.push({ id: 'jam-snare-chaos', from: 'cv:drum.clap', to: `dest:macro:${chaos}` });
  patch('berlin', cables, layers);
  if (!get(musicStudio).sequencerPlaying) startSequencer();
}

/** Layer by layer, bottom to top: the dub session's visuals. */
export const DUB_JAM_LAYERS = ['DB-Smoke.fs', 'DB-EchoTrails.fs', 'DB-Ripples.fs', 'DB-Speaker.fs'];

/**
 * The dub session: a one drop beat, the root-and-fifth bassline and the
 * skank on the keys, with the skank, siren and shots in the tape echo. The
 * bass swells the smoke, the shots throw ripples and the kick pumps the
 * speaker.
 */
export async function loadDubJam(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('dub');
  const layers = await stackLayers(DUB_JAM_LAYERS);
  patch('dub', [
    { id: 'jam-keys-echo', from: 'audio:keys', to: 'fx:in' },
    { id: 'jam-siren-echo', from: 'audio:siren', to: 'fx:in' },
    { id: 'jam-shots-echo', from: 'audio:shots', to: 'fx:in' },
    { id: 'jam-bass-smoke', from: 'cv:dubbass.level', to: 'dest:layer:0' },
    { id: 'jam-snare-trails', from: 'cv:drum.snare', to: 'dest:layer:1' },
    { id: 'jam-shots-ripples', from: 'cv:shots.level', to: 'dest:layer:2' },
    { id: 'jam-kick-speaker', from: 'cv:drum.kick', to: 'dest:layer:3' },
  ], layers);
  launchLoop('beat-onedrop', true);
  launchLoop('bass-dub-root', true);
  launchLoop('chords-skank', true);
}

/**
 * A first analog patch: the LFO sweeps the filter, the envelope lights a
 * note visual and the LFO breathes a second one, with a bassline to play over.
 */
export async function loadAnalogPatch(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('analog');
  const layers = await stackLayers(['NR-NoteBloom.fs', 'NR-ChordRings.fs']);
  patch('analog', [
    { id: 'patch-out-fx', from: 'audio:analog', to: 'fx:in' },
    { id: 'patch-lfo-cutoff', from: 'cv:analog.lfo', to: 'dest:analog.cutoff' },
    { id: 'patch-env-bloom', from: 'cv:analog.env', to: 'dest:layer:0' },
    { id: 'patch-lfo-rings', from: 'cv:analog.lfo', to: 'dest:layer:1' },
  ], layers);
  launchLoop('bass-rolling', true);
}
