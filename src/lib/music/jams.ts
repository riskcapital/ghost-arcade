/**
 * Ready-made starting points: a beat, loops, a visual scene and the cables
 * that tie the set together.
 */

import { get } from 'svelte/store';
import { macros } from '../stores/macros';
import { createPattern, type DrumPattern } from './drumPattern';
import { musicStudio } from './musicStudioStore';
import { VISUAL_SCENES, loadVisualScene } from './visualScenes';
import { launchLoop, startSequencer, stopAllLoops } from './musicRuntime';
import type { Cable } from './studioSets';

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

/** Load a set's visual scene by id. */
async function visualScene(id: string): Promise<void> {
  const scene = VISUAL_SCENES.find((sc) => sc.id === id);
  if (scene) await loadVisualScene(scene);
}

/**
 * The Berlin jam: a techno beat and the acid line under the "Data" visual
 * scene: the scan field rolls with the acid bass, panels fire on the claps,
 * barcodes re-roll on the hats and a readout follows the lead. The acid and
 * the drums go through the FX, and the snare turns CHAOS.
 */
export async function loadBerlinJam(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('berlin');
  musicStudio.setPattern(technoPattern());
  await visualScene('berlin-data');
  const chaos = get(macros).macros[1]?.id;
  const cables: Cable[] = [
    { id: 'jam-acid-fx', from: 'audio:acid', to: 'fx:in' },
    { id: 'jam-drums-fx', from: 'audio:drums', to: 'fx:in' },
  ];
  if (chaos) cables.push({ id: 'jam-snare-chaos', from: 'cv:drum.clap', to: `dest:macro:${chaos}` });
  musicStudio.setCables('berlin', cables);
  if (!get(musicStudio).sequencerPlaying) startSequencer();
}

/**
 * The dub session: a one drop beat, the root-and-fifth bassline and the
 * skank on the keys, with the skank, siren and shots in the tape echo, under
 * the "Echo chamber" scene: smoke rises from the bass, rings echo the kick,
 * the scope draws the skank's chords and the shots feed back.
 */
export async function loadDubJam(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('dub');
  await visualScene('dub-chamber');
  musicStudio.setCables('dub', [
    { id: 'jam-keys-echo', from: 'audio:keys', to: 'fx:in' },
    { id: 'jam-siren-echo', from: 'audio:siren', to: 'fx:in' },
    { id: 'jam-shots-echo', from: 'audio:shots', to: 'fx:in' },
  ]);
  launchLoop('beat-onedrop', true);
  launchLoop('bass-dub-root', true);
  launchLoop('chords-skank', true);
}

/**
 * A first analog patch: the LFO sweeps the filter, the synth goes through
 * the FX, and a bassline plays under the "Patch bay" scene, where the video
 * synth's oscillators are tuned to the notes you play.
 */
export async function loadAnalogPatch(): Promise<void> {
  stopAllLoops();
  musicStudio.setSet('analog');
  await visualScene('analog-patch');
  musicStudio.setCables('analog', [
    { id: 'patch-out-fx', from: 'audio:analog', to: 'fx:in' },
    { id: 'patch-lfo-cutoff', from: 'cv:analog.lfo', to: 'dest:analog.cutoff' },
  ]);
  launchLoop('bass-rolling', true);
}
