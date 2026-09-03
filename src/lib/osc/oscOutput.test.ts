import { describe, expect, it, vi } from 'vitest';
import { collectOscFeedback, OSC_OUTPUT_EPSILON } from './oscOutput';
import type { OscBinding } from './oscStore';

/**
 * Outbound OSC exists so a control surface can show state. The rules that make
 * it usable rather than a flood are all in the diff step, so that is what is
 * tested here — the socket itself is Electron's.
 */

vi.mock('./oscFeedback', () => ({
  readControlPath: (path: string) => mockValues.get(path) ?? null,
  isReadableControlPath: (path: string) => mockValues.has(path),
}));

const mockValues = new Map<string, number>();

function binding(address: string, path: string): OscBinding {
  return {
    id: address, address, path, argIndex: 0,
    sourceMin: 0, sourceMax: 1, invert: false, label: address, mode: 'continuous',
  } as OscBinding;
}

describe('OSC feedback collection', () => {
  it('sends a value the first time it is seen', () => {
    mockValues.clear();
    mockValues.set('vj:0:opacity', 0.5);
    const sent = new Map<string, number>();

    const msgs = collectOscFeedback([binding('/a/op', 'vj:0:opacity')], sent);
    expect(msgs).toEqual([{ address: '/a/op', args: [0.5] }]);
  });

  it('stays silent while nothing moves', () => {
    mockValues.clear();
    mockValues.set('vj:0:opacity', 0.5);
    const sent = new Map<string, number>();
    const bindings = [binding('/a/op', 'vj:0:opacity')];

    collectOscFeedback(bindings, sent);
    // An idle rig must put nothing on the wire; this runs 20x a second.
    expect(collectOscFeedback(bindings, sent)).toEqual([]);
  });

  it('ignores changes below the epsilon', () => {
    mockValues.clear();
    mockValues.set('vj:0:video:position', 0.5);
    const sent = new Map<string, number>();
    const bindings = [binding('/a/pos', 'vj:0:video:position')];
    collectOscFeedback(bindings, sent);

    // A playhead advances every tick; without this, any playing clip would
    // emit continuously forever.
    mockValues.set('vj:0:video:position', 0.5 + OSC_OUTPUT_EPSILON / 2);
    expect(collectOscFeedback(bindings, sent)).toEqual([]);

    mockValues.set('vj:0:video:position', 0.6);
    expect(collectOscFeedback(bindings, sent)).toHaveLength(1);
  });

  it('skips paths that cannot be read rather than sending zero', () => {
    mockValues.clear();
    const sent = new Map<string, number>();
    // A layer with no clip is not a layer at zero; a surface must not light
    // up as though something is loaded.
    expect(collectOscFeedback([binding('/a/pos', 'vj:3:video:position')], sent)).toEqual([]);
  });

  it('re-sends a value that became readable again', () => {
    mockValues.clear();
    mockValues.set('vj:0:opacity', 0.8);
    const sent = new Map<string, number>();
    const bindings = [binding('/a/op', 'vj:0:opacity')];
    collectOscFeedback(bindings, sent);

    // Clip unloaded, then reloaded at the same value. A stale record would
    // suppress the resend and leave the surface blank.
    mockValues.delete('vj:0:opacity');
    collectOscFeedback(bindings, sent);
    mockValues.set('vj:0:opacity', 0.8);
    expect(collectOscFeedback(bindings, sent)).toEqual([{ address: '/a/op', args: [0.8] }]);
  });

  it('sends one message per address when several bindings share it', () => {
    mockValues.clear();
    mockValues.set('vj:0:opacity', 0.4);
    mockValues.set('vj:1:opacity', 0.9);
    const sent = new Map<string, number>();

    const msgs = collectOscFeedback(
      [binding('/shared', 'vj:0:opacity'), binding('/shared', 'vj:1:opacity')],
      sent,
    );
    expect(msgs).toHaveLength(1);
  });
});
