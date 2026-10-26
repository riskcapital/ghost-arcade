/**
 * Clip audio drives audio reactivity when no live input is running.
 *
 * Looks, ISF audio inputs and audio modulation all read the analyser, which
 * used to exist only while a mic / system / file input ran. A show played to
 * an imported song on the Show timeline was heard but did not move a single
 * audio-reactive shader. This controller starts the analyser in its
 * clip-follow mode whenever the app itself is making sound:
 *
 *  - the Show timeline's tracks play through the clip audio bus, which
 *    connects its master into the follow analyser
 *    (clipAudioBus.wireMasterOutputs);
 *  - VJ deck clips with sound play through the deck mixer, which has its own
 *    AudioContext; its mix reaches the analyser as a stream.
 *
 * Nothing here plays anything: the clip paths keep their own output, and the
 * follow analyser is never connected to the speakers.
 *
 * A live input always wins. Starting one replaces the follow analyser (a mic
 * or system capture already hears the clips through the room or the system
 * mix), and stopping it hands reactivity back to the clips.
 */
import type { Readable } from 'svelte/store';
import { audioStore, type AudioInputType } from '../stores/audio';
import { clipAudioMaster as showClipAudio } from './clipAudioBus';
import { clipAudio, clipAudioAudible } from './clipAudio';
import { audioAnalyzer } from './analyzer';

/** The parts of the Show timeline's clip bus state this needs. */
export interface ShowClipAudioState {
  activeClips: number;
  exportSilenced: boolean;
  muted: boolean;
  volume: number;
}

/** True while the app itself is making sound that should drive reactivity. */
export function clipFollowWanted(show: ShowClipAudioState, deckAudible: boolean): boolean {
  // An offline export owns the clock and analyses a mixdown of its own.
  const showAudible = show.activeClips > 0 && !show.exportSilenced && !show.muted && show.volume > 0;
  return showAudible || deckAudible;
}

/** What to do with the analyser for this input and want. */
export function clipFollowAction(inputType: AudioInputType, want: boolean): 'start' | 'stop' | null {
  if (want && inputType === 'none') return 'start';
  if (!want && inputType === 'clips') return 'stop';
  return null;
}

export interface DeckFeed {
  /** (Re)connect the deck mix into the current follow analyser. */
  connect(): void;
  disconnect(): void;
}

/** Streams the VJ deck's mix (its own AudioContext) into the follow analyser. */
export function createDeckFeed(): DeckFeed {
  let source: MediaStreamAudioSourceNode | null = null;
  let target: AnalyserNode | null = null;
  const disconnect = () => {
    try { source?.disconnect(); } catch { /* already gone */ }
    source = null;
    target = null;
  };
  return {
    connect() {
      const analyser = audioAnalyzer.clipAudioAnalyserNode();
      if (analyser && analyser === target && source) return;
      disconnect();
      if (!analyser) return;
      const stream = clipAudio.analysisStream();
      if (!stream) return;
      try {
        source = (analyser.context as AudioContext).createMediaStreamSource(stream);
        source.connect(analyser);
        target = analyser;
      } catch (err) {
        console.warn('[ClipAudioFollow] could not feed the deck mix to the analyser:', err);
        disconnect();
      }
    },
    disconnect,
  };
}

export interface ClipAudioFollowDeps {
  inputType: Readable<AudioInputType>;
  show: Readable<ShowClipAudioState>;
  deckAudible: Readable<boolean>;
  start: () => void;
  stop: () => void | Promise<void>;
  deckFeed: DeckFeed;
  /** Called when the analyser rebuilds its graph (the deck feed reconnects). */
  onGraphChange?: (listener: () => void) => () => void;
}

/** Wire the controller; returns a function that unwires it. */
export function startClipAudioFollow(deps: ClipAudioFollowDeps): () => void {
  let inputType: AudioInputType | null = null;
  let show: ShowClipAudioState | null = null;
  let deckAudible = false;
  let feeding = false;

  const evaluate = () => {
    if (inputType === null || !show) return;
    const action = clipFollowAction(inputType, clipFollowWanted(show, deckAudible));
    if (action === 'start') deps.start();
    else if (action === 'stop') void deps.stop();
    const feedDeck = deckAudible && inputType === 'clips';
    if (feedDeck) deps.deckFeed.connect();
    else if (feeding) deps.deckFeed.disconnect();
    feeding = feedDeck;
  };

  const unsubs = [
    deps.inputType.subscribe((value) => {
      if (value === inputType) return;
      inputType = value;
      evaluate();
    }),
    deps.show.subscribe((value) => { show = value; evaluate(); }),
    deps.deckAudible.subscribe((value) => { deckAudible = value; evaluate(); }),
  ];
  if (deps.onGraphChange) {
    unsubs.push(deps.onGraphChange(() => { if (feeding) deps.deckFeed.connect(); }));
  }
  return () => {
    for (const unsub of unsubs) unsub();
    deps.deckFeed.disconnect();
  };
}

if (typeof window !== 'undefined') {
  startClipAudioFollow({
    inputType: { subscribe: (fn) => audioStore.subscribe((s) => fn(s.inputType)) },
    show: showClipAudio,
    deckAudible: clipAudioAudible,
    start: () => audioStore.startClipFollow(),
    stop: () => audioStore.stopClipFollow(),
    deckFeed: createDeckFeed(),
    onGraphChange: (listener) => audioAnalyzer.onGraphChange(listener),
  });
}
