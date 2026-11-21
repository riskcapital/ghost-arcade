import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  manifestParamDefaults,
  nativeCloudLoadStates,
  paramControlsFromManifest,
  setNativeCloudLoadStates,
  setNativeGraphParamDefsFromManifest,
} from './manifestParams';

// The shape the render core publishes (native_graph_manifest.rs param_defs).
const DEFS = [
  { kind: 'select', key: 'quality', label: 'Quality', group: 'Points', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }], default: 'medium', resets: true },
  { kind: 'slider', key: 'zoom', label: 'Zoom', group: 'Camera', min: 0.25, max: 4, step: 0.01, default: 1 },
  { kind: 'slider', key: 'width', label: 'Strand width', group: 'Points', min: 0.4, max: 4, step: 0.05, default: 0.6 },
  { kind: 'toggle', key: 'trigger', label: 'Trigger hit', group: 'Audio', default: false, button: true },
  { kind: 'toggle', key: 'freeze', label: 'Freeze', group: 'Motion', default: false },
  { kind: 'color', key: 'colorA', label: 'Colour A', group: 'Look', default: [217, 247, 255] },
  { kind: 'media-source', key: 'path', label: 'Point cloud', group: 'Scan', sources: ['file'], accept: '.ply', resets: true },
  { kind: 'slider', key: 'broken', label: 'Broken', min: 2, max: 1, default: 1 },
  { kind: 'mystery', key: 'odd', label: 'Odd' },
  { label: 'No key' },
];

describe('controls from the core manifest', () => {
  it('turns every well-formed definition into a panel control and skips the rest', () => {
    const controls = paramControlsFromManifest(DEFS);
    expect(controls.map((c) => c.key)).toEqual(['quality', 'zoom', 'width', 'trigger', 'freeze', 'colorA', 'path']);
    const trigger = controls.find((c) => c.key === 'trigger')!;
    expect(trigger.kind).toBe('toggle');
    expect(trigger.button).toBe(true);
    expect(controls.find((c) => c.key === 'quality')!.resets).toBe(true);
    expect(controls.find((c) => c.key === 'colorA')).toMatchObject({ kind: 'color', default: [217, 247, 255] });
    expect(controls.find((c) => c.key === 'path')).toMatchObject({ kind: 'media-source', sources: ['file'], accept: '.ply' });
    expect(paramControlsFromManifest(null)).toEqual([]);
  });

  it('stores controls per instrument and gives a new layer every default', () => {
    setNativeGraphParamDefsFromManifest([{ id: 'strands', param_defs: DEFS }, { id: 'planet', param_defs: [] }, { id: '' }]);
    const defaults = manifestParamDefaults('strands');
    expect(defaults).toMatchObject({ quality: 'medium', zoom: 1, width: 0.6, trigger: false, freeze: false, colorA: [217, 247, 255] });
    expect(manifestParamDefaults('planet')).toEqual({});
  });

});
