/**
 * Ready-made starting points: a beat, its visuals and the cables between them.
 */

import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { macros } from '../stores/macros';
import { createPattern, type DrumPattern } from './drumPattern';
import { musicStudio } from './musicStudioStore';
import { GLITCH_SHADERS, setLayerVisual } from './noteShaders';
import { startSequencer } from './musicRuntime';
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

const byFile = (file: string) => GLITCH_SHADERS.find((g) => g.file === file)!;

/** Layer by layer, bottom to top: the glitch look of the Berlin jam. */
export const BERLIN_JAM_LAYERS = ['BG-Threshold.fs', 'BG-SlitScan.fs', 'BG-Scanlines.fs', 'BG-KickStrobe.fs'];

/**
 * The Berlin glitch jam: a techno beat and the acid line, four black and
 * white layers, and the cables that make each drum drive its own layer.
 * The threshold bed stays up; the acid filter opens the slit-scan, the hats
 * tear the scanlines, the kick fires the strobe, the snare turns CHAOS.
 */
export async function loadBerlinJam(): Promise<void> {
  musicStudio.setSet('berlin');
  musicStudio.setPattern(technoPattern());
  const launcher = get(vjClipLauncher);
  const layers = Math.min(BERLIN_JAM_LAYERS.length, launcher.layerStates.length);
  for (let i = 0; i < layers; i++) {
    const visual = byFile(BERLIN_JAM_LAYERS[i]);
    await setLayerVisual(i, visual.file, visual.name);
    // Black and white layers stack by brightness.
    vjClipLauncher.setLayerBlendMode(i, i === 0 ? 'normal' : 'screen', 'A');
    vjClipLauncher.setLayerOpacity(i, 1, 'A');
    if (get(vjClipLauncher).layerStates[i]?.mute) vjClipLauncher.toggleLayerMute(i, 'A');
  }
  const chaos = get(macros).macros[1]?.id;
  const cables: Cable[] = [
    { id: 'jam-acid-fx', from: 'audio:acid', to: 'fx:in' },
    { id: 'jam-drums-fx', from: 'audio:drums', to: 'fx:in' },
    { id: 'jam-acid-slit', from: 'cv:acid.cutoff', to: 'dest:layer:1' },
    { id: 'jam-hat-scan', from: 'cv:drum.hatClosed', to: 'dest:layer:2' },
    { id: 'jam-kick-strobe', from: 'cv:drum.kick', to: 'dest:layer:3' },
  ];
  if (chaos) cables.push({ id: 'jam-snare-chaos', from: 'cv:drum.clap', to: `dest:macro:${chaos}` });
  musicStudio.setCables('berlin', cables.filter((c) => !c.to.startsWith('dest:layer:') || Number(c.to.slice(11)) < layers));
  if (!get(musicStudio).sequencerPlaying) startSequencer();
}
