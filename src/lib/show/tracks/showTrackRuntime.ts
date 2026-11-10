/**
 * The live side of the show's layer tracks, installed once by App.svelte:
 *
 * - routes the show store's track frames into `showTrackFrame` (Canvas
 *   builds the native scene from it);
 * - paces scrubs of paused video clips through the native scrubber;
 * - runs the phase follower (showVideoPhase.ts) while the show plays;
 * - pre-rolls clips about to start (showPreloader.ts);
 * - re-anchors a video whose decoder drifted more than two frames off;
 * - finds the length of video clips whose media did not say;
 * - keeps each track's copy of its layer current while the layer is on stage.
 */
import { get, type Readable } from 'svelte/store';
import type { MediaSource, Project } from '../../types';
import {
  showTimeline,
  setShowTrackFrameSink,
  currentShowTrackFrame,
  onShowTimelineReset,
  setShowTemplateLayerSource,
} from '../../stores/showTimeline';
import { showTrackFrame, showClipSources } from '../../stores/showTrackFrame';
import { createNativeVideoScrubber } from '../../renderer/nativeVideoScrubber';
import {
  getNativeRendererStatus,
  prefetchNativeRendererMedia,
  probeNativeVideo,
  submitNativeRendererCommands,
  type RendererCommand,
} from '../../api/native-renderer';
import { getActiveNativeRendererSync } from '../../sync/nativeRendererSync';
import { SHOW_PHASE_INTERVAL_MS, showPhaseCommands, showPhaseTargets } from './showVideoPhase';
import { selectShowPreloads } from './showPreloader';
import { readableClipUri, showSourceId } from './showClipSources';
import { addTrackForLayer, addTrackForNewLayer } from './showTrackActions';
import { SHOW_DRIFT_CHECK_MS, ShowDriftWatch } from './showVideoDrift';
import { unknownLengthVideoUris, probeVideoDuration } from './showClipLength';

const PRELOAD_INTERVAL_MS = 250;
/** A pre-roll is not repeated for the same clip within this long. */
const PRELOAD_REPEAT_MS = 8000;
/** Track templates follow their layer at most this often while it changes
 *  (and always right before a save). */
const TEMPLATE_REFRESH_MS = 400;
/** A length probe the core could not answer yet is asked again after this. */
const PROBE_RETRY_MS = 3000;

export interface ShowTrackRuntimeDeps {
  project: Readable<Project>;
}

