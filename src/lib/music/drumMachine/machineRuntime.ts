/**
 * The drum machine running: its own scheduler on the shared clock, so a beat
 * keeps playing whichever set is showing, the pads played live (screen,
 * letter keys, a pad controller), recording onto the part as it plays, and
 * each pad's level for patch cables.
 *
 * Hits go out as drum events with their pad, so the machine's kit sounds
 * them and visuals, cables and takes see a drum hit like any other.
 */

import { get, writable } from 'svelte/store';
import { launchClockPosition } from '../../stores/launchClock';
import { musicStudio } from '../musicStudioStore';
import { musicNow, sendMachineHit, setMachineHooks, setMachineSound } from '../musicRuntime';
import type { NoteSource } from '../noteEvents';
import type { DrumKit, DrumTweak } from '../tone/toneTypes';
import {
  STEPS_PER_BEAT, blockAt, normalizeBeat, partHitsBetween, partSteps, setStep, songBars, songHitsBetween, starterBeat,
  type Beat, type Part,
} from './machineBeat';
import { PAD_COUNT, machineKitById, padForNote, type MachineKit } from './machineKits';

const LOOKAHEAD_SECONDS = 0.12;
const TICK_MS = 25;
/** How long a pad's control signal takes to fall away after a hit. */
const PAD_FALL_MS = 180;

export type MachineMode = 'part' | 'song';

export interface MachineTransport {
  playing: boolean;
  /** Loop the selected part, or play the song timeline. */
  mode: MachineMode;
  /** The part being edited (and played, in part mode). */
  part: number;
  /** A part waiting for the next bar line. */
  queued: number | null;
  /** Pads played live go onto the part. */
  record: boolean;
  /** Only this pad plays, or null. */
  solo: number | null;
  /** Playhead: the step of the playing part, -1 when stopped. */
  step: number;
  /** In song mode, the bar of the song playing, and its block. */
  songBar: number;
  block: number;
}

export const machineTransport = writable<MachineTransport>({
  playing: false, mode: 'part', part: 0, queued: null, record: false, solo: null, step: -1, songBar: -1, block: -1,
});

/** The pads lit by a hit: pad -> when (ms), for the screen. */
export const machinePadFlash = writable<number[]>(new Array(PAD_COUNT).fill(0));

const padHitAt = new Float64Array(PAD_COUNT);
const padHitVel = new Float64Array(PAD_COUNT);

let origin = 0;
let scheduled = 0;
let queuedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Steps just played live and recorded: the scheduler does not play them again on this pass. */
const heardLive = new Set<string>();

// ── Sound ───────────────────────────────────────────────────────────────

function drumKitFor(kit: MachineKit): DrumKit {
  return { id: kit.id, name: kit.name, blurb: kit.blurb, sounds: kit.pads.map((p) => p.sound), fx: kit.fx, gain: kit.gain };
}

let soundKey = '';
function syncSound(beat: Beat): void {
  const key = `${beat.kitId}|${beat.padLevel.join(',')}|${beat.padTune.join(',')}`;
  if (key === soundKey) return;
  soundKey = key;
  const kit = machineKitById(beat.kitId);
  const tweaks: DrumTweak[] = kit.pads.map((_, i) => ({
    tune: beat.padTune[i] ?? 0.5,
    level: (beat.padLevel[i] ?? 0.5) * 2,
    decay: 0.5,
    tone: 0.5,
    drive: 0.5,
  }));
  setMachineSound(drumKitFor(kit), tweaks);
}

let started = false;
/** Set up once: the kit follows the beat, and the runtime can reach the pads. */
export function ensureMachine(): void {
  if (started) return;
  started = true;
  musicStudio.subscribe((s) => syncSound(s.machine));
  setMachineHooks({
    midiPad(note, velocity, on) {
      const pad = padForNote(note);
      if (pad < 0) return false;
      if (on) playPad(pad, velocity, 'midi');
      return true;
    },
    padLevel,
    stop: stopMachine,
  });
}

// ── The beat ────────────────────────────────────────────────────────────

export function currentBeat(): Beat {
  return get(musicStudio).machine;
}

export function editBeat(fn: (b: Beat) => Beat): void {
  musicStudio.setMachine(fn(currentBeat()));
}

/** Change the part being edited. */
export function editPart(fn: (p: Part) => Part, index = get(machineTransport).part): void {
  editBeat((b) => ({ ...b, parts: b.parts.map((p, i) => (i === index ? fn(p) : p)) }));
}

export function loadBeat(beat: Beat): void {
  const b = normalizeBeat(JSON.parse(JSON.stringify(beat)), beat.kitId);
  musicStudio.setMachine(b);
  machineTransport.update((t) => ({ ...t, part: 0, queued: null }));
}

