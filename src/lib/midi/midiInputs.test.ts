import { describe, expect, it } from 'vitest';
import { mappingHearsDevice, resolveMidiInputs } from './midiInputs';
import type { MidiDevice, MidiInputSetup } from './midiTypes';

const device = (id: string, name: string, state: MidiDevice['state'] = 'connected'): MidiDevice => ({ id, name, manufacturer: 'Test', state });

describe('which MIDI inputs are in use', () => {
  const pads = device('a', 'Launch Control');
  const knobs = device('b', 'Twister');
  const keys = device('c', 'Nord Stage');

  it('listens to every controller at once, and the band keys apart', () => {
    const setups: MidiInputSetup[] = [
      { name: 'Launch Control', use: 'control' },
      { name: 'Twister', use: 'control' },
      { name: 'Nord Stage', use: 'keys' },
    ];
    const plan = resolveMidiInputs([pads, knobs, keys], setups, 'b');
    expect(plan.control).toEqual(['a', 'b']);
    expect(plan.keys).toEqual(['c']);
    expect(plan.controlNames).toEqual(['Launch Control', 'Twister']);
    // The input picked before several could be stays the first.
    expect(plan.primary).toBe('b');
    expect(plan.standIn).toBe(null);
  });

  it('keeps the old single choice as a controller before it has a saved use', () => {
    const plan = resolveMidiInputs([pads, knobs], [], 'b');
    expect(plan.control).toEqual(['b']);
    expect(plan.primary).toBe('b');
  });

  it('borrows an input nobody has given a use while no controller is plugged in', () => {
    const setups: MidiInputSetup[] = [{ name: 'Launch Control', use: 'control' }, { name: 'Nord Stage', use: 'keys' }];
    const plan = resolveMidiInputs([device('a', 'Launch Control', 'disconnected'), keys, knobs], setups, 'a');
    expect(plan.standIn).toBe('b');
    expect(plan.control).toEqual(['b']);
    expect(plan.keys).toEqual(['c']);
  });

  it('never borrows an input set to off or to band keys', () => {
    const setups: MidiInputSetup[] = [{ name: 'Twister', use: 'off' }, { name: 'Nord Stage', use: 'keys' }];
    const plan = resolveMidiInputs([knobs, keys], setups, null);
    expect(plan.control).toEqual([]);
    expect(plan.primary).toBe(null);
  });

  it('turning the old choice off takes it out of use', () => {
    const plan = resolveMidiInputs([pads], [{ name: 'Launch Control', use: 'off' }], 'a');
    expect(plan.control).toEqual([]);
  });
});

describe('mappings and the input they were learned on', () => {
  it('answers only that input while it is in use', () => {
    const learned = { device: 'Launch Control' };
    const inUse = ['Launch Control', 'Twister'];
    expect(mappingHearsDevice(learned, 'Launch Control', inUse)).toBe(true);
    expect(mappingHearsDevice(learned, 'Twister', inUse)).toBe(false);
  });

  it('answers any controller while that input is away, and old mappings answer any', () => {
    expect(mappingHearsDevice({ device: 'Launch Control' }, 'Twister', ['Twister'])).toBe(true);
    expect(mappingHearsDevice({}, 'Twister', ['Launch Control', 'Twister'])).toBe(true);
  });
});
