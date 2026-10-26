import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  assetStatusMessage,
  clearAllMediaLoadErrors,
  clearMediaLoadError,
  mediaFileName,
  mediaLoadErrors,
  probeAssetFailure,
  setMediaLoadError,
} from './mediaLoadErrors';
import { toasts } from './errorToast';

describe('media load errors', () => {
  it('marks a layer, tells the user once, and clears', () => {
    clearAllMediaLoadErrors();
    toasts.set([]);
    setMediaLoadError('layer-1', 'clip.mov cannot play');
    setMediaLoadError('layer-2', 'clip.mov cannot play');
    expect(get(mediaLoadErrors)).toEqual({ 'layer-1': 'clip.mov cannot play', 'layer-2': 'clip.mov cannot play' });
    expect(get(toasts)).toHaveLength(1);

    clearMediaLoadError('layer-1');
    expect(get(mediaLoadErrors)).toEqual({ 'layer-2': 'clip.mov cannot play' });

    clearAllMediaLoadErrors();
    expect(get(mediaLoadErrors)).toEqual({});
  });

  it('names the file from a URL or a path', () => {
    expect(mediaFileName('ghost-asset:///C:/Users/vj/Videos/Intro%20Loop.mp4')).toBe('Intro Loop.mp4');
    expect(mediaFileName('C:\\shows\\a.mov')).toBe('a.mov');
    expect(mediaFileName('', 'This video')).toBe('This video');
  });

  it('turns the media protocol status into what to do', () => {
    expect(assetStatusMessage('a.mp4', 404)).toContain('not on disk');
    expect(assetStatusMessage('a.mp4', 403)).toContain('not allowed to read');
    expect(assetStatusMessage('a.mp4', 500)).toBeNull();
  });

  it('only probes local media URLs', async () => {
    await expect(probeAssetFailure('blob:abc', 'a.mp4')).resolves.toBeNull();
  });
});
