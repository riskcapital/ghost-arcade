/**
 * The band's dub moves, seen in the visuals.
 *
 * While the band is thrown into the echo, the voices following the shots
 * and effects (and everything) light up and flash on every repeat; let go,
 * and the repeats keep flashing in time with the echo, fading as it fades.
 * A wash swells them while held. A freeze holds the pads and textures up
 * until it is let go.
 *
 * It plays notes into the visual voices like any note from outside the
 * studio, so every voice already knows what to do with them. A timer runs
 * only while a throw is held or its repeats are still fading.
 */

import { get } from 'svelte/store';
import { launchClockTempo } from '../stores/launchClock';
import { musicStudio } from './musicStudioStore';
import { ECHO_TIMES } from './soundSlots';
import type { VoiceSourceId } from './visualVoices';

/** A note for the visual voices (never a pitch for the band's key). */
export type BandFxNote = (type: 'on' | 'off', note: number, velocity: number, role: VoiceSourceId, delaySeconds: number) => void;

export interface BandFxTiming {
  /** Seconds between the echo's repeats, and how much of each comes back (0-1). */
  echo(): { period: number; feedback: number };
  /** The studio's key, 0-11, so the notes sit in it. */
  root(): number;
}

/** The band's echo as the studio has it set, in time with the launch clock. */
export const studioEchoTiming: BandFxTiming = {
  echo() {
    const fx = get(musicStudio).bandFx;
    const beats = ECHO_TIMES.find((t) => t.id === fx.echoTime)?.beats ?? 0.75;
    const tempo = launchClockTempo();
    const period = (beats * 60) / (Number.isFinite(tempo) && tempo > 0 ? tempo : 120);
    return { period: Math.max(0.05, Math.min(4, period)), feedback: Math.max(0, Math.min(0.95, fx.feedback)) };
  },
  root: () => get(musicStudio).key.root,
};

/** Notes high up in the key, so they rarely meet a note the band plays. */
const THROW = 84;
const REPEAT = 96;
const WASH = 91;
const FREEZE = 72;
/** Repeats fade out below this. */
const REPEAT_FLOOR = 0.06;
const MAX_REPEATS = 24;
const FLASH_SECONDS = 0.12;

export class BandFxVisuals {
  private throwNote: number | null = null;
  private washNote: number | null = null;
  private freezeNote: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The next repeat after a throw: its strength (0: none), note and how many are left. */
  private repeat = 0;
  private repeatNote = 0;
  private repeatsLeft = 0;

  constructor(private out: BandFxNote, private timing: BandFxTiming = studioEchoTiming) {}

  /** The band thrown into the echo (held), or let go. */
  throw(on: boolean): void {
    if (on) {
      if (this.throwNote !== null) return;
      this.repeat = 0;
      this.throwNote = this.inKey(THROW);
      this.out('on', this.throwNote, 1, 'fx', 0);
      this.schedule();
      return;
    }
    if (this.throwNote === null) return;
    this.out('off', this.throwNote, 0, 'fx', 0);
    this.throwNote = null;
    this.repeat = this.timing.echo().feedback;
    this.repeatNote = this.inKey(REPEAT);
    this.repeatsLeft = MAX_REPEATS;
    this.schedule();
  }

  /** The band washed into the reverb (held), or let go. */
  wash(on: boolean): void {
    if (on === (this.washNote !== null)) return;
    if (on) {
      this.washNote = this.inKey(WASH);
      this.out('on', this.washNote, 0.85, 'fx', 0);
    } else {
      this.out('off', this.washNote!, 0, 'fx', 0);
      this.washNote = null;
    }
  }

  /** A moment of the band frozen as a texture, or let go. */
  freeze(on: boolean): void {
    if (on === (this.freezeNote !== null)) return;
    if (on) {
      this.freezeNote = this.inKey(FREEZE);
      this.out('on', this.freezeNote, 0.9, 'pad', 0);
    } else {
      this.out('off', this.freezeNote!, 0, 'pad', 0);
      this.freezeNote = null;
    }
  }

  /** Let go of everything now, repeats included (the studio closed, the kill switch). */
  releaseAll(): void {
    this.throw(false);
    this.wash(false);
    this.freeze(false);
    this.repeat = 0;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Whether a timer is running, for tests. */
  get busy(): boolean {
    return this.timer !== null;
  }

  private inKey(base: number): number {
    return Math.min(127, base + (((Math.round(this.timing.root()) % 12) + 12) % 12));
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(this.tick, this.timing.echo().period * 1000);
  }

  private readonly tick = (): void => {
    this.timer = null;
    // Held: flash on every repeat (the note is struck again and stays held).
    if (this.throwNote !== null) {
      this.out('on', this.throwNote, 1, 'fx', 0);
      this.schedule();
      return;
    }
    if (this.repeat < REPEAT_FLOOR || this.repeatsLeft <= 0) {
      this.repeat = 0;
      return;
    }
    const { period, feedback } = this.timing.echo();
    this.out('on', this.repeatNote, this.repeat, 'fx', 0);
    this.out('off', this.repeatNote, 0, 'fx', Math.min(FLASH_SECONDS, period / 2));
    this.repeat *= feedback;
    this.repeatsLeft--;
    this.schedule();
  };
}
