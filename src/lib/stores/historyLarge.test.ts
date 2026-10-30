/**
 * An embedded model or image (a data URL of many MB) is kept once in the
 * undo history, not copied into every step, and comes back whole on undo.
 */

import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { history } from './history';
import type { Project } from '../types';

const model = 'data:model/gltf-binary;base64,' + 'A'.repeat(1024 * 1024);

function projectWith(name: string, extra: Record<string, unknown> = {}): Project {
  const step = Number(name.replace(/\D/g, '')) || 0;
  return {
    id: 'p', name, width: 1000 + step, height: 1080, layers: [], selectedLayerId: null,
    stagePresets: [{ id: 's1', name: 'Stage', stage3d: { venueModel: model } }],
    ...extra,
  } as unknown as Project;
}

describe('large strings in the undo history', () => {
  it('stores a big data URL once and restores it on undo', () => {
    history.init(projectWith('a'));
    for (let i = 0; i < 20; i++) history.record(projectWith(`step ${i}`));
    const state = get(history);
    const sizes = [...state.past, state.current!].map((e) => e.json.length);
    expect(Math.max(...sizes)).toBeLessThan(10_000);

    const step = history.undo(projectWith('live'));
    expect(step?.project.width).toBe(1018);
    expect(step?.project.name).toBe('step 18');
    expect((step?.project as any).stagePresets[0].stage3d.venueModel).toBe(model);
  });

  it('forgets the string once no step uses it', () => {
    history.init(projectWith('a'));
    history.record(projectWith('b', { stagePresets: [] }));
    history.clear();
    history.init(projectWith('c', { stagePresets: [] }));
    // A fresh project with no model: re-recording the model gives a new id.
    history.record(projectWith('d'));
    const json = get(history).current!.json;
    expect(json).toMatch(/ga-large:\d+/);
    const step = history.undo(projectWith('live'));
    expect((step?.project as any).stagePresets).toEqual([]);
  });
});

describe('renaming the project', () => {
  it('names every step, so undo keeps the new name', () => {
    history.init(projectWith('Untitled Project'));
    history.record({ ...projectWith('Untitled Project'), width: 1234 } as Project);
    history.renameSteps('Club Night');
    const step = history.undo(projectWith('Club Night'));
    expect(step?.project.name).toBe('Club Night');
    expect((step?.project as any).stagePresets[0].stage3d.venueModel).toBe(model);
  });
});
