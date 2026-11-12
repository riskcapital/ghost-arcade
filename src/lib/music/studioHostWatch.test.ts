import { describe, expect, it, vi } from 'vitest';
import { hostWatch, studioHosted } from './studioHostWatch';
import { STUDIO_EFFECT_TYPE } from './studioPlugin';

const studio = { type: 'effect', effectSource: { effectType: STUDIO_EFFECT_TYPE } };
const other = { type: 'effect', effectSource: { effectType: 'ghostfx' } };

describe('studio hosts', () => {
  it('sees a studio clip playing on either deck, or a studio mapping layer', () => {
    expect(studioHosted({ layerStates: [{ activeClip: studio }] }, [])).toBe(true);
    expect(studioHosted({ layerStates: [{ activeClip: null }], bankBLayerStates: [{ activeClip: studio }] }, [])).toBe(true);
    expect(studioHosted({ layerStates: [{ activeClip: other }] }, [])).toBe(false);
    expect(studioHosted({ layerStates: [] }, [{ source: { effectSource: studio.effectSource } }])).toBe(true);
  });
  it('stops the music when the last host goes, once', () => {
    const gone = vi.fn();
    const update = hostWatch(gone);
    update(false);
    expect(gone).not.toHaveBeenCalled();
    update(true);
    update(true);
    // The cell is cleared with X (or its row, or the deck, is stopped).
    update(studioHosted({ layerStates: [{ activeClip: null }] }, []));
    expect(gone).toHaveBeenCalledTimes(1);
    update(false);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
