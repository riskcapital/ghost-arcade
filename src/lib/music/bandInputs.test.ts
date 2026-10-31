import { describe, expect, it } from 'vitest';
import {
  InputNoteRoles,
  channelChoices,
  channelError,
  channelLabel,
  coarseLevel,
  groupInputsByDevice,
  idleInputStatus,
  overallInputStatus,
  sameStatus,
} from './bandInputs';
import { MAX_LIVE_INPUTS, defaultLiveInput, liveInputLabel, normalizeLiveInput, normalizeLiveInputs } from './mixer';

describe('groupInputsByDevice', () => {
  it('opens a stereo interface once for bass and guitar on its two inputs', () => {
    const groups = groupInputsByDevice([{ channel: 0 }, { channel: 1 }], ['duo', 'duo']);
    expect(groups).toEqual([{ deviceId: 'duo', inputs: [0, 1], channels: 2 }]);
  });

  it('keeps devices apart, in the order they first appear', () => {
    const groups = groupInputsByDevice([{ channel: -1 }, { channel: 3 }, { channel: 0 }], ['usb-b', 'usb-a', 'usb-b']);
    expect(groups).toEqual([
      { deviceId: 'usb-b', inputs: [0, 2], channels: 2 },
      { deviceId: 'usb-a', inputs: [1], channels: 4 },
    ]);
  });

  it('puts inputs with no device on the default input', () => {
    expect(groupInputsByDevice([{ channel: 0 }, { channel: 0 }], [])).toEqual([{ deviceId: '', inputs: [0, 1], channels: 1 }]);
  });

  it('asks a mixed input for both sides of a stereo pair', () => {
    expect(groupInputsByDevice([{ channel: -1 }], ['x'])[0].channels).toBe(2);
  });
});

describe('channels', () => {
  it('says why a channel the device does not send is silent', () => {
    expect(channelError(-1, 1)).toBeNull();
    expect(channelError(1, 2)).toBeNull();
    expect(channelError(1, 1)).toBe('This device sends one channel. Choose Mix or 1.');
    expect(channelError(4, 2)).toBe('This device sends 2 channels. Choose Mix or 1 to 2.');
  });

  it('offers Mix and each channel, a stereo pair before the device is known', () => {
    expect(channelChoices(null, -1)).toEqual([-1, 0, 1]);
    expect(channelChoices(4, 0)).toEqual([-1, 0, 1, 2, 3]);
    expect(channelChoices(1, -1)).toEqual([-1, 0]);
    // A channel already chosen stays offered, even past what the device sends.
    expect(channelChoices(1, 2)).toEqual([-1, 0, 1, 2]);
    expect(channelLabel(-1)).toBe('Mix');
    expect(channelLabel(0)).toBe('1');
  });
});

describe('status', () => {
  it('moves the level in coarse steps', () => {
    expect(coarseLevel(0.51)).toBeCloseTo(0.5);
    expect(coarseLevel(0.53)).toBeCloseTo(0.55);
    expect(coarseLevel(2)).toBe(1);
    expect(coarseLevel(-1)).toBe(0);
  });

  it('compares statuses field by field', () => {
    const a = [idleInputStatus(), { ...idleInputStatus(), on: true }];
    expect(sameStatus(a, a.map((s) => ({ ...s })))).toBe(true);
    expect(sameStatus(a, [a[0]])).toBe(false);
    expect(sameStatus(a, [a[0], { ...a[1], level: 0.5 }])).toBe(false);
  });

  it('is on while any input comes in, and names the input of the first error', () => {
    const on = { ...idleInputStatus(), on: true };
    const failed = { ...idleInputStatus(), error: 'That audio input is not connected.' };
    expect(overallInputStatus([on, failed], [{ name: 'Bass' }, { name: '' }])).toEqual({ on: true, error: 'Input 2: That audio input is not connected.' });
    expect(overallInputStatus([failed, on], [{ name: 'Bass' }, { name: '' }])).toEqual({ on: true, error: 'Bass: That audio input is not connected.' });
    expect(overallInputStatus([failed], [{ name: 'Bass' }])).toEqual({ on: false, error: 'That audio input is not connected.' });
    expect(overallInputStatus([], [])).toEqual({ on: false, error: null });
  });
});

describe('InputNoteRoles', () => {
  it('ends a note on the role it started as', () => {
    const roles = new InputNoteRoles();
    expect(roles.route(0, 'on', 40, 'bass')).toBe('bass');
    // The role changed while the note was held.
    expect(roles.route(0, 'off', 40, 'lead')).toBe('bass');
    expect(roles.size).toBe(0);
    // An end with no start goes to the role now.
    expect(roles.route(1, 'off', 60, 'kick')).toBe('kick');
  });

  it('keeps inputs apart', () => {
    const roles = new InputNoteRoles();
    roles.route(0, 'on', 40, 'bass');
    roles.route(1, 'on', 40, 'lead');
    expect(roles.route(1, 'off', 40, 'all')).toBe('lead');
    expect(roles.route(0, 'off', 40, 'all')).toBe('bass');
  });
});

describe('normalizeLiveInputs', () => {
  it('round-trips every input as saved', () => {
    const inputs = [
      { name: 'Bass', channel: 0, role: 'bass' as const, sensitivity: 0.7, volume: 0.4, monitor: false, fxSend: 0.2 },
      { name: 'Guitar', channel: 1, role: 'lead' as const, sensitivity: 0.5, volume: 0.6, monitor: true, fxSend: 1 },
    ];
    const back = normalizeLiveInputs(JSON.parse(JSON.stringify(inputs)));
    expect(back).toEqual(inputs);
    expect(normalizeLiveInputs(back)).toEqual(back);
  });

  it('keeps one to four inputs, and a project from before as the first', () => {
    expect(normalizeLiveInputs(undefined)).toEqual([defaultLiveInput()]);
    expect(normalizeLiveInputs([])).toEqual([defaultLiveInput()]);
    expect(normalizeLiveInputs(Array.from({ length: 6 }, () => ({})))).toHaveLength(MAX_LIVE_INPUTS);
    expect(normalizeLiveInputs(undefined, { role: 'kick' })[0].role).toBe('kick');
  });

  it('cleans what it cannot use', () => {
    const input = normalizeLiveInput({ name: '  A very long name for an input here  ', channel: 99, role: 'nope', sensitivity: 3, fxSend: -1 });
    expect(input.name).toHaveLength(24);
    expect(input.name.startsWith('A very long name')).toBe(true);
    expect(input.channel).toBe(-1);
    expect(input.role).toBe('lead');
    expect(input.sensitivity).toBe(1);
    expect(input.fxSend).toBe(0);
    expect(liveInputLabel({ name: '' }, 2)).toBe('Input 3');
    expect(liveInputLabel({ name: 'Bass' }, 0)).toBe('Bass');
  });
});
