import { describe, expect, it } from 'vitest';
import { liveSourceIdsInUse, type VJLiveSourceRef } from './liveSourcesInUse';

const sources: VJLiveSourceRef[] = [
  { id: 'cam', type: 'webcam' },
  { id: 'scr', type: 'capture' },
  { id: 'ndi', type: 'ndi', ndiSourceName: 'Studio (Cam 1) ' },
  { id: 'spt', type: 'spout', spoutSenderName: 'Mixer Out' },
];

describe('liveSourceIdsInUse', () => {
  it('nothing playing: none in use', () => {
    expect([...liveSourceIdsInUse(sources, [])]).toEqual([]);
    expect([...liveSourceIdsInUse(sources, [null, undefined])]).toEqual([]);
  });

  it('matches each kind of input to the clips made from it', () => {
    const ids = (clips: object[]) => [...liveSourceIdsInUse(sources, clips as never)].sort();
    expect(ids([{ type: 'video', src: 'live://webcam/cam' }])).toEqual(['cam']);
    expect(ids([{ type: 'video', src: 'live://capture/scr' }])).toEqual(['scr']);
    expect(ids([{ type: 'spout', src: 'Studio (Cam 1)', ndiSource: { senderName: 'Studio (Cam 1)' } }])).toEqual(['ndi']);
    expect(ids([{ type: 'spout', src: 'Mixer Out', spoutSource: 'Mixer Out' }])).toEqual(['spt']);
    // A webcam clip of another session, or a shader, is not this input.
    expect(ids([{ type: 'video', src: 'live://webcam/other' }, { type: 'shader', src: './ISF/x.fs' }])).toEqual([]);
    expect(ids([{ type: 'video', src: 'live://webcam/cam' }, { type: 'spout', spoutSource: 'Mixer Out', src: 'Mixer Out' }])).toEqual(['cam', 'spt']);
  });
});
