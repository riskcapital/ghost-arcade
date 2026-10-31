/**
 * The studio's controls for MIDI, and the band's keys.
 *
 * Registered here, at the runtime's level rather than in a panel, so a
 * controller plays them while the Studio view is hidden (the performer on
 * the VJ deck): the band's throw, wash, freeze and key listening, the band
 * effect knobs, the FX pads and bowls, and the looks on each visual voice.
 * Each is `studio:<id>` to the MIDI router (studioControls.ts).
 *
 * Knobs and faders are written once a frame at most, whatever the
 * controller sends. Like every controller move, none of it is an undo step.
 *
 * The band's keys (an input set to "Band keys" in Settings > MIDI) play
 * into the visuals through bandKeys.ts.
 */

import { get } from 'svelte/store';
import { onBandKeys } from '../midi/midiInputs';
import { midiStore } from '../midi/midiStore';
import { runAsLiveControl } from '../stores/historyHooks';
import { BandKeys } from './bandKeys';
import {
  bandState,
  duckUnderKick,
  hearBassNote,
  killAll,
  listenForKey,
  playAll,
  playNote,
  prepareBand,
  pushOutsideNote,
  releaseBowl,
  releaseNote,
  setBandThrow,
  setBandWash,
  startLiveInput,
  stopAll,
  stopLiveInput,
  strikeBowl,
  toggleFreeze,
  triggerShot,
} from './musicRuntime';
import { musicStudio, type MusicStudioState } from './musicStudioStore';
import { DUCK_RELEASE_MAX, DUCK_RELEASE_MIN, type BandFxSettings } from './soundSlots';
import { MAX_LIVE_INPUTS, type LiveInputSettings } from './mixer';
import { registerStudioControls, releaseStudioControls, type StudioControl } from './studioControls';
import { MAX_STUDIO_VOICES } from './studioPlugin';
import { STUDIO_SETS } from './studioSets';
import { editStudio, loadSceneIntoStudio, replaceStudioVoice, setStudioVoice, studioTargetNow } from './studioTarget';
import { VOICE_SHADERS, scenesForSet } from './visualScenes';
import { VOICE_SOURCES, type VoiceSourceId } from './visualVoices';

const FX_PADS = 8;
const BOWLS = 5;

const studioOpen = () => get(musicStudio).isOpen;
/** A pad's velocity, never so soft it cannot be heard. */
const hit = (v: number) => Math.max(0.15, Math.min(1, v));

// ── Knobs, once a frame ─────────────────────────────────────────────────

let bandPatch: Partial<BandFxSettings> | null = null;
const pendingLevels = new Map<number, number>();
const pendingInputs = new Map<number, Partial<LiveInputSettings>>();
let frame: number | null = null;
let fallback: ReturnType<typeof setTimeout> | null = null;

function queueFlush(): void {
  if (fallback !== null) return;
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(flush);
  // Frames pause while the window is hidden; the timer keeps the knobs working.
  fallback = setTimeout(flush, 50);
}

function flush(): void {
  if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  frame = null;
  if (fallback !== null) clearTimeout(fallback);
  fallback = null;
  const patch = bandPatch;
  bandPatch = null;
  const levels = pendingLevels.size ? new Map(pendingLevels) : null;
  pendingLevels.clear();
  const inputs = pendingInputs.size ? new Map(pendingInputs) : null;
  pendingInputs.clear();
  runAsLiveControl(() => {
    if (patch) musicStudio.setBandFx(patch);
    if (inputs) for (const [index, change] of inputs) musicStudio.setLiveInput(index, change);
    if (levels) {
      const only = levels.size === 1 ? [...levels.keys()][0] : null;
      editStudio(
        (s) => ({ ...s, musicVoices: s.musicVoices.map((v, i) => (levels.has(i) ? { ...v, level: levels.get(i)! } : v)) }),
        only !== null ? `voice:${only}:level` : 'voice:levels',
      );
    }
  });
}

function queueBandFx(patch: Partial<BandFxSettings>): void {
  bandPatch = { ...bandPatch, ...patch };
  queueFlush();
}

function queueInput(index: number, patch: Partial<LiveInputSettings>): void {
  pendingInputs.set(index, { ...pendingInputs.get(index), ...patch });
  queueFlush();
}

function queueVoiceLevel(index: number, level: number): void {
  pendingLevels.set(index, Math.max(0, Math.min(1, level)));
  queueFlush();
}

// ── The looks on each voice ─────────────────────────────────────────────

/** Every voice look in the order the voice picker lists them: by set, then as listed. */
const LOOK_ORDER: readonly string[] = STUDIO_SETS.flatMap((set) => VOICE_SHADERS.filter((v) => v.family === set.id).map((v) => v.file));

/** The look after (or before) `file` in the picker, going round. */
export function nextVoiceLook(file: string, step: 1 | -1): string {
  const i = LOOK_ORDER.indexOf(file);
  if (i < 0) return LOOK_ORDER[step > 0 ? 0 : LOOK_ORDER.length - 1];
  return LOOK_ORDER[(i + step + LOOK_ORDER.length) % LOOK_ORDER.length];
}

