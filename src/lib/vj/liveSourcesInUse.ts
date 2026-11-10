/**
 * Which of the VJ panel's live inputs (camera, screen capture, NDI, Spout /
 * Syphon) a set of playing clips is still showing. Leaving VJ mode keeps the
 * rows a show takeover shows playing, so the inputs those rows play must
 * keep running too; every other input is closed as before.
 */

export interface VJLiveSourceRef {
  id: string;
  type: 'spout' | 'webcam' | 'capture' | 'ndi';
  spoutSenderName?: string;
  ndiSourceName?: string;
  name?: string;
}

export interface VJLiveClipRef {
  type?: string;
  src?: string;
  spoutSource?: string;
  ndiSource?: { senderName?: string } | null;
}

/** The ids of `sources` that one of `clips` plays. Pure. */
export function liveSourceIdsInUse(sources: readonly VJLiveSourceRef[], clips: readonly (VJLiveClipRef | null | undefined)[]): Set<string> {
  const used = new Set<string>();
  const playing = clips.filter((c): c is VJLiveClipRef => !!c);
  if (!playing.length) return used;
  for (const source of sources) {
    const hit = playing.some((clip) => {
      if (source.type === 'webcam' || source.type === 'capture') return clip.src === `live://${source.type}/${source.id}`;
      if (source.type === 'ndi') return !!source.ndiSourceName && clip.ndiSource?.senderName === source.ndiSourceName.trim();
      const sender = source.spoutSenderName;
      return !!sender && !clip.ndiSource && clip.type === 'spout' && (clip.spoutSource === sender || clip.src === sender);
    });
    if (hit) used.add(source.id);
  }
  return used;
}
