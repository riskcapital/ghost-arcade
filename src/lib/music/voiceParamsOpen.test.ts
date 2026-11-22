import { describe, expect, it } from 'vitest';
import { normalizeStudioVoice } from './studioPlugin';

describe('a voice row left open in the visuals rack', () => {
  it('stays open through a project save and load', () => {
    const saved = JSON.parse(JSON.stringify({ file: 'VX-Barcode.fs', source: 'kick', paramsOpen: true }));
    expect(normalizeStudioVoice(saved)?.paramsOpen).toBe(true);
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', source: 'kick' })?.paramsOpen).toBeUndefined();
    expect(normalizeStudioVoice({ file: 'VX-Barcode.fs', paramsOpen: 'yes' })?.paramsOpen).toBeUndefined();
  });
});
