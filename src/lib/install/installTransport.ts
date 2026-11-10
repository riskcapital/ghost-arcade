/**
 * Install mode: the one thing it needs from whatever plays the show.
 *
 * A project has two documents that can play: the Show (presets along a
 * timeline with music and transitions) and the Timeline (mapping-piece rows,
 * keyframes, looks). Only one plays at a time. Install mode never reaches
 * into how either stores its tracks; it plays, stops, seeks, loops and reads
 * the position through this interface, and whoever owns the documents
 * installs an adapter with setInstallTransport().
 *
 * Until a document-aware adapter is installed, both documents map to the
 * one show timeline the app has today (defaultInstallTransport below).
 */

import { get } from 'svelte/store';

export type InstallDocument = 'show' | 'timeline';

export interface InstallTransportState {
  playing: boolean;
  /** Seconds. */
  time: number;
  /** Seconds; 0 = nothing to play. */
  duration: number;
  loop: boolean;
}

export interface InstallTransport {
  /** Make `doc` the active (playing) document; stops the other one. */
  setActiveDocument(doc: InstallDocument): void;
  play(doc: InstallDocument): void;
  stop(doc: InstallDocument): void;
  seek(doc: InstallDocument, seconds: number): void;
  setLoop(doc: InstallDocument, loop: boolean): void;
  state(doc: InstallDocument): InstallTransportState;
  /** False when the transport is following an external clock (timecode). */
  controllable?(doc: InstallDocument): boolean;
}

let installed: InstallTransport | null = null;

/** Install a document-aware transport (null restores the default). */
export function setInstallTransport(next: InstallTransport | null): void {
  installed = next;
}

export async function defaultInstallTransport(): Promise<InstallTransport> {
  const { showTimeline } = await import('../stores/showTimeline');
  return {
    setActiveDocument() { /* one document today */ },
    play: () => showTimeline.play(),
    stop: () => showTimeline.stop(),
    seek: (_doc, seconds) => showTimeline.seek(seconds),
    setLoop: (_doc, loop) => showTimeline.setLoop(loop),
    state: () => {
      const s = get(showTimeline);
      return { playing: s.isPlaying, time: s.currentTime, duration: s.duration, loop: s.loop };
    },
    controllable: () => !showTimeline.isChasing(),
  };
}

export async function installTransport(): Promise<InstallTransport> {
  return installed ?? defaultInstallTransport();
}