export function newBeat(): void {
  loadBeat(starterBeat(currentBeat().kitId));
}

/** Pick a part: straight away when stopped, on the next bar while it plays. */
export function selectPart(index: number): void {
  const t = get(machineTransport);
  const count = currentBeat().parts.length;
  if (index < 0 || index >= count) return;
  if (!t.playing || t.mode === 'song') {
    machineTransport.update((x) => ({ ...x, part: index, queued: null }));
    return;
  }
  if (index === t.part) {
    machineTransport.update((x) => ({ ...x, queued: null }));
    return;
  }
  const { beat } = launchClockPosition();
  queuedAt = origin + Math.ceil((beat - origin + 0.01) / 4) * 4;
  machineTransport.update((x) => ({ ...x, queued: index }));
}

// ── Transport ───────────────────────────────────────────────────────────

export function setMachineMode(mode: MachineMode): void {
  const t = get(machineTransport);
  if (t.mode === mode) return;
  machineTransport.update((x) => ({ ...x, mode, queued: null }));
  if (t.playing) {
    stopMachine();
    startMachine();
  }
}

export function startMachine(): void {
  ensureMachine();
  if (get(machineTransport).playing) return;
  musicNow();
  const { beat } = launchClockPosition();
  const others = get(musicStudio).sequencerPlaying || Object.values(get(musicStudio).playingLoops).some(Boolean);
  // With other music playing, come in on its next bar; alone, on the next beat.
  origin = others ? Math.ceil(beat / 4 - 0.02) * 4 : Math.ceil(beat - 0.05);
  scheduled = beat;
  heardLive.clear();
  machineTransport.update((x) => ({ ...x, playing: true, queued: null }));
  timer ??= setInterval(tick, TICK_MS);
  tick();
}

export function stopMachine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  machineTransport.update((x) => ({ ...x, playing: false, queued: null, step: -1, songBar: -1, block: -1 }));
}

export function toggleMachine(): void {
  if (get(machineTransport).playing) stopMachine();
  else startMachine();
}

function tick(): void {
  const t = get(machineTransport);
  if (!t.playing) return;
  const beatState = currentBeat();
  const kit = machineKitById(beatState.kitId);
  const now = musicNow();
  const { beat, beatMs } = launchClockPosition();
  // A clock jump (a resync, a new tempo detected) skips ahead rather than firing every step between.
  if (beat - scheduled > 1 || scheduled - beat > 2) scheduled = beat;
  const horizon = beat + (LOOKAHEAD_SECONDS * 1000) / beatMs;
  const timeAt = (b: number) => Math.max(now, now + ((b - beat) * beatMs) / 1000);
  const send = (from: number, to: number, part: Part | null, partOrigin: number) => {
    const hits = part ? partHitsBetween(part, partOrigin, from, to, t.solo) : songHitsBetween(beatState, origin, from, to);
    for (const h of hits) {
      if (t.solo !== null && h.pad !== t.solo) continue;
      if (heardLive.delete(`${h.pad}:${Math.round(h.beat * STEPS_PER_BEAT)}`)) continue;
      const time = timeAt(h.beat);
      sendMachineHit(h.pad, kit.pads[h.pad]?.role ?? 'kick', h.velocity, 'sequencer', time);
      markHit(h.pad, h.velocity, (time - now) * 1000);
    }
  };
  if (horizon > scheduled) {
    if (t.mode === 'song') {
      if (beatState.song.length) send(scheduled, horizon, null, origin);
    } else {
      let from = scheduled;
      let partIndex = Math.min(t.part, beatState.parts.length - 1);
      if (t.queued !== null && horizon > queuedAt) {
        send(from, Math.max(from, queuedAt), beatState.parts[partIndex], origin);
        from = Math.max(from, queuedAt);
        origin = queuedAt;
        partIndex = t.queued;
        machineTransport.update((x) => ({ ...x, part: partIndex, queued: null }));
      }
      const part = beatState.parts[partIndex];
      if (part) send(from, horizon, part, origin);
    }
    scheduled = horizon;
  }
  updatePlayhead(beat);
}

