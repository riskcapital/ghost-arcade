/**
 * Chops on the FX pads: what the pads held is kept and put back, chopping
 * again does not lose it, and closing the studio puts every set's pads back
 * and lets the chops go. The looper's audio is stood in for.
 */
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MusicAudioEngine } from './audioEngine';
import type { BandLooper, LoopSlotId, LoopSlotInfo } from './bandLooper';
import { attachLooper, chopToPads, looperState, putBackPads, selectLoopSlot, stopLooper, toggleLoopPlay } from './looperRuntime';
import { musicStudio } from './musicStudioStore';
import { DEFAULT_FX_PADS } from './soundSlots';
import { soundById } from './sounds/library';
import { studioControl } from './studioControls';

const CHOPS = Array.from({ length: 8 }, (_, i) => `chop-${i + 1}`);

/** A looper with a loop in A (B empty) that records nothing. */
function fakeLooper() {
  const buffers: (AudioBuffer | null)[] = [{ length: 96000, sampleRate: 48000, duration: 2, numberOfChannels: 2 } as unknown as AudioBuffer, null];
  const playing = [false, false];
  const fake = {
    cleared: 0,
    setClock() {},
    setLevel() {},
    onChange: null,
    recording: null,
    now: () => 0,
    buffer: (id: LoopSlotId) => buffers[id],
    slotInfo: (id: LoopSlotId): LoopSlotInfo => ({ bars: buffers[id] ? 1 : 0, state: !buffers[id] ? 'empty' : playing[id] ? 'playing' : 'stopped', ownLength: false }),
    toggle: (id: LoopSlotId) => { playing[id] = !playing[id]; },
    kill: () => { playing.fill(false); },
    clear() { playing.fill(false); buffers.fill(null); this.cleared++; },
  };
  return fake;
}

let looper = fakeLooper();

beforeEach(() => {
  looper = fakeLooper();
  attachLooper({ bandLooper: () => looper as unknown as BandLooper } as unknown as MusicAudioEngine);
  // Reach the looper once, as any press does.
  toggleLoopPlay(0);
  toggleLoopPlay(0);
  musicStudio.setSet('dub');
  for (const [i, id] of DEFAULT_FX_PADS.dub.entries()) musicStudio.setFxPad(i, id);
});

const pads = () => { const s = get(musicStudio); return s.fxPads[s.set]; };

describe('chop to pads', () => {
  it('puts the chosen loop on the pads, or the other when it is empty', () => {
    selectLoopSlot(1);
    expect(chopToPads()).toBe(true);
    expect(pads()).toEqual(CHOPS);
    expect(soundById('chop-1')?.blurb).toContain('loop A');
    selectLoopSlot(0);
  });

  it('puts back what the pads held, after chopping twice and a pad changed meanwhile', () => {
    chopToPads();
    musicStudio.setFxPad(2, 'boing');
    chopToPads();
    expect(pads()).toEqual(CHOPS);
    putBackPads();
    expect(pads()).toEqual(DEFAULT_FX_PADS.dub.map((id, i) => (i === 2 ? 'boing' : id)));
  });

  it('says so when there is nothing to chop', () => {
    looper.clear();
    expect(chopToPads()).toBe(false);
    expect(get(looperState).error).toMatch(/Record a loop first/);
    expect(pads()).toEqual(DEFAULT_FX_PADS.dub);
  });

  it('puts every set back and lets the chops go when the studio closes', () => {
    chopToPads();
    musicStudio.setSet('berlin');
    chopToPads();
    expect(pads()).toEqual(CHOPS);
    stopLooper();
    const s = get(musicStudio);
    expect(s.fxPads.berlin).toEqual(DEFAULT_FX_PADS.berlin);
    expect(s.fxPads.dub).toEqual(DEFAULT_FX_PADS.dub);
    expect(soundById('chop-1')).toBeUndefined();
    expect(looper.cleared).toBe(1);
  });

  it('puts pads holding chops from a saved project back to the set defaults', () => {
    musicStudio.setFxPad(0, 'chop-4');
    putBackPads();
    expect(pads()).toEqual(DEFAULT_FX_PADS.dub);
  });

  it('answers MIDI as studio controls', () => {
    expect(studioControl('looper.record')?.kind).toBe('trigger');
    expect(studioControl('looper.play-a')?.kind).toBe('toggle');
    expect(studioControl('looper.chop')?.kind).toBe('trigger');
    studioControl('looper.chop')!.run(1);
    expect(pads()).toEqual(CHOPS);
    studioControl('looper.play-a')!.run(1);
    expect(get(looperState).slots[0].state).toBe('playing');
    stopLooper();
  });
});
