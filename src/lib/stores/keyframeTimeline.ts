// Keyframe Timeline Store
// Per-layer keyframe animation system with RAF playback engine.
// Pattern follows layerSequencer.ts for consistency.

import { writable, get } from 'svelte/store';
import type {
  KeyframeEasing,
  Keyframe,
  BoolKeyframe,
  KeyframeTrack,
  LayerKeyframeTimeline,
  KeyframeTimelineConfig,
} from '../types';
import { evaluateTrack } from '../keyframes/easing';

// ─── State ───────────────────────────────────────

export interface KeyframeTimelineState {
  isOpen: boolean;
  config: KeyframeTimelineConfig;
  /** All keyframe timelines indexed by layerId */
  timelines: Record<string, LayerKeyframeTimeline>;
  /** Currently selected layer in the timeline panel */
  selectedLayerId: string | null;
  /** Currently selected track key for editing */
  selectedTrackKey: string | null;
  /** Active parameter overrides computed each frame: layerId → { paramKey → value } */
  activeOverrides: Record<string, Record<string, number | boolean>>;
  /** Tracks with auto-keyframe armed: layerId:trackKey set. When armed, slider changes auto-add keyframes. */
  armedTracks: Record<string, boolean>;
  /** Currently selected (clicked) keyframe for inspector editing. null when nothing is selected. */
  selectedKeyframe: { layerId: string; trackKey: string; time: number } | null;
}

const DEFAULT_CONFIG: KeyframeTimelineConfig = {
  duration: 30,
  isPlaying: false,
  isLooping: true,
  currentTime: 0,
  zoom: 40, // 40px per second
  scrollLeft: 0,
};

function createInitialState(): KeyframeTimelineState {
  return {
    isOpen: false,
    config: { ...DEFAULT_CONFIG },
    timelines: {},
    selectedLayerId: null,
    selectedTrackKey: null,
    activeOverrides: {},
    armedTracks: {},
    selectedKeyframe: null,
  };
}

// ─── Playback engine (module-scoped RAF) ─────────

let animFrameId: number | null = null;
let lastFrameTime = 0;
// Module-level reference to the store for the RAF tick function
let _storeRef: ReturnType<typeof writable<KeyframeTimelineState>> | null = null;

let _tickLogCounter = 0;
function tick(now: number) {
  if (!_storeRef) { animFrameId = null; return; }
  const state = get(_storeRef);
  if (!state.config.isPlaying) {
    animFrameId = null;
    return;
  }
  if (++_tickLogCounter % 60 === 0) {
    console.log('[KF Tick] t=', state.config.currentTime.toFixed(2), 'overrides=', JSON.stringify(state.activeOverrides));
  }

  const dt = lastFrameTime > 0 ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;

  let newTime = state.config.currentTime + dt;

  // Handle end of timeline
  if (newTime >= state.config.duration) {
    if (state.config.isLooping) {
      newTime = newTime % state.config.duration;
    } else {
      newTime = state.config.duration;
      // Stop playback
      _storeRef!.update(s => ({
        ...s,
        config: { ...s.config, isPlaying: false, currentTime: newTime },
        activeOverrides: evaluateAll(s.timelines, newTime),
      }));
      animFrameId = null;
      return;
    }
  }

  // Evaluate all tracks at the current time
  const overrides = evaluateAll(state.timelines, newTime);

  _storeRef!.update(s => ({
    ...s,
    config: { ...s.config, currentTime: newTime },
    activeOverrides: overrides,
  }));

  animFrameId = requestAnimationFrame(tick);
}

/** Evaluate all timelines at a given time, returning parameter overrides per layer */
function evaluateAll(
  timelines: Record<string, LayerKeyframeTimeline>,
  time: number
): Record<string, Record<string, number | boolean>> {
  const result: Record<string, Record<string, number | boolean>> = {};

  for (const [layerId, timeline] of Object.entries(timelines)) {
    const layerOverrides: Record<string, number | boolean> = {};
    let hasOverrides = false;

    for (const track of timeline.tracks) {
      const value = evaluateTrack(track, time);
      if (value !== undefined) {
        layerOverrides[track.key] = value;
        hasOverrides = true;
      }
    }

    if (hasOverrides) {
      result[layerId] = layerOverrides;
    }
  }

  return result;
}