export function installShowTrackRuntime(deps: ShowTrackRuntimeDeps): () => void {
  const disposers: Array<() => void> = [];
  const desktop = typeof window !== 'undefined' && !!(window as any).electronAPI?.invoke;

  // ── Frames → scene ───────────────────────────────────────────────────
  setShowTrackFrameSink((frame) => showTrackFrame.set(frame));
  disposers.push(() => setShowTrackFrameSink(null));
  // Anchors live as long as the frame uses them: a track's own, and its
  // crossfade helper's only inside the crossfade.
  disposers.push(showTrackFrame.subscribe((frame) => showClipSources.retainFrame(frame)));
  // Another show loaded, or this one cleared: no video carries on from the
  // decoder the old one left.
  disposers.push(onShowTimelineReset(() => showClipSources.clear()));
  // A scrub commit changed a source: rebuild the scene from the same frame.
  showClipSources.onSourceChanged = () => showTrackFrame.update((f) => (f ? { ...f } : f));

  // ── Paused scrubbing ─────────────────────────────────────────────────
  const scrubbers = new Map<string, ReturnType<typeof createNativeVideoScrubber>>();
  if (desktop) {
    showClipSources.scrubHandler = (trackId, source, mediaTime, commit) => {
      let scrubber = scrubbers.get(trackId);
      if (!scrubber) {
        scrubber = createNativeVideoScrubber();
        scrubbers.set(trackId, scrubber);
      }
      scrubber.seek(source as MediaSource & { src: string }, mediaTime, (update) => commit({
        _nativePlaybackTimeSeconds: update._nativePlaybackTimeSeconds,
        _nativePlaybackUpdatedAtMs: update._nativePlaybackUpdatedAtMs,
        _nativePlaybackSeekSeq: update._nativePlaybackSeekSeq,
      }));
      return true;
    };
  }
  showClipSources.onReanchor = (trackId) => scrubbers.get(trackId)?.cancel();
  disposers.push(() => {
    showClipSources.onReanchor = null;
    showClipSources.scrubHandler = null;
    showClipSources.onSourceChanged = null;
    scrubbers.clear();
  });

  // ── Phase follower ───────────────────────────────────────────────────
  let following = new Set<string>();
  let phaseBusy = false;
  const phaseTimer = desktop
    ? setInterval(() => {
        if (phaseBusy) return;
        const { commands, following: next } = showPhaseCommands(showPhaseTargets(currentShowTrackFrame(), showClipSources, performance.now()), following);
        following = next;
        if (!commands.length) return;
        phaseBusy = true;
        submitNativeRendererCommands(commands as RendererCommand[])
          .catch(() => { /* the core expires stale targets itself */ })
          .finally(() => { phaseBusy = false; });
      }, SHOW_PHASE_INTERVAL_MS)
    : null;
  disposers.push(() => { if (phaseTimer) clearInterval(phaseTimer); });

  // ── Preloader ────────────────────────────────────────────────────────
  const preloaded = new Map<string, number>();
  const preload = () => {
    const s = get(showTimeline);
    if (!s.layerTracks.length) return;
    const sync = getActiveNativeRendererSync();
    if (!sync) return;
    const now = performance.now();
    const loopDuration = s.loop ? s.duration : undefined;
    for (const pick of selectShowPreloads(s.layerTracks, s.currentTime, { soloTrackId: s.soloTrackId, loopDuration })) {
      const media = pick.clip.media;
      const sourceId = showSourceId(pick.runId);
      const uri = readableClipUri(media);
      const seekGeneration = showClipSources.nextSeekSeqFor(sourceId);
      // Once per generation: after the clip has played (a looping show comes
      // back to it), its next pre-roll is a new one.
      const key = `${sourceId}|${uri}|${pick.clip.inPoint}|${seekGeneration}`;
      if (now - (preloaded.get(key) ?? -Infinity) < PRELOAD_REPEAT_MS) continue;
      preloaded.set(key, now);
      if (pick.kind === 'image') {
        void prefetchNativeRendererMedia(sourceId, uri, 2, 'image').catch(() => preloaded.delete(key));
        continue;
      }
      const duration = Number(media.sourceDuration);
      showClipSources.notePreroll(sourceId, seekGeneration, pick.clip.inPoint);
      const synthetic = {
        id: sourceId,
        type: 'video',
        src: uri,
        name: media.name,
        _assetRef: media._assetRef,
        durationSeconds: duration > 0 ? duration : undefined,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        playbackRate: pick.rate,
        playbackMode: 'loop',
        trimStart: duration > 0 ? Math.max(0, Math.min(1, pick.loopStart / duration)) : 0,
        trimEnd: 1,
        isPlaying: false,
        _nativePlaybackTimeSeconds: pick.clip.inPoint,
        _nativePlaybackSeekSeq: seekGeneration,
      } as unknown as MediaSource;
      const options = {
        ...sync.libraryVideoPrefetchOptions(synthetic),
        timeSeconds: pick.clip.inPoint,
        seekGeneration,
        seq: Math.max(1, Math.round(pick.clip.inPoint * 1000)),
      };
      void prefetchNativeRendererMedia(sourceId, uri, 2, 'video', options).catch(() => preloaded.delete(key));
    }
    if (preloaded.size > 512) preloaded.clear();
  };
  const preloadTimer = desktop
    ? setInterval(() => { if (get(showTimeline).isPlaying) preload(); }, PRELOAD_INTERVAL_MS)
    : null;
  disposers.push(() => { if (preloadTimer) clearInterval(preloadTimer); });
  let lastSeekGeneration = -1;
  disposers.push(showTrackFrame.subscribe((frame) => {
    if (!desktop || !frame || frame.manualClock || frame.seekGeneration === lastSeekGeneration) return;
    lastSeekGeneration = frame.seekGeneration;
    queueMicrotask(preload);
  }));

  // ── Drift: a hard re-anchor past two frames ──────────────────────────
  // The phase follower above only steers hardware-decoded clips, and only
  // the incoming side of a crossfade. Twice a second the decoders' real
  // positions are compared with the show; one that stays more than two
  // frames off is re-anchored (a seek, under a new generation).
  const drift = new ShowDriftWatch();
  let driftBusy = false;
  const driftTimer = desktop
    ? setInterval(() => {
        if (driftBusy) return;
        const frame = currentShowTrackFrame();
        if (!frame || !frame.playing || frame.manualClock) { drift.reset(); return; }
        if (!showClipSources.anchorEntries().some(([, a]) => !a.paused)) return;
        driftBusy = true;
        const sentAt = performance.now();
        getNativeRendererStatus()
          .then((status) => {
            const at = (sentAt + performance.now()) / 2;
            const latest = currentShowTrackFrame();
            if (!status || !latest) return;
            const keys = drift.check(latest, showClipSources.anchorEntries(), status.native_video_sessions ?? [], at, (performance.now() - sentAt) / 2000);
            if (!keys.length) return;
            for (const key of keys) showClipSources.reanchor(key);
            // Rebuild the scene from the newest evaluation, so the new
            // anchors name the media time of now.
            showTrackFrame.set({ ...latest });
          })
          .catch(() => { /* no status: try again next time */ })
          .finally(() => { driftBusy = false; });
      }, SHOW_DRIFT_CHECK_MS)
    : null;
  disposers.push(() => { if (driftTimer) clearInterval(driftTimer); });

  // ── Video clips of unknown length ────────────────────────────────────
  // A clip dropped before its media's length was known would loop forever
  // and stretch without limit: the core (or the file's metadata) tells.
  const lengths = new Map<string, number | 'pending' | 'failed'>();
  let probeTracks: unknown = null;
  let probeRetry: ReturnType<typeof setTimeout> | null = null;
  const probeLengths = () => {
    const tracks = get(showTimeline).layerTracks;
    if (tracks === probeTracks) return;
    probeTracks = tracks;
    for (const uri of unknownLengthVideoUris(tracks, readableClipUri)) {
      const known = lengths.get(uri);
      if (typeof known === 'number') { showTimeline.applyClipMediaLength(uri, known, readableClipUri); continue; }
      if (known === 'pending' || known === 'failed') continue;
      lengths.set(uri, 'pending');
      void probeVideoDuration(uri, desktop ? probeNativeVideo : null).then((seconds) => {
        if (seconds === null) {
          // No answer yet (the core is busy or not up): ask again shortly.
          lengths.delete(uri);
          probeRetry ??= setTimeout(() => { probeRetry = null; probeTracks = null; probeLengths(); }, PROBE_RETRY_MS);
          return;
        }
        if (!(seconds > 0)) { lengths.set(uri, 'failed'); return; }
        lengths.set(uri, seconds);
        showTimeline.applyClipMediaLength(uri, seconds, readableClipUri);
      });
    }
  };
  disposers.push(showTimeline.subscribe(() => probeLengths()));
  disposers.push(() => { if (probeRetry) clearTimeout(probeRetry); });

  // ── Track templates follow their layer while it is on stage ──────────
  // Throttled, not debounced: modulation changes the project every frame,
  // and a debounce restarted on every change never fired while it ran.
  let templateTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshTemplates = () => {
    if (templateTimer) clearTimeout(templateTimer);
    templateTimer = null;
    showTimeline.refreshTrackTemplates(get(deps.project).layers ?? []);
  };
  setShowTemplateLayerSource(() => get(deps.project).layers ?? []);
  disposers.push(() => setShowTemplateLayerSource(null));
  disposers.push(deps.project.subscribe(() => {
    if (templateTimer || !get(showTimeline).layerTracks.length) return;
    templateTimer = setTimeout(refreshTemplates, TEMPLATE_REFRESH_MS);
  }));
  disposers.push(() => { if (templateTimer) clearTimeout(templateTimer); });

  // ── Automation / test surface ────────────────────────────────────────
  try {
    const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
    w.__ghostArcade = {
      ...(w.__ghostArcade ?? {}),
      showTracks: {
        frame: () => currentShowTrackFrame(),
        anchor: (trackId: string) => showClipSources.anchorFor(trackId),
        expectedMediaTime: (trackId: string, t?: number) =>
          showClipSources.expectedMediaTime(trackId, t ?? get(showTimeline).currentTime),
        refreshTemplates,
        addTrackForLayer,
        addTrackForNewLayer,
      },
    };
  } catch { /* sealed */ }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose(); } catch { /* best effort */ }
    }
  };
}
