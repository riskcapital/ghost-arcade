import { describe, expect, it } from 'vitest';
import { hasDecodedVideoFrame, isReusableVideoTexture } from './videoReadiness';

describe('hasDecodedVideoFrame', () => {
  it('requires current decoded data and non-zero dimensions', () => {
    expect(hasDecodedVideoFrame({ readyState: 1, videoWidth: 1920, videoHeight: 1080 })).toBe(false);
    expect(hasDecodedVideoFrame({ readyState: 2, videoWidth: 0, videoHeight: 1080 })).toBe(false);
    expect(hasDecodedVideoFrame({ readyState: 2, videoWidth: 1920, videoHeight: 1080 })).toBe(true);
  });
});

describe('isReusableVideoTexture', () => {
  it('accepts only a decoded element wrapped by that exact texture', () => {
    const video = { readyState: 4, videoWidth: 1280, videoHeight: 720 };
    expect(isReusableVideoTexture({ image: video }, video)).toBe(true);
    expect(isReusableVideoTexture({ image: {} }, video)).toBe(false);
    expect(isReusableVideoTexture({ image: video }, { ...video, readyState: 1 })).toBe(false);
  });
});