// ─── Store ───────────────────────────────────────

function createKeyframeTimelineStore() {
  const internalStore = writable<KeyframeTimelineState>(createInitialState());
  _storeRef = internalStore;
  const { subscribe, set, update } = internalStore;

  return {
    subscribe,

    // ── Panel visibility ──
    toggleOpen() {
      update(s => ({ ...s, isOpen: !s.isOpen }));
    },

    setOpen(open: boolean) {
      update(s => ({ ...s, isOpen: open }));
    },

    // ── Layer selection ──
    selectLayer(layerId: string | null) {
      update(s => ({ ...s, selectedLayerId: layerId, selectedTrackKey: null }));
    },

    selectTrack(trackKey: string | null) {
      update(s => ({ ...s, selectedTrackKey: trackKey }));
    },

    // ── Transport ──
    play() {
      update(s => {
        if (s.config.isPlaying) return s;
        lastFrameTime = 0;
        animFrameId = requestAnimationFrame(tick);
        return { ...s, config: { ...s.config, isPlaying: true } };
      });
    },

    pause() {
      update(s => {
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
        return { ...s, config: { ...s.config, isPlaying: false } };
      });
    },

    stop() {
      update(s => {
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
        return {
          ...s,
          config: { ...s.config, isPlaying: false, currentTime: 0 },
          activeOverrides: {},
        };
      });
    },

    seek(time: number) {
      update(s => {
        const clamped = Math.max(0, Math.min(time, s.config.duration));
        return {
          ...s,
          config: { ...s.config, currentTime: clamped },
          activeOverrides: evaluateAll(s.timelines, clamped),
        };
      });
    },

    setDuration(seconds: number) {
      update(s => ({ ...s, config: { ...s.config, duration: Math.max(1, seconds) } }));
    },

    setLooping(loop: boolean) {
      update(s => ({ ...s, config: { ...s.config, isLooping: loop } }));
    },

    setZoom(zoom: number) {
      update(s => ({ ...s, config: { ...s.config, zoom: Math.max(5, Math.min(200, zoom)) } }));
    },

    setScrollLeft(px: number) {
      update(s => ({ ...s, config: { ...s.config, scrollLeft: Math.max(0, px) } }));
    },

    // ── Track management ──
    ensureTrack(layerId: string, key: string, label: string, type: 'number' | 'boolean') {
      update(s => {
        const timeline = s.timelines[layerId] || { layerId, tracks: [] };
        if (timeline.tracks.some(t => t.key === key)) return s; // already exists
        const newTrack: KeyframeTrack = {
          key,
          label,
          type,
          keyframes: [],
          boolKeyframes: [],
        };
        return {
          ...s,
          timelines: {
            ...s.timelines,
            [layerId]: { ...timeline, tracks: [...timeline.tracks, newTrack] },
          },
        };
      });
    },

    removeTrack(layerId: string, trackKey: string) {
      update(s => {
        const timeline = s.timelines[layerId];
        if (!timeline) return s;
        const tracks = timeline.tracks.filter(t => t.key !== trackKey);
        if (tracks.length === 0) {
          const { [layerId]: _, ...rest } = s.timelines;
          return { ...s, timelines: rest };
        }
        return {
          ...s,
          timelines: { ...s.timelines, [layerId]: { ...timeline, tracks } },
        };
      });
    },

    // ── Keyframe management ──
    addKeyframe(layerId: string, trackKey: string, time: number, value: number | boolean, easing: KeyframeEasing = 'linear', label?: string, trackType?: 'number' | 'boolean') {
      console.log('[KF Store] addKeyframe:', layerId, trackKey, 'at', time, '=', value);
      update(s => {
        // Auto-create timeline + track if they don't exist
        let timeline = s.timelines[layerId];
        if (!timeline) {
          timeline = { layerId, tracks: [] };
        } else {
          timeline = { ...timeline, tracks: [...timeline.tracks] };
        }

        let trackIdx = timeline.tracks.findIndex(t => t.key === trackKey);
        if (trackIdx < 0) {
          // Auto-create track
          const type = trackType || (typeof value === 'boolean' ? 'boolean' : 'number');
          timeline.tracks.push({
            key: trackKey,
            label: label || trackKey.split(':').pop() || trackKey,
            type,
            keyframes: [],
            boolKeyframes: [],
          });
          trackIdx = timeline.tracks.length - 1;
        }

        const track = { ...timeline.tracks[trackIdx] };

        if (track.type === 'boolean') {
          const kf: BoolKeyframe = { time, value: value as boolean };
          const filtered = track.boolKeyframes.filter(k => Math.abs(k.time - time) > 0.001);
          filtered.push(kf);
          filtered.sort((a, b) => a.time - b.time);
          track.boolKeyframes = filtered;
        } else {
          const kf: Keyframe = { time, value: value as number, easing };
          const filtered = track.keyframes.filter(k => Math.abs(k.time - time) > 0.001);
          filtered.push(kf);
          filtered.sort((a, b) => a.time - b.time);
          track.keyframes = filtered;
        }

        timeline.tracks[trackIdx] = track;

        const newTimelines = { ...s.timelines, [layerId]: timeline };
        // Re-evaluate active overrides so rendering reflects the new keyframe immediately
        const newOverrides = evaluateAll(newTimelines, s.config.currentTime);

        return {
          ...s,
          timelines: newTimelines,
          activeOverrides: newOverrides,
        };
      });
    },

    removeKeyframe(layerId: string, trackKey: string, time: number) {
      console.log('[KF Store] removeKeyframe:', layerId, trackKey, 'at time', time);
      update(s => {
        const timeline = s.timelines[layerId];
        if (!timeline) {
          console.warn('[KF Store] removeKeyframe: no timeline for', layerId, 'available timelines:', Object.keys(s.timelines));
          return s;
        }
        const trackIdx = timeline.tracks.findIndex(t => t.key === trackKey);
        if (trackIdx < 0) { console.warn('[KF Store] removeKeyframe: no track', trackKey); return s; }

        const track = { ...timeline.tracks[trackIdx] };
        console.log('[KF Store] removeKeyframe: track has', track.keyframes.length, 'numeric kfs,', track.boolKeyframes.length, 'bool kfs');
        console.log('[KF Store] removeKeyframe: existing times:', track.type === 'boolean' ? track.boolKeyframes.map(k => k.time) : track.keyframes.map(k => k.time));
        // Use larger tolerance (50ms) to match user intent
        const tolerance = 0.05;
        const beforeCount = track.type === 'boolean' ? track.boolKeyframes.length : track.keyframes.length;

        if (track.type === 'boolean') {
          track.boolKeyframes = track.boolKeyframes.filter(k => Math.abs(k.time - time) > tolerance);
        } else {
          track.keyframes = track.keyframes.filter(k => Math.abs(k.time - time) > tolerance);
        }

        const afterCount = track.type === 'boolean' ? track.boolKeyframes.length : track.keyframes.length;
        console.log('[KF Store] removeKeyframe: removed', beforeCount - afterCount, 'kfs, remaining:', afterCount);

        const tracks = [...timeline.tracks];
        tracks[trackIdx] = track;
        const newTimelines = { ...s.timelines, [layerId]: { ...timeline, tracks } };
        const newOverrides = evaluateAll(newTimelines, s.config.currentTime);

        // Clear selection if the deleted keyframe was selected
        const sel = s.selectedKeyframe;
        const cleared = sel && sel.layerId === layerId && sel.trackKey === trackKey && Math.abs(sel.time - time) <= 0.05
          ? null
          : sel;

        return {
          ...s,
          timelines: newTimelines,
          activeOverrides: newOverrides,
          selectedKeyframe: cleared,
        };
      });
    },

    moveKeyframe(layerId: string, trackKey: string, fromTime: number, toTime: number) {
      console.log('[KF Store] moveKeyframe:', layerId, trackKey, 'from', fromTime, 'to', toTime);
      update(s => {
        const timeline = s.timelines[layerId];
        if (!timeline) { console.warn('[KF Store] moveKeyframe: no timeline'); return s; }
        const trackIdx = timeline.tracks.findIndex(t => t.key === trackKey);
        if (trackIdx < 0) { console.warn('[KF Store] moveKeyframe: no track'); return s; }

        const track = { ...timeline.tracks[trackIdx] };

        if (track.type === 'boolean') {
          track.boolKeyframes = track.boolKeyframes.map(k =>
            Math.abs(k.time - fromTime) < 0.05 ? { ...k, time: toTime } : k
          ).sort((a, b) => a.time - b.time);
        } else {
          track.keyframes = track.keyframes.map(k =>
            Math.abs(k.time - fromTime) < 0.05 ? { ...k, time: toTime } : k
          ).sort((a, b) => a.time - b.time);
        }

        const tracks = [...timeline.tracks];
        tracks[trackIdx] = track;
        const newTimelines = { ...s.timelines, [layerId]: { ...timeline, tracks } };
        const newOverrides = evaluateAll(newTimelines, s.config.currentTime);

        // Keep selection tracking the moved keyframe
        const sel = s.selectedKeyframe;
        const newSel = sel && sel.layerId === layerId && sel.trackKey === trackKey && Math.abs(sel.time - fromTime) < 0.05
          ? { ...sel, time: toTime }
          : sel;

        return { ...s, timelines: newTimelines, activeOverrides: newOverrides, selectedKeyframe: newSel };
      });
    },

    updateKeyframeEasing(layerId: string, trackKey: string, time: number, easing: KeyframeEasing) {
      update(s => {
        const timeline = s.timelines[layerId];
        if (!timeline) return s;
        const trackIdx = timeline.tracks.findIndex(t => t.key === trackKey);
        if (trackIdx < 0) return s;

        const track = { ...timeline.tracks[trackIdx] };
        track.keyframes = track.keyframes.map(k =>
          Math.abs(k.time - time) < 0.001 ? { ...k, easing } : k
        );

        const tracks = [...timeline.tracks];
        tracks[trackIdx] = track;

        return {
          ...s,
          timelines: { ...s.timelines, [layerId]: { ...timeline, tracks } },
        };
      });
    },

    /**
     * Update a keyframe's value in place (by time match). Handles both
     * numeric and boolean tracks. Also refreshes active overrides so the
     * change is reflected immediately in the viewport.
     */
    updateKeyframeValue(layerId: string, trackKey: string, time: number, value: number | boolean) {
      update(s => {
        const timeline = s.timelines[layerId];
        if (!timeline) return s;
        const trackIdx = timeline.tracks.findIndex(t => t.key === trackKey);
        if (trackIdx < 0) return s;

        const track = { ...timeline.tracks[trackIdx] };
        if (track.type === 'number' && typeof value === 'number') {
          track.keyframes = track.keyframes.map(k =>
            Math.abs(k.time - time) < 0.001 ? { ...k, value } : k
          );
        } else if (track.type === 'boolean' && typeof value === 'boolean') {
          track.boolKeyframes = track.boolKeyframes.map(k =>
            Math.abs(k.time - time) < 0.001 ? { ...k, value } : k
          );
        } else {
          return s;
        }

        const tracks = [...timeline.tracks];
        tracks[trackIdx] = track;
        const newTimelines = { ...s.timelines, [layerId]: { ...timeline, tracks } };
        return {
          ...s,
          timelines: newTimelines,
          activeOverrides: evaluateAll(newTimelines, s.config.currentTime),
        };
      });
    },

    /** Select a keyframe so the inspector panel can edit its parameters. */
    selectKeyframe(layerId: string, trackKey: string, time: number) {
      update(s => ({ ...s, selectedKeyframe: { layerId, trackKey, time } }));
    },

    /** Clear keyframe selection. */
    clearSelection() {
      update(s => (s.selectedKeyframe ? { ...s, selectedKeyframe: null } : s));
    },

    // ── Serialization ──
    exportAll(): { layerId: string; tracks: KeyframeTrack[] }[] {
      const state = get({ subscribe });
      return Object.values(state.timelines).map(t => ({
        layerId: t.layerId,
        tracks: t.tracks,
      }));
    },

    importAll(data: { layerId: string; tracks: KeyframeTrack[] }[]) {
      const timelines: Record<string, LayerKeyframeTimeline> = {};
      for (const item of data) {
        timelines[item.layerId] = {
          layerId: item.layerId,
          tracks: item.tracks.map(t => ({
            ...t,
            keyframes: t.keyframes || [],
            boolKeyframes: t.boolKeyframes || [],
          })),
        };
      }
      update(s => ({ ...s, timelines }));
    },

    // ── Utilities ──
    hasKeyframes(layerId: string): boolean {
      const state = get({ subscribe });
      const timeline = state.timelines[layerId];
      if (!timeline) return false;
      return timeline.tracks.some(t =>
        t.keyframes.length > 0 || t.boolKeyframes.length > 0
      );
    },

    getTrack(layerId: string, trackKey: string): KeyframeTrack | undefined {
      const state = get({ subscribe });
      return state.timelines[layerId]?.tracks.find(t => t.key === trackKey);
    },

    /** Check if a keyframe exists at the given time (within 1ms tolerance) */
    hasKeyframeAt(layerId: string, trackKey: string, time: number): boolean {
      const track = this.getTrack(layerId, trackKey);
      if (!track) return false;
      if (track.type === 'boolean') {
        return track.boolKeyframes.some(k => Math.abs(k.time - time) < 0.001);
      }
      return track.keyframes.some(k => Math.abs(k.time - time) < 0.001);
    },

    // ── Auto-keyframe (arm/disarm) ──
    toggleArmed(layerId: string, trackKey: string) {
      update(s => {
        const armKey = `${layerId}:${trackKey}`;
        const armed = { ...s.armedTracks };
        if (armed[armKey]) delete armed[armKey];
        else armed[armKey] = true;
        return { ...s, armedTracks: armed };
      });
    },

    isArmed(layerId: string, trackKey: string): boolean {
      const state = get({ subscribe });
      return !!state.armedTracks[`${layerId}:${trackKey}`];
    },

    /** Called when a parameter changes — if track is armed, auto-add keyframe */
    autoRecord(layerId: string, trackKey: string, value: number | boolean, label: string, type: 'number' | 'boolean') {
      const state = get({ subscribe });
      const armKey = `${layerId}:${trackKey}`;
      const isArmed = !!state.armedTracks[armKey];
      console.log('[KF Store] autoRecord:', layerId, trackKey, 'armed=', isArmed, 'armKeys=', Object.keys(state.armedTracks));
      if (!isArmed) return;
      // Ensure track exists
      this.ensureTrack(layerId, trackKey, label, type);
      // Add/update keyframe at current playhead
      this.addKeyframe(layerId, trackKey, state.config.currentTime, value, 'linear', label, type);
    },

    clearAll() {
      console.log('[KF Store] clearAll called');
      update(s => {
        console.log('[KF Store] clearAll: removing', Object.keys(s.timelines).length, 'timelines');
        return {
          ...s,
          timelines: {},
          armedTracks: {},
          activeOverrides: {},
        };
      });
      console.log('[KF Store] clearAll done');
    },

    clearLayer(layerId: string) {
      update(s => {
        const { [layerId]: _, ...rest } = s.timelines;
        const newArmed = { ...s.armedTracks };
        for (const key of Object.keys(newArmed)) {
          if (key.startsWith(`${layerId}:`)) delete newArmed[key];
        }
        return {
          ...s,
          timelines: rest,
          armedTracks: newArmed,
          activeOverrides: evaluateAll(rest, s.config.currentTime),
        };
      });
    },

    reset() {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
      set(createInitialState());
    },
  };
}

export const keyframeTimeline = createKeyframeTimelineStore();
