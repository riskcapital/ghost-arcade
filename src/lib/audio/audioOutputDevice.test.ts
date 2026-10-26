import { describe, expect, it } from 'vitest';
import { audioOutputsFrom, resolveAudioSink } from './audioOutputDevice';

const devices = [
  { deviceId: 'speakers', label: 'MacBook Speakers' },
  { deviceId: 'interface', label: 'Scarlett 2i2' },
];

describe('resolveAudioSink', () => {
  it('plays on the system default when nothing was chosen', () => {
    expect(resolveAudioSink('', devices)).toEqual({ sinkId: '', missing: false });
    expect(resolveAudioSink(null, devices)).toEqual({ sinkId: '', missing: false });
    expect(resolveAudioSink('default', devices)).toEqual({ sinkId: '', missing: false });
  });

  it('plays on the chosen device when it is connected', () => {
    expect(resolveAudioSink('interface', devices)).toEqual({ sinkId: 'interface', missing: false });
  });

  it('falls back to the default, and says so, when the chosen device is unplugged', () => {
    expect(resolveAudioSink('usb-dac', devices)).toEqual({ sinkId: '', missing: true });
  });

  it('tries the chosen device while the list is not known yet', () => {
    expect(resolveAudioSink('interface', [])).toEqual({ sinkId: 'interface', missing: false });
  });
});

describe('audioOutputsFrom', () => {
  it('keeps outputs only, without the browser default entries, and names unnamed ones', () => {
    expect(audioOutputsFrom([
      { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
      { kind: 'audiooutput', deviceId: 'communications', label: 'Communications' },
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
      { kind: 'audiooutput', deviceId: 'hdmi', label: '' },
    ])).toEqual([
      { deviceId: 'speakers', label: 'Speakers' },
      { deviceId: 'hdmi', label: 'Output 2' },
    ]);
  });
});
