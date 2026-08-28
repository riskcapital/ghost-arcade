import { beforeEach, describe, expect, it } from 'vitest';
import { history } from './history';
import type { Project } from '../types';

/**
 * Keyframe timelines live in their own store, not inside Project, so history
 * has to carry them as a second half of each snapshot. These tests pin that
 * contract — the failure mode they guard against is silent and destructive:
 * a snapshot recorded without keyframes wipes every keyframe when you undo
 * onto it.
 */

function projectAt(name: string): Project {
  return { name, layers: [] } as unknown as Project;
}

const kfA = [{ layerId: 'L1', tracks: [{ key: 'splat:positionX', label: 'Position X', type: 'number', keyframes: [{ time: 0, value: 0, easing: 'linear' }], boolKeyframes: [] }] }];
const kfB = [{ layerId: 'L1', tracks: [{ key: 'splat:positionX', label: 'Position X', type: 'number', keyframes: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 5, easing: 'linear' }], boolKeyframes: [] }] }];

describe('history carries keyframe timelines', () => {
  beforeEach(() => {
    history.clear();
  });

  it('round-trips keyframes through undo and redo', () => {
    history.init(projectAt('start'), kfA);
    history.record(projectAt('after'), kfB);

    const undone = history.undo(projectAt('live'));
    expect(undone).not.toBeNull();
    expect(undone!.project.name).toBe('start');
    // The whole point: undo restores the keyframe set that went with that step.
    expect(undone!.keyframes).toEqual(kfA);

    const redone = history.redo(projectAt('live'));
    expect(redone).not.toBeNull();
    expect(redone!.project.name).toBe('after');
    expect(redone!.keyframes).toEqual(kfB);
  });

  it('restores keyframes even when the project itself is unchanged', () => {
    // Adding a keyframe does not touch Project at all. If snapshots were keyed
    // on the project alone this would dedupe to a no-op and the edit would be
    // silently unrecoverable.
    const same = projectAt('same');
    history.init(same, kfA);
    history.record(same, kfB);

    const undone = history.undo(same);
    expect(undone).not.toBeNull();
    expect(undone!.keyframes).toEqual(kfA);
  });

  it('treats a snapshot with no keyframes as empty rather than undefined', () => {
    history.init(projectAt('start'));
    history.record(projectAt('after'));
    const undone = history.undo(projectAt('live'));
    expect(undone!.keyframes).toBeNull();
  });
});
