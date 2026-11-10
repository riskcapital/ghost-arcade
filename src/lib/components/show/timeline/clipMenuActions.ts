/**
 * Small shared pieces of the clip menu: the colour swatches and "Show in
 * the media tray" (the tray listens for `ghost-media-tray-reveal`, switches
 * to the card's tab and outlines it).
 */
import type { ShowClipMedia } from '../../../types';

export const CLIP_SWATCHES = ['#ff6f5e', '#f0c674', '#5fdc76', '#5ce1e6', '#5278ff', '#c77dff'];

export const MEDIA_TRAY_REVEAL_EVENT = 'ghost-media-tray-reveal';

export interface MediaTrayRevealDetail {
  id: string;
  kind: ShowClipMedia['kind'];
  /** Set by the tray when it found the card. */
  handled?: boolean;
}

/** Ask the media tray to show a clip's card. False when no tray found it. */
export function revealClipInMediaTray(media: Pick<ShowClipMedia, 'libraryId' | 'kind'>): boolean {
  if (!media.libraryId || typeof window === 'undefined') return false;
  const detail: MediaTrayRevealDetail = { id: media.libraryId, kind: media.kind };
  window.dispatchEvent(new CustomEvent(MEDIA_TRAY_REVEAL_EVENT, { detail }));
  return !!detail.handled;
}
