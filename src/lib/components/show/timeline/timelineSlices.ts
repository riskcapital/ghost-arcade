/**
 * The show store, one field at a time.
 *
 * `showTimeline` publishes a new state object on every playhead frame, so a
 * component that reads `$showTimeline.layerTracks` is told about every frame
 * even though the tracks did not change, and Svelte has to walk everything
 * that depends on it to find that out. With a few thousand clips on screen
 * that walk alone costs milliseconds per frame.
 *
 * A slice tells its subscribers only when its own field changes (the store
 * replaces arrays and objects on every edit and never mutates them, so a
 * reference check is exact). Read the tray's state through these, and only
 * the parts that really follow the playhead (`currentTime`) update while a
 * show plays.
 */
import { get, readable, type Readable } from 'svelte/store';
import { showTimeline, type ShowTimelineState } from '../../../stores/showTimeline';

const cache = new Map<keyof ShowTimelineState, Readable<unknown>>();
const UNSET = Symbol('unset');

/** A readable of one field of the show store that only fires when that
 *  field changes. One shared instance per field. */
export function showSlice<K extends keyof ShowTimelineState>(key: K): Readable<ShowTimelineState[K]> {
  let slice = cache.get(key) as Readable<ShowTimelineState[K]> | undefined;
  if (!slice) {
    slice = readable(get(showTimeline)[key], (set) => {
      let last: ShowTimelineState[K] | typeof UNSET = UNSET;
      return showTimeline.subscribe((state) => {
        const value = state[key];
        if (last !== UNSET && Object.is(value, last)) return;
        last = value;
        set(value);
      });
    });
    cache.set(key, slice);
  }
  return slice;
}

/** Any store, passed on only when its value really changes (by reference).
 *  For stores that re-publish the same object, e.g. a `derived` of the
 *  project that fires on every project update. */
export function distinct<T>(store: Readable<T>): Readable<T> {
  return readable(get(store), (set) => {
    let last: T | typeof UNSET = UNSET;
    return store.subscribe((value) => {
      if (last !== UNSET && Object.is(value, last)) return;
      last = value;
      set(value);
    });
  });
}
