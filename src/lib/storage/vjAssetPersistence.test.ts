import { describe, expect, it } from 'vitest';
import type { AssetRef } from './assetRegistry';
import { hasDurableAssetLocation, recoverVJClipAssetRef } from './vjAssetPersistence';

const firstRef: AssetRef = {
  kind: 'local-file',
  originalPath: '/media/first.mp4',
  name: 'first.mp4',
};

describe('VJ asset persistence', () => {
  it('keeps an existing durable clip reference', () => {
    expect(recoverVJClipAssetRef(
      { type: 'video', src: 'blob:clip', _assetRef: firstRef },
      [],
    )).toBe(firstRef);
  });

  it('recovers an older clip by exact runtime source', () => {
    expect(recoverVJClipAssetRef(
      { type: 'video', name: 'Renamed clip', src: 'blob:shared' },
      [{ type: 'video', name: 'first.mp4', src: 'blob:shared', _assetRef: firstRef }],
    )).toBe(firstRef);
  });

  it('recovers by a unique filename when a runtime URL has changed', () => {
    expect(recoverVJClipAssetRef(
      { type: 'video', name: 'first', src: 'blob:old' },
      [{ type: 'video', name: 'first.mp4', src: 'blob:new', _assetRef: firstRef }],
    )).toBe(firstRef);
  });

  it('does not guess when duplicate filenames are present', () => {
    const duplicateRef: AssetRef = {
      kind: 'local-file',
      originalPath: '/other/first.mp4',
      name: 'first.mp4',
    };
    expect(recoverVJClipAssetRef(
      { type: 'video', name: 'first', src: 'blob:old' },
      [
        { type: 'video', name: 'first.mp4', src: 'blob:a', _assetRef: firstRef },
        { type: 'video', name: 'first.mp4', src: 'blob:b', _assetRef: duplicateRef },
      ],
    )).toBeUndefined();
  });

  it('does not treat metadata-only embedded refs as recoverable', () => {
    expect(hasDurableAssetLocation({
      kind: 'embedded',
      name: 'lost.mp4',
      mime: 'video/mp4',
    })).toBe(false);
  });

  it('does not treat a session blob stored in the URL field as durable', () => {
    expect(hasDurableAssetLocation({
      kind: 'url',
      url: 'blob:session-only',
      name: 'lost.mp4',
    })).toBe(false);
  });
});
