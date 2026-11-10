/**
 * The live side of the show's layer tracks, installed once by App.svelte:
 *
 * - routes the show store's track frames into `showTrackFrame` (Canvas
 *   builds the native scene from it);
 * - paces scrubs of paused video clips through the native scrubber;
 * - runs the phase follower (showVideoPhase.ts) while the show plays;
 * - pre-rolls clips about to start (showPreloader.ts);
 * - keeps each track's copy of its layer current while the layer is on stage.
 */
import { get, type Readable } from 'svelte/store';
import type { MediaSource, Project } from '../../types';
import { showTimeline, setShowTrackFrameSink, currentShowTrackFrame } from '../../stores/showTimeline';
import { showTrackFrame, showClipSources } from '../../stores/showTrackFrame';
import { createNativeVideoScrubber } from '../../renderer/nativeVideoScrubber';
import { prefetchNativeRendererMedia, submitNativeRendererCommands, type RendererCommand } from '../../api/native-renderer';
import { getActiveNativeRendererSync } from '../../sync/nativeRendererSync';
import { SHOW_PHASE_INTERVAL_MS, showPhaseCommands, showPhaseTargets } from './showVideoPhase';
import { selectShowPreloads } from './showPreloader';
import { readableClipUri, showSourceId } from './showClipSources';
import { addTrackForLayer, addTrackForNewLayer } from './showTrackActions';

const PRELOAD_INTERVAL_MS = 250;
/** A pre-roll is not repeated for the same clip within this long. */
const PRELOAD_REPEAT_MS = 8000;
const TEMPLATE_REFRESH_MS = 400;

export interface ShowTrackRuntimeDeps {
  project: Readable<Project>;
}

export function installShowTrackRuntime(deps: ShowTrackRuntimeDeps): () => void {
  const disposers: Array<() => void> = [];
  const desktop = typeof window !== 'undefined' && !!(window as any).electronAPI?.invoke;

  // ── Frames → scene ───────────────────────────────────────────────────
  setShowTrackFrameSink((frame) => showTrackFrame.set(frame));
  disposers.push(() => setShowTrackFrameSink(null));
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
        const { commands, following: next } = showPhaseCommands(showPhaseTargets(currentShowTrackFrame(), showClipSources), following);
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
    for (const pick of selectShowPreloads(s.layerTracks, s.currentTime, { soloTrackId: s.soloTrackId })) {
      const media = pick.clip.media;
      const sourceId = showSourceId(pick.runId);
      const uri = readableClipUri(media);
      const key = `${sourceId}|${uri}|${pick.clip.inPoint}`;
      if (now - (preloaded.get(key) ?? -Infinity) < PRELOAD_REPEAT_MS) continue;
      preloaded.set(key, now);
      if (pick.kind === 'image') {
        void prefetchNativeRendererMedia(sourceId, uri, 2, 'image').catch(() => preloaded.delete(key));
        continue;
      }
      const duration = Number(media.sourceDuration);
      const seekGeneration = showClipSources.nextSeekSeqFor(sourceId);
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

  // ── Track templates follow their layer while it is on stage ──────────
  let templateTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshTemplates = () => {
    templateTimer = null;
    const layers = get(deps.project).layers ?? [];
    const byId = new Map(layers.map((l) => [l.id, l]));
    for (const track of get(showTimeline).layerTracks) {
      const layer = byId.get(track.layerId);
      if (layer) showTimeline.refreshTrackTemplate(track.id, layer);
    }
  };
  disposers.push(deps.project.subscribe(() => {
    if (!get(showTimeline).layerTracks.length) return;
    if (templateTimer) clearTimeout(templateTimer);
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
