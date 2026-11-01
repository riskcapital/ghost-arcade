import { describe, expect, it } from 'vitest';
import { normalizeDress, yAxisTarget } from './instrumentDress';

describe('an instrument dress', () => {
  it('keeps a tone, a Y axis and a visual, and drops what does not fit', () => {
    const d = normalizeDress({
      xy: { tone: 'pad.glass', yAxis: 'reverb', visual: { file: 'VX-Panels.fs', source: 'xy', blend: 'screen', level: 0.5 } },
      drone: { yAxis: 'sideways', visual: { file: 'not-a-visual.png' } },
    });
    expect(d.xy).toEqual({ tone: 'pad.glass', yAxis: 'reverb', visual: { file: 'VX-Panels.fs', source: 'xy', blend: 'screen', level: 0.5 } });
    expect(d.drone).toBeUndefined();
  });

  it('puts Y on the right mixer control, or on the note', () => {
    expect(yAxisTarget('xy', 'echo')).toBe('dest:mix.xy.send.echo');
    expect(yAxisTarget('xy', 'pan')).toBe('dest:mix.xy.pan');
    expect(yAxisTarget('xy', 'bright')).toBeNull();
  });
});
