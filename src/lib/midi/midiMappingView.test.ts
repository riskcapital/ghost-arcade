import { describe, expect, it } from 'vitest';
import {
  controlKey,
  groupMappingsByControl,
  groupMatchesMessage,
  describeTarget,
} from './midiMappingView';
import type { MidiMapping } from './midiTypes';
import type { Project } from '../types';

function mapping(over: Partial<MidiMapping>): MidiMapping {
  return {
    id: Math.random().toString(36).slice(2),
    channel: 0,
    type: 'note',
    number: 36,
    path: 'vj:0:opacity',
    min: 0,
    max: 1,
    step: 0,
    mode: 'absolute',
    label: 'Opacity',
    ...over,
  };
}

describe('grouping by control', () => {
  it('puts every parameter a single pad drives in one group', () => {
    const groups = groupMappingsByControl([
      mapping({ type: 'note', number: 36, channel: 0, path: 'map:effect:a:intensity' }),
      mapping({ type: 'note', number: 36, channel: 0, path: 'vj:0:opacity' }),
      mapping({ type: 'note', number: 37, channel: 0 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.number === 36)?.mappings).toHaveLength(2);
  });

  it('keeps the same note on different channels apart', () => {
    const groups = groupMappingsByControl([
      mapping({ type: 'note', number: 36, channel: 0 }),
      mapping({ type: 'note', number: 36, channel: 3 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.channelLabel)).toEqual(['Ch 1', 'Ch 4']);
  });

  it('labels the any-channel wildcard rather than calling it channel zero', () => {
    const [group] = groupMappingsByControl([mapping({ channel: -1 })]);
    expect(group.channelLabel).toBe('Any channel');
  });

  it('reads in controller order, not the order things were learned', () => {
    const groups = groupMappingsByControl([
      mapping({ type: 'pitchbend', number: 0 }),
      mapping({ type: 'note', number: 40 }),
      mapping({ type: 'cc', number: 74 }),
      mapping({ type: 'note', number: 36 }),
      mapping({ type: 'cc', number: 1 }),
    ]);
    expect(groups.map(g => g.controlLabel)).toEqual([
      'CC 1', 'CC 74', 'Note 36', 'Note 40', 'Pitch bend',
    ]);
  });

  it('keys a control by what a message has to match to reach it', () => {
    expect(controlKey({ type: 'cc', number: 74, channel: 2 })).toBe('cc:74:2');
  });
});

describe('finding the control that was pressed', () => {
  const [group] = groupMappingsByControl([mapping({ type: 'cc', number: 74, channel: 2 })]);

  it('matches its own message', () => {
    expect(groupMatchesMessage(group, { type: 'cc', number: 74, channel: 2 })).toBe(true);
  });

  it('ignores another channel, another number and another type', () => {
    expect(groupMatchesMessage(group, { type: 'cc', number: 74, channel: 3 })).toBe(false);
    expect(groupMatchesMessage(group, { type: 'cc', number: 75, channel: 2 })).toBe(false);
    expect(groupMatchesMessage(group, { type: 'note', number: 74, channel: 2 })).toBe(false);
  });

  it('matches any channel when the mapping is a wildcard', () => {
    const [wild] = groupMappingsByControl([mapping({ type: 'cc', number: 74, channel: -1 })]);
    expect(groupMatchesMessage(wild, { type: 'cc', number: 74, channel: 9 })).toBe(true);
  });

  it('matches nothing before a control has been pressed', () => {
    expect(groupMatchesMessage(group, null)).toBe(false);
  });
});

describe('naming what a mapping points at', () => {
  const project = {
    layers: [
      {
        name: 'Layer 2',
        effects: [{ id: 'fx-1', type: 'kaleidoscope' }],
        edgeEffects: { enabled: true, effects: [{ id: 'edge-1' }] },
      },
    ],
    mappingComposition: { effects: [{ id: 'fx-comp', type: 'bloom' }] },
  } as unknown as Project;

  it('names the effect and the layer, because the label alone is just the param', () => {
    const d = describeTarget('map:effect:fx-1:intensity', 'Intensity', project);
    expect(d.context).toContain('Layer 2');
    expect(d.label).toBe('Intensity');
    expect(d.orphaned).toBe(false);
  });

  it('finds an effect on the mapping composition too', () => {
    expect(describeTarget('map:effect:fx-comp:amount', 'Amount', project).orphaned).toBe(false);
  });

  it('flags an effect that is not in the open project instead of dropping the row', () => {
    const d = describeTarget('map:effect:gone:intensity', 'Intensity', project);
    expect(d.orphaned).toBe(true);
    expect(d.label).toBe('Intensity');
  });

  it('uses the layer for an edge effect, which has no type to name', () => {
    const d = describeTarget('map:edge:edge-1:stroke.width', 'Stroke Width', project);
    expect(d.context).toBe('Layer 2 · Edge');
    expect(d.orphaned).toBe(false);
  });

  it('reads context off the prefix for everything that names itself', () => {
    expect(describeTarget('map:model3d:camera.fov', 'FOV', project).context).toBe('3D model');
    expect(describeTarget('map:splat:pointSize', 'Point Size', project).context).toBe('Point cloud');
    expect(describeTarget('vj:0:opacity', 'Opacity', project).context).toBe('VJ');
    expect(describeTarget('global:clipAudio:volume', 'Volume', project).context).toBe('Global');
  });

  it('never loses the row when there is no project loaded', () => {
    const d = describeTarget('map:effect:fx-1:intensity', 'Intensity', null);
    expect(d.orphaned).toBe(true);
    expect(d.label).toBe('Intensity');
  });

  it('falls back to the path when a mapping has no label', () => {
    expect(describeTarget('something:odd:here', '', project).label).toBe('here');
  });
});
