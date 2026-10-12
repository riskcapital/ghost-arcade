import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { midiStore } from './midiStore';

/**
 * Identify mode is the "press a control to find it" state behind the mappings
 * table. It suppresses routing in midiManager, so the thing worth pinning down
 * is that it cannot be left on by accident: it turns edit mode off rather than
 * sitting alongside it, and it clears any half-finished learn.
 */
describe('identify mode', () => {
  beforeEach(() => {
    midiStore.setIdentifyMode(false);
    midiStore.setEditMode(false);
  });

  it('is off to begin with, so routing is never suppressed by default', () => {
    expect(get(midiStore).identifyMode).toBe(false);
  });

  it('turns on and off', () => {
    midiStore.setIdentifyMode(true);
    expect(get(midiStore).identifyMode).toBe(true);
    midiStore.setIdentifyMode(false);
    expect(get(midiStore).identifyMode).toBe(false);
  });

  it('takes over from edit mode rather than running beside it', () => {
    midiStore.setEditMode(true);
    midiStore.setIdentifyMode(true);
    const s = get(midiStore);
    expect(s.identifyMode).toBe(true);
    expect(s.editMode).toBe(false);
  });

  it('drops a learn that was in progress', () => {
    midiStore.startLearn('vj:0:opacity', 'Opacity', 0, 1, 0.01, 'absolute');
    expect(get(midiStore).learn.active).toBe(true);
    midiStore.setIdentifyMode(true);
    expect(get(midiStore).learn.active).toBe(false);
  });

  it('leaves edit mode alone when it is switched off', () => {
    midiStore.setEditMode(true);
    midiStore.setIdentifyMode(false);
    expect(get(midiStore).editMode).toBe(true);
  });
});

describe('removing mappings', () => {
  // Mappings are only ever born through learn, so the tests make them the
  // same way the app does rather than reaching past it.
  const learn = (path: string, label: string, type: 'cc' | 'note', number: number) => {
    midiStore.startLearn(path, label, 0, 1, 0, 'absolute');
    midiStore.completeLearn(0, type, number);
  };

  beforeEach(() => midiStore.clearAllMappings());

  it('removes one mapping by id and leaves the rest of the control alone', () => {
    learn('vj:0:opacity', 'Opacity', 'note', 36);
    learn('map:splat:pointSize', 'Point Size', 'note', 36);
    const [first] = get(midiStore).mappings;
    midiStore.removeMappingById(first.id);
    const left = get(midiStore).mappings;
    expect(left).toHaveLength(1);
    expect(left[0].path).not.toBe(first.path);
  });

  it('keeps one mapping per parameter, which is why a pad can hold several', () => {
    learn('vj:0:opacity', 'Opacity', 'note', 36);
    learn('vj:0:opacity', 'Opacity', 'note', 40);
    const all = get(midiStore).mappings;
    expect(all).toHaveLength(1);
    expect(all[0].number).toBe(40);
  });

  it('clears everything', () => {
    learn('vj:0:opacity', 'Opacity', 'cc', 74);
    midiStore.clearAllMappings();
    expect(get(midiStore).mappings).toHaveLength(0);
  });
});
