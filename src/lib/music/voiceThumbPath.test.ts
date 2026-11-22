import { describe, expect, it } from 'vitest';
import { bakedVoiceThumb } from './voiceThumbnails';

describe('a voice row picture', () => {
  it('uses the same baked files as the visual browser', () => {
    expect(bakedVoiceThumb('VX-Contour.fs')).toBe('./ISF/voice-thumbs/VX-Contour.jpg');
    expect(bakedVoiceThumb('engine:particles', 'engine-particles.jpg')).toBe('./ISF/voice-thumbs/engine-particles.jpg');
  });
});