/** Give a voice the next (or previous) look. False when there is no such voice. */
export function stepVoiceLook(index: number, step: 1 | -1): boolean {
  const voice = studioTargetNow()?.source.musicVoices[index];
  return !!voice && replaceStudioVoice(index, nextVoiceLook(voice.file, step));
}

/** The sound after `source` in the list, going round. */
export function nextVoiceSource(source: string): VoiceSourceId {
  const i = VOICE_SOURCES.findIndex((s) => s.id === source);
  return VOICE_SOURCES[(i + 1) % VOICE_SOURCES.length].id;
}

/** Levels voices had before they were muted, by voice. */
const mutedLevels = new Map<number, number>();

/** The level a mute toggle gives a voice at `level`: 0, or back to where it was. */
export function toggledVoiceLevel(index: number, level: number): number {
  if (level > 0) {
    mutedLevels.set(index, level);
    return 0;
  }
  const back = mutedLevels.get(index) ?? 1;
  mutedLevels.delete(index);
  return back;
}

/** Load the set's next (or previous) visual scene, the way the scene menu does. */
export function stepVisualScene(step: 1 | -1): boolean {
  const set = get(musicStudio).set;
  const scenes = scenesForSet(set);
  if (!scenes.length) return false;
  const current = studioTargetNow()?.source.musicSceneId ?? null;
  const i = scenes.findIndex((sc) => sc.id === current);
  const next = i < 0 ? scenes[step > 0 ? 0 : scenes.length - 1] : scenes[(i + step + scenes.length) % scenes.length];
  return loadSceneIntoStudio({ ...next, set });
}

// ── Transport ───────────────────────────────────────────────────────────

/** Whether the studio is playing, as its Play button sees it. */
function studioPlaying(s: MusicStudioState): boolean {
  return s.sequencerPlaying || Object.keys(s.playingLoops).length > 0 || Object.keys(s.queuedLoops).length > 0 || !!s.playingTakeId;
}

function togglePlay(): void {
  const s = get(musicStudio);
  if (s.liveControl) {
    // Ableton Live in control: its transport, as the studio's Play button does.
    void import('../ableton/abletonBridge').then(({ abletonBridge }) => {
      if (get(abletonBridge).playing) abletonBridge.stop();
      else abletonBridge.play();
    });
    return;
  }
  if (studioPlaying(s)) stopAll();
  else if (s.isOpen) playAll();
}

// ── The controls ────────────────────────────────────────────────────────

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The note each bowl is sounding from a controller, so its release lets it go. */
const bowlNotes: (number | null)[] = range(BOWLS).map(() => null);

function playBowl(index: number, v: number): void {
  const note = bowlNotes[index];
  if (note !== null) releaseBowl(note);
  bowlNotes[index] = v > 0 && studioOpen() ? strikeBowl(index, hit(v)) : null;
}

// The router runs these as live control: nothing they change is an undo step.
const BAND: StudioControl[] = [
  // A press with the studio closed does nothing; a release always lets go.
  { id: 'band.throw', label: 'Echo throw', group: 'Band', kind: 'hold', run: (v) => { if (v === 0 || studioOpen()) setBandThrow(v > 0); } },
  { id: 'band.wash', label: 'Reverb wash', group: 'Band', kind: 'hold', run: (v) => { if (v === 0 || studioOpen()) setBandWash(v > 0); } },
  { id: 'band.freeze', label: 'Freeze the band', group: 'Band', kind: 'toggle', run: () => { if (studioOpen() || get(bandState).frozen) void toggleFreeze(); } },
  { id: 'band.listen', label: "Listen for the band's key", group: 'Band', kind: 'toggle', run: () => listenForKey(!get(bandState).listening) },
  { id: 'band.echo-send', label: 'Echo send', group: 'Band', kind: 'value', run: (v) => queueBandFx({ echoSend: v }) },
  { id: 'band.verb-send', label: 'Reverb send', group: 'Band', kind: 'value', run: (v) => queueBandFx({ verbSend: v }) },
  { id: 'band.return', label: 'Band effects return', group: 'Band', kind: 'value', run: (v) => queueBandFx({ returnLevel: v }) },
  {
    id: 'band.inputs', label: 'Listen to the band inputs', group: 'Band', kind: 'toggle',
    run: () => { if (get(musicStudio).inputOn) stopLiveInput(); else if (studioOpen()) void startLiveInput(); },
  },
  { id: 'band.duck', label: "Duck under the band's kick", group: 'Band', kind: 'value', run: (v) => queueBandFx({ duckDepth: v }) },
  { id: 'band.duck-release', label: 'Duck release', group: 'Band', kind: 'value', run: (v) => queueBandFx({ duckRelease: DUCK_RELEASE_MIN + v * (DUCK_RELEASE_MAX - DUCK_RELEASE_MIN) }) },
  {
    id: 'band.follow-bass', label: "Drone follows the band's bass", group: 'Band', kind: 'toggle',
    run: () => runAsLiveControl(() => musicStudio.setBandFx({ followBass: !get(musicStudio).bandFx.followBass })),
  },
  ...range(MAX_LIVE_INPUTS).flatMap((i): StudioControl[] => [
    { id: `input.${i + 1}.level`, label: `Band input ${i + 1} level`, group: 'Band', kind: 'value', run: (v) => queueInput(i, { volume: v }) },
    { id: `input.${i + 1}.fx-send`, label: `Band input ${i + 1} effects send`, group: 'Band', kind: 'value', run: (v) => queueInput(i, { fxSend: v }) },
  ]),
];

