import { hasDurableAssetLocation, type AssetRef } from './assetRegistry';

export { hasDurableAssetLocation };

type AssetRefCarrier = {
  name?: string;
  src?: string;
  type?: string;
  _assetRef?: AssetRef;
};

function normalizedMediaName(value: string | undefined): string {
  return (value || '')
    .trim()
    .replace(/\.[^.]+$/, '')
    .toLocaleLowerCase();
}

/**
 * Recover durable identity for clips created before every VJ insertion route
 * carried `_assetRef`. A runtime blob URL can keep such a clip alive until
 * quit, but cannot survive the next project load.
 *
 * Exact runtime-source matches are safe. Name/type fallback is intentionally
 * accepted only when it identifies one library asset, avoiding a silent
 * relink to the wrong file when two imports share a filename.
 */
export function recoverVJClipAssetRef(
  clip: AssetRefCarrier,
  mediaItems: readonly AssetRefCarrier[],
): AssetRef | undefined {
  if (hasDurableAssetLocation(clip._assetRef)) return clip._assetRef;

  const durableMedia = mediaItems.filter((item) =>
    hasDurableAssetLocation(item._assetRef) &&
    (!clip.type || !item.type || item.type === clip.type)
  );

  if (clip.src) {
    const exactSource = durableMedia.find((item) => item.src === clip.src);
    if (exactSource?._assetRef) return exactSource._assetRef;
  }

  const clipName = normalizedMediaName(clip.name);
  if (!clipName) return undefined;

  const nameMatches = durableMedia.filter((item) =>
    normalizedMediaName(item.name) === clipName ||
    normalizedMediaName(item._assetRef?.name) === clipName
  );

  return nameMatches.length === 1 ? nameMatches[0]._assetRef : undefined;
}
