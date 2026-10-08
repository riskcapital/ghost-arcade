import { describe, expect, it } from 'vitest';
import { autopilotResponse, nextAutoClip, type AutoEvent } from './autopilot';
import { defaultShow } from './model';

describe('what keeps Autopilot running', () => {
  it('is never switched off by tempo, panels, selection, arranging, blocks, undo or its own settings', () => {
    const keepsRunning: AutoEvent[] = ['tempo', 'panel', 'select', 'arrange', 'settings', 'block', 'undo'];
    for (const event of keepsRunning) expect(autopilotResponse(event), event).not.toBe('pause');
    // Tap tempo was the reviewed bug: it re-times the next change instead of stopping.
    expect(autopilotResponse('tempo')).toBe('rearm');
    expect(autopilotResponse('panel')).toBe('keep');
    expect(autopilotResponse('select')).toBe('keep');
  });
  it('pauses only when the performer takes a row over by hand', () => {
    expect(autopilotResponse('launch')).toBe('pause');
    expect(autopilotResponse('stop')).toBe('pause');
    expect(autopilotResponse('set')).toBe('pause');
  });
});

describe('Autopilot clip choice', () => {
  it('steps through a row in order and skips clips this device cannot run', () => {
    const show = defaultShow();
    const row = show.launchGrid[0];
    expect(nextAutoClip(show, 0, false)?.id).toBe(row[1]);
    show.clips = show.clips.map(c => (c.id === row[1] ? { ...c, shaderId: 'not-in-this-build' } : c));
    expect(nextAutoClip(show, 0, false)?.id).toBe(row[2]);
    expect(nextAutoClip(show, 0, true, () => 0)?.id).toBe(row[2]);
  });
});