const PADS: StudioControl[] = range(FX_PADS).map((i) => ({
  id: `pad.${i + 1}`, label: `FX pad ${i + 1}`, group: 'Pads', kind: 'trigger',
  run: (v) => { if (studioOpen()) triggerShot(i, hit(v)); },
}));

// Struck on the press with its velocity and let go on the release, like the bowls on screen.
const BOWL_CONTROLS: StudioControl[] = range(BOWLS).map((i) => ({
  id: `bowl.${i + 1}`, label: `Bowl ${i + 1}`, group: 'Bowls', kind: 'hold', run: (v) => playBowl(i, v),
}));

const voiceAt = (index: number) => studioTargetNow()?.source.musicVoices[index];

const VOICES: StudioControl[] = range(MAX_STUDIO_VOICES).flatMap((i): StudioControl[] => {
  const n = i + 1;
  return [
    { id: `voice.${n}.level`, label: `Voice ${n} level`, group: 'Visuals', kind: 'value', run: (v) => queueVoiceLevel(i, v) },
    { id: `voice.${n}.look-next`, label: `Voice ${n} next look`, group: 'Visuals', kind: 'trigger', run: () => void stepVoiceLook(i, 1) },
    { id: `voice.${n}.look-prev`, label: `Voice ${n} previous look`, group: 'Visuals', kind: 'trigger', run: () => void stepVoiceLook(i, -1) },
    {
      id: `voice.${n}.mute`, label: `Voice ${n} mute`, group: 'Visuals', kind: 'toggle',
      run: () => {
        const voice = voiceAt(i);
        if (voice) queueVoiceLevel(i, toggledVoiceLevel(i, pendingLevels.get(i) ?? voice.level));
      },
    },
    {
      id: `voice.${n}.follow-next`, label: `Voice ${n} next sound to follow`, group: 'Visuals', kind: 'trigger',
      run: () => {
        const voice = voiceAt(i);
        if (voice) setStudioVoice(i, { source: nextVoiceSource(voice.source) });
      },
    },
  ];
});

const SCENES: StudioControl[] = [
  { id: 'visuals.scene-next', label: 'Next visual scene', group: 'Visuals', kind: 'trigger', run: () => void stepVisualScene(1) },
  { id: 'visuals.scene-prev', label: 'Previous visual scene', group: 'Visuals', kind: 'trigger', run: () => void stepVisualScene(-1) },
];

const STUDIO: StudioControl[] = [
  {
    id: 'studio.kill', label: 'Kill all sound', group: 'Studio', kind: 'trigger',
    run: () => {
      killAll();
      // Held throws, washes and bowls let go too.
      releaseStudioControls();
    },
  },
  { id: 'studio.play', label: 'Play or stop the studio', group: 'Studio', kind: 'toggle', run: togglePlay },
];

/** Every control this module registers, in the order the learn list shows them. */
export const STUDIO_MIDI_CONTROLS: readonly StudioControl[] = [...BAND, ...PADS, ...BOWL_CONTROLS, ...VOICES, ...SCENES, ...STUDIO];

registerStudioControls(STUDIO_MIDI_CONTROLS);

// ── The band's keys ─────────────────────────────────────────────────────

const bandKeys = new BandKeys({
  visual: (type, note, velocity, role, pitched) => pushOutsideNote(type, note, velocity, role, 0, pitched),
  play: (instrument, note, velocity) => playNote(instrument, note, velocity, 'midi'),
  release: (instrument, note) => releaseNote(instrument, note, 'midi'),
  picked: () => get(musicStudio).instrument,
  canPlay: studioOpen,
  // A kick from the band dips the studio under it; a bass note can move the drone.
  kick: (velocity) => duckUnderKick(velocity),
  bass: (note, velocity) => hearBassNote(note, velocity),
});

onBandKeys({
  message: (data, setup) => bandKeys.message(data, setup),
  release: (name) => bandKeys.release(name),
});

const FREEZE_PATH = 'studio:band.freeze';

// Closing the studio stops its sound: what the band's keys and the bowls
// hold lets go. Opening it with a freeze on a controller starts keeping the
// band's last moment (the Band tab does that when it shows), so the first
// freeze has one.
let wasOpen: boolean | null = null;
musicStudio.subscribe((s) => {
  if (wasOpen && !s.isOpen) {
    bandKeys.releaseAll();
    bowlNotes.fill(null);
  }
  // Not on the first call: this runs while the runtime itself is loading.
  if (wasOpen === false && s.isOpen && get(midiStore).mappings.some((m) => m.path.trim().toLowerCase() === FREEZE_PATH)) prepareBand();
  wasOpen = s.isOpen;
});
