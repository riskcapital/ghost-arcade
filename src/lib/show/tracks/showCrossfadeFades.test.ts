import { describe, expect, it } from 'vitest';
import type { ShowLayerClip, ShowLayerTrack } from '../../types';
import { evaluateShowTracks } from './showTrackEval';

const clip = (id: string, startTime: number, more: Partial<ShowLayerClip> = {}): ShowLayerClip => ({
  id, startTime, duration: 10, inPoint: 0, media: { kind: 'image', name: id, src: `/${id}.png` }, ...more,
} as unknown as ShowLayerClip);

describe('crossfade with fades', () => {
  it('does not dip to dark when the outgoing block also fades out', () => {
    const track = {
      id: 'r', layerId: 'L', layerName: 'L', template: null, lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false,
      clips: [clip('a', 0, { fadeOut: 2 }), clip('b', 10, { transitionIn: 'dissolve', transitionDuration: 2 } as Partial<ShowLayerClip>)],
    } as unknown as ShowLayerTrack;
    for (const t of [9.5, 10, 10.5]) {
      const st = evaluateShowTracks([track], t, { playing: true, seekGeneration: 1 }).tracks[0];
      expect(st.xfade).toBeTruthy();
      expect(st.opacity + (st.xfade?.opacity ?? 0)).toBeGreaterThan(0.9);
    }
  });
});

describe('a row whose piece was deleted', () => {
  it('draws nothing', () => {
    const track = {
      id: 'r', layerId: 'gone', layerName: 'gone', template: { id: 'gone' }, lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false,
      row: { kind: 'missing', depth: 0, hidden: false, onStage: false },
      clips: [clip('a', 0)],
    } as unknown as ShowLayerTrack;
    const st = evaluateShowTracks([track], 5, { playing: true, seekGeneration: 1 }).tracks[0];
    expect(st.clip).toBeNull();
    expect(st.opacity).toBe(0);
  });
});

