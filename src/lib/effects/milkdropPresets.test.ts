import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { initialPreset } from './milkdropPresets';
import { milkdropStore } from '../stores/milkdrop';

/**
 * A Milkdrop layer used to start on a random preset every time it loaded,
 * so a saved project opened looking different each time. It now starts on
 * the preset it was saved showing, and its lock comes back with it.
 */
describe('Milkdrop reopens as it was saved', () => {
  const pack = { 'Geiss - Spiral': {}, 'Flexi - Mindblob': {}, 'Rovastar - Fractopia': {} };

  it('starts on the saved preset', () => {
    for (let i = 0; i < 20; i++) expect(initialPreset(pack, 'Flexi - Mindblob')).toBe('Flexi - Mindblob');
  });

  it('picks one from the pack when nothing was saved or the pack lacks it', () => {
    expect(Object.keys(pack)).toContain(initialPreset(pack, undefined));
    expect(Object.keys(pack)).toContain(initialPreset(pack, 'Not in this pack'));
    expect(initialPreset({}, 'Flexi - Mindblob')).toBeNull();
  });

  it('restores a saved lock without firing a command', () => {
    milkdropStore.setLocked('layer-1', true);
    expect(get(milkdropStore).locked['layer-1']).toBe(true);
    expect(get(milkdropStore).commands['layer-1']).toBeUndefined();
    milkdropStore.setLocked('layer-1', false);
    expect(get(milkdropStore).locked['layer-1']).toBe(false);
  });
});
