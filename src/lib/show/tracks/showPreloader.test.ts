import { describe, expect, it } from 'vitest';
import type { ShowLayerClip, ShowLayerTrack } from '../../types';
import { selectShowPreloads } from './showPreloader';

const clip = (id: string, startTime: number, duration: number, more: Partial<ShowLayerClip> = {}): ShowLayerClip => ({
  id, startTime, duration, inPoint: 0, media: { kind: 'video', name: id, src: `/${id}.mp4` }, ...more,
} as unknown as ShowLayerClip);
const row = (id: string, layerId: string, clips: ShowLayerClip[]): ShowLayerTrack => ({
  id, layerId, layerName: id, template: null, clips, lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false,
} as unknown as ShowLayerTrack);

describe('show preloads', () => {
  it('leaves a clip already dissolving in alone', () => {
    const tr = row('r', 'L', [clip('a', 0, 10), clip('b', 10, 10, { transitionIn: 'dissolve', transitionDuration: 2 } as Partial<ShowLayerClip>)]);
    expect(selectShowPreloads([tr], 8).map((p) => p.clip.id)).toEqual(['b']);
    expect(selectShowPreloads([tr], 9.5).map((p) => p.clip.id)).toEqual([]);
  });
  it('a solo keeps the other rows of its piece', () => {
    const a = row('a', 'L', [clip('x', 2, 4)]);
    const b = row('b', 'L', [clip('y', 2, 4)]);
    const c = row('c', 'M', [clip('z', 2, 4)]);
    expect(selectShowPreloads([a, b, c], 0, { soloTrackId: 'a' }).map((p) => p.clip.id).sort()).toEqual(['x', 'y']);
  });
});
