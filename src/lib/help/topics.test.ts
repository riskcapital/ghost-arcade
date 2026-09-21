import { describe, expect, it } from 'vitest';
import { helpContent, helpTopics } from './topics';

describe('context help routing', () => {
  it.each([
    ['Autopilot action', 'clip-launcher'], ['QUANT', 'clip-launcher'],
    ['Layer audio BPM', 'midi-audio'], ['Macro assignment', 'macros-snapshots'],
    ['Load .cube LUT', 'effects'], ['HAP Alpha', 'performance'], ['Spout input', 'syphon-spout-ndi'],
  ])('routes %s to %s', (label, page) => {
    expect(helpContent(label, 'interface').href).toBe(`https://ghostarcade.live/docs/${page}`);
  });
  it('keeps authored behavior and disabled reasons', () => {
    expect(helpContent('Resync', 'midi-audio', 'Unavailable while following Ableton Link').description)
      .toBe('Unavailable while following Ableton Link');
  });
  it('uses the owning panel for ambiguous controls', () => {
    expect(helpContent('Remove', 'effects').href).toBe('https://ghostarcade.live/docs/effects');
  });
  it('never constructs an external URL from a control value', () => {
    expect(helpContent('<script>', 'https://evil.example').href).toBe('https://ghostarcade.live/docs/interface');
    for (const key of Object.keys(helpTopics)) expect(key).toMatch(/^[a-z-]+$/);
  });
});
