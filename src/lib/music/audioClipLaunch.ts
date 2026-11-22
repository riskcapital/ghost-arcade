/**
 * Launching an audio clip in a session part: the clip playing there keeps
 * playing while the new one decodes, and the new one takes over at one
 * deadline on the audio clock, the old one stopping at that same time. When
 * the new one cannot load, the old one carries on and the queue entry goes.
 */

export interface AudioClipLaunch {
  /** The audio clock, in seconds. */
  now(): number;
  /** Start the new clip at `at` (the old one in its part stops then); false when it could not load. */
  play(at: number): Promise<boolean>;
  /** Still the latest launch in this part (no other launch or stop since). */
  current(): boolean;
  /** The part's notes loop (if any) ends at `at`. */
  handOver(at: number): void;
  /** It starts: playing from now on, no longer queued. */
  announce(): void;
  /** It could not load: the queue entry goes, the old clip stays, the player is told. */
  failed(): void;
  /** Run `fn` after `ms` (a timer). */
  later(fn: () => void, ms: number): void;
}

/** Launch for `deadline` (audio-clock seconds). Resolves true once it is set to start. */
export async function launchAudioClip(deadline: number, l: AudioClipLaunch): Promise<boolean> {
  const ok = await l.play(deadline);
  if (!l.current()) return false;
  if (!ok) {
    l.failed();
    return false;
  }
  // Decoding can run past the deadline: then it starts now, and so does the hand-over.
  const at = Math.max(deadline, l.now());
  l.handOver(at);
  const wait = Math.max(0, (at - l.now()) * 1000);
  if (wait > 0) l.later(() => { if (l.current()) l.announce(); }, wait);
  else l.announce();
  return true;
}
