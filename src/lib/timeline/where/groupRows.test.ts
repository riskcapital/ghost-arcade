import { describe, expect, it } from 'vitest';
import type { ShowLayerClip, ShowLayerTrack } from '../../types';
import { adoptGroupWhere, groupRowWhere, normalizeTrackGroup, setGroupRowUnified } from './groupRows';
import { normalizeWhere } from './whereModel';

const clip = (id: string, where?: ShowLayerClip['where']): ShowLayerClip => ({
  id, startTime: 0, duration: 2, inPoint: 0, media: { kind: 'image', name: id, src: `/${id}.png` }, ...(where ? { where } : {}),
} as unknown as ShowLayerClip);
const row = (id: string, clips: ShowLayerClip[], group?: ShowLayerTrack['group']): ShowLayerTrack => ({
  id, layerId: 'host', layerName: id, template: null, clips, lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false, subRow: true, ...(group ? { group } : {}),
} as ShowLayerTrack);

describe('group rows', () => {
  it('lights every piece of the group, the pieces the block’s own, Unified as one picture', () => {
    const w = groupRowWhere({ orderId: 'left', unified: true });
    expect(w).toMatchObject({ namedOrder: 'left', spread: 1, position: 0.5, dark: true, span: true, motion: { kind: 'drawn' } });
    expect(groupRowWhere({ orderId: 'left', unified: false }).span).toBe(false);
    // It survives a save.
    expect(normalizeWhere(JSON.parse(JSON.stringify(w)))).toMatchObject({ namedOrder: 'left', spread: 1, dark: true, span: true });
  });

  it('gives blocks that came without a pattern the row’s, and leaves the rest', () => {
    const own = { ...groupRowWhere({ orderId: 'left', unified: true }), spread: 0.3 };
    const tracks = [row('g', [clip('a'), clip('b', own)], { orderId: 'left', unified: false }), row('plain', [clip('c')])];
    const out = adoptGroupWhere(tracks);
    expect(out[0].clips[0].where).toMatchObject({ namedOrder: 'left', span: false });
    expect(out[0].clips[1].where).toBe(own);
    expect(out[1]).toBe(tracks[1]);
    expect(adoptGroupWhere(out)).toBe(out);
  });

  it('switches a row and its group’s blocks between Unified and Individual', () => {
    const other = { ...groupRowWhere({ orderId: 'top', unified: false }) };
    const tracks = adoptGroupWhere([row('g', [clip('a'), clip('b', other)], { orderId: 'left', unified: true })]);
    const out = setGroupRowUnified(tracks, 'g', false);
    expect(out[0].group).toEqual({ orderId: 'left', unified: false });
    expect(out[0].clips[0].where?.span).toBe(false);
    // A block playing through another group keeps its own setting.
    expect(out[0].clips[1].where).toBe(other);
  });

  it('reads a row’s group from a file', () => {
    expect(normalizeTrackGroup({ orderId: 'left' })).toEqual({ orderId: 'left', unified: true });
    expect(normalizeTrackGroup({ orderId: 'x', unified: false })).toEqual({ orderId: 'x', unified: false });
    expect(normalizeTrackGroup({})).toBeNull();
  });
});