function updatePlayhead(beat: number): void {
  const t = get(machineTransport);
  const b = currentBeat();
  let step = -1;
  let songBar = -1;
  let block = -1;
  if (beat >= origin) {
    if (t.mode === 'song') {
      const total = songBars(b.song);
      if (total) {
        songBar = Math.floor((beat - origin) / 4) % total;
        const at = blockAt(b.song, songBar);
        if (at) {
          block = at.index;
          const part = b.parts.find((p) => p.id === b.song[at.index].partId);
          const startBeat = origin + Math.floor((beat - origin) / (total * 4)) * total * 4 + at.startBar * 4;
          if (part) step = Math.floor((beat - startBeat) * STEPS_PER_BEAT) % partSteps(part);
        }
      }
    } else {
      const part = b.parts[t.part];
      if (part) step = Math.floor((beat - origin) * STEPS_PER_BEAT) % partSteps(part);
    }
  }
  if (step !== t.step || songBar !== t.songBar || block !== t.block) machineTransport.update((x) => ({ ...x, step, songBar, block }));
}

// ── Playing the pads ────────────────────────────────────────────────────

function markHit(pad: number, velocity: number, delayMs = 0): void {
  const apply = () => {
    padHitAt[pad] = performance.now();
    padHitVel[pad] = velocity;
    machinePadFlash.update((f) => {
      const next = [...f];
      next[pad] = performance.now();
      return next;
    });
  };
  if (delayMs > 4) setTimeout(apply, delayMs);
  else apply();
}

/** A pad played now. While recording, it also goes onto the part on its nearest step. */
export function playPad(pad: number, velocity: number, source: NoteSource = 'screen'): void {
  ensureMachine();
  if (pad < 0 || pad >= PAD_COUNT) return;
  const b = currentBeat();
  const kit = machineKitById(b.kitId);
  const v = Math.max(0.05, Math.min(1, velocity));
  sendMachineHit(pad, kit.pads[pad].role, v, source);
  markHit(pad, v);
  const t = get(machineTransport);
  if (!t.record || !t.playing) return;
  const { beat } = launchClockPosition();
  const g = Math.round((beat - origin) * STEPS_PER_BEAT);
  if (g < 0) return;
  let partIndex = t.part;
  let gInPart = g;
  if (t.mode === 'song') {
    const total = songBars(b.song);
    if (!total) return;
    const bar = Math.floor(g / 16) % total;
    const at = blockAt(b.song, bar);
    if (!at) return;
    partIndex = b.parts.findIndex((p) => p.id === b.song[at.index].partId);
    gInPart = g - (Math.floor(g / (total * 16)) * total * 16 + at.startBar * 16);
  }
  const part = b.parts[partIndex];
  if (!part) return;
  const track = part.tracks[pad];
  const step = gInPart % track.length;
  editPart((p) => setStep(p, pad, step, { vel: v }), partIndex);
  // Hit a little early: the step has not been played yet, and should not sound twice.
  if (g / STEPS_PER_BEAT + origin >= scheduled) heardLive.add(`${pad}:${Math.round(g + origin * STEPS_PER_BEAT)}`);
}

/** A pad's control signal: up on each hit by its velocity, falling away after. "pad.any" is the loudest. */
export function padLevel(name: string): number {
  const now = performance.now();
  const level = (i: number) => (padHitAt[i] ? padHitVel[i] * Math.exp(-(now - padHitAt[i]) / PAD_FALL_MS) : 0);
  if (name === 'pad.any') {
    let max = 0;
    for (let i = 0; i < PAD_COUNT; i++) max = Math.max(max, level(i));
    return max;
  }
  const i = Number(name.slice(4));
  return Number.isInteger(i) && i >= 0 && i < PAD_COUNT ? level(i) : 0;
}

// ── Saved beats ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'ghostarcade-drum-beats';

export interface SavedBeat {
  id: string;
  name: string;
  beat: Beat;
}

function loadSaved(): SavedBeat[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string').map((x) => ({ id: x.id, name: x.name, beat: normalizeBeat(x.beat, 'mk.boom-box') }))
      : [];
  } catch {
    return [];
  }
}

/** Beats saved on this computer, offered in every project. */
export const savedBeats = writable<SavedBeat[]>(typeof localStorage === 'undefined' ? [] : loadSaved());

savedBeats.subscribe((list) => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { /* storage full or blocked: the beats last the session */ }
});

export function saveBeatAs(name: string): void {
  const trimmed = name.trim().slice(0, 60) || 'Beat';
  const beat = { ...JSON.parse(JSON.stringify(currentBeat())), name: trimmed } as Beat;
  musicStudio.setMachine(beat);
  savedBeats.update((list) => {
    const existing = list.find((x) => x.name === trimmed);
    if (existing) return list.map((x) => (x === existing ? { ...x, beat } : x));
    return [...list, { id: `beat-${Date.now().toString(36)}`, name: trimmed, beat }];
  });
}

export function deleteSavedBeat(id: string): void {
  savedBeats.update((list) => list.filter((x) => x.id !== id));
}
