import { describe, expect, it } from 'vitest';
import { writable } from 'svelte/store';
import {
  clipFollowAction,
  clipFollowWanted,
  startClipAudioFollow,
  type ShowClipAudioState,
} from './clipAudioFollow';
import type { AudioInputType } from '../stores/audio';

const silentShow: ShowClipAudioState = { activeClips: 0, exportSilenced: false, muted: false, volume: 1 };
const playingShow: ShowClipAudioState = { ...silentShow, activeClips: 1 };

describe('clipFollowWanted', () => {
  it('follows a show track that is playing', () => {
    expect(clipFollowWanted(playingShow, false)).toBe(true);
  });
  it('follows deck clips that are heard', () => {
    expect(clipFollowWanted(silentShow, true)).toBe(true);
  });
  it('does not follow silence: nothing playing, muted, at zero, or an export', () => {
    expect(clipFollowWanted(silentShow, false)).toBe(false);
    expect(clipFollowWanted({ ...playingShow, muted: true }, false)).toBe(false);
    expect(clipFollowWanted({ ...playingShow, volume: 0 }, false)).toBe(false);
    expect(clipFollowWanted({ ...playingShow, exportSilenced: true }, false)).toBe(false);
  });
});

describe('clipFollowAction', () => {
  it('starts only when no input runs, and stops only its own follow', () => {
    expect(clipFollowAction('none', true)).toBe('start');
    expect(clipFollowAction('clips', false)).toBe('stop');
    expect(clipFollowAction('microphone', true)).toBeNull();
    expect(clipFollowAction('system', false)).toBeNull();
    expect(clipFollowAction('clips', true)).toBeNull();
    expect(clipFollowAction('none', false)).toBeNull();
  });
});

describe('startClipAudioFollow', () => {
  function setup() {
    const inputType = writable<AudioInputType>('none');
    const show = writable<ShowClipAudioState>(silentShow);
    const deckAudible = writable(false);
    const calls: string[] = [];
    const graphListeners = new Set<() => void>();
    const stop = startClipAudioFollow({
      inputType,
      show,
      deckAudible,
      // The real store reports the new input type once the analyser runs.
      start: () => { calls.push('start'); inputType.set('clips'); },
      stop: () => { calls.push('stop'); inputType.set('none'); },
      deckFeed: { connect: () => calls.push('connect'), disconnect: () => calls.push('disconnect') },
      onGraphChange: (listener) => { graphListeners.add(listener); return () => graphListeners.delete(listener); },
    });
    return { inputType, show, deckAudible, calls, stop, graphListeners };
  }

  it('drives reactivity from the Show timeline while the song plays, and stops after', () => {
    const t = setup();
    t.show.set(playingShow);
    expect(t.calls).toEqual(['start']);
    t.show.set(silentShow);
    expect(t.calls).toEqual(['start', 'stop']);
    t.stop();
  });

  it('feeds the deck mix into the analyser while deck clips are heard', () => {
    const t = setup();
    t.deckAudible.set(true);
    expect(t.calls).toEqual(['start', 'connect']);
    // The analyser rebuilt its graph: reconnect to the new one.
    for (const listener of t.graphListeners) listener();
    expect(t.calls.at(-1)).toBe('connect');
    t.deckAudible.set(false);
    expect(t.calls.slice(-2)).toEqual(['stop', 'disconnect']);
    t.stop();
  });

  it('leaves a live input alone and takes over again when it stops', () => {
    const t = setup();
    t.inputType.set('microphone');
    t.show.set(playingShow);
    expect(t.calls).toEqual([]);
    t.inputType.set('none');
    expect(t.calls).toEqual(['start']);
    t.stop();
  });
});
