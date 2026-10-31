import { describe, expect, it } from 'vitest';
import { BandKeys, bandKeysInstrument, drumRoleForNote, type BandKeysOut } from './bandKeys';
import type { MidiInputSetup } from '../midi/midiTypes';
import type { InstrumentId } from './noteEvents';

function harness(open = true) {
  const log: string[] = [];
  const out: BandKeysOut = {
    visual: (type, note, velocity, role, pitched) => log.push(`visual ${type} ${note} ${role}${type === 'on' ? ` ${velocity.toFixed(2)}${pitched ? ' pitched' : ''}` : ''}`),
    play: (instrument, note) => log.push(`play ${instrument} ${note}`),
    release: (instrument, note) => log.push(`release ${instrument} ${note}`),
    picked: () => 'keys' as InstrumentId,
    canPlay: () => open,
    kick: (velocity) => log.push(`kick ${velocity.toFixed(2)}`),
    bass: (note) => log.push(`bass ${note}`),
  };
  return { log, keys: new BandKeys(out) };
}

const nord: MidiInputSetup = { name: 'Nord', use: 'keys' };
const on = (channel: number, note: number, velocity = 127) => [0x90 | channel, note, velocity];
const off = (channel: number, note: number) => [0x80 | channel, note, 0];

describe("the band's keys", () => {
  it('play into the visuals as the chords unless set to another sound, telling the key', () => {
    const { log, keys } = harness();
    keys.message(on(0, 60), nord);
    keys.message(off(0, 60), nord);
    keys.message(on(0, 64, 64), { ...nord, role: 'lead' });
    expect(log).toEqual(['visual on 60 chords 1.00 pitched', 'visual off 60 chords', 'visual on 64 lead 0.50 pitched']);
  });

  it('send channel 10 to the drum sounds, and a kick ducks the studio', () => {
    expect([35, 36, 38, 40, 42, 44, 46, 49, 45].map(drumRoleForNote)).toEqual(['kick', 'kick', 'snare', 'snare', 'hats', 'hats', 'hats', 'perc', 'perc']);
    const { log, keys } = harness();
    keys.message(on(9, 36, 100), nord);
    keys.message(on(9, 42), nord);
    keys.message(off(9, 36), nord);
    expect(log).toEqual(['visual on 36 kick 0.79', 'kick 0.79', 'visual on 42 hats 1.00']);
  });

  it('tell the bass follower about the bass', () => {
    const { log, keys } = harness();
    keys.message(on(0, 40), { ...nord, role: 'bass' });
    expect(log).toContain('bass 40');
  });

  it('play the studio when asked, while it is open', () => {
    const { log, keys } = harness();
    const playing = { ...nord, play: true };
    keys.message(on(0, 60), playing);
    keys.message(off(0, 60), playing);
    keys.message(on(0, 62), { ...playing, instrument: 'drone' });
    keys.message(on(9, 38), playing);
    expect(log.filter((l) => !l.startsWith('visual'))).toEqual(['play keys 60', 'release keys 60', 'play drone 62', 'play drums 38']);
    expect(bandKeysInstrument({ instrument: 'nope' }, 0, 'synth')).toBe('synth');

    const closed = harness(false);
    closed.keys.message(on(0, 60), playing);
    expect(closed.log).toEqual(['visual on 60 chords 1.00 pitched']);
  });

  it('hold notes under the sustain pedal and let go when it lifts', () => {
    const { log, keys } = harness();
    keys.message([0xb0, 64, 127], nord);
    keys.message(on(0, 60), nord);
    keys.message(off(0, 60), nord);
    expect(log).toEqual(['visual on 60 chords 1.00 pitched']);
    keys.message([0xb0, 64, 0], nord);
    expect(log).toEqual(['visual on 60 chords 1.00 pitched', 'visual off 60 chords']);
  });

  it('let go of everything an input holds when it goes away, with the sound it started with', () => {
    const { log, keys } = harness();
    keys.message(on(0, 60), { ...nord, play: true });
    keys.message(on(0, 67), { ...nord, play: true });
    keys.release('Nord');
    expect(keys.soundingCount()).toBe(0);
    expect(log.slice(-4)).toEqual(['visual off 60 chords', 'release keys 60', 'visual off 67 chords', 'release keys 67']);
  });
});
