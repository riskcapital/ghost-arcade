/**
 * Live record, part two: what a piece shows. With Follow edits on, recording
 * armed and the Timeline playing, putting other content on a mapping layer
 * (a shader, a video, an image, a sketch) is recorded as a block on that
 * layer's row, from the moment it went on until the next change or the stop.
 *
 * A block is written when it ends (one undo step each), over whatever was on
 * the row then (an overwrite edit). The first change on a row with no blocks
 * also records what the piece showed before it, from where recording began:
 * a row with blocks hides its piece between them, so without it the start of
 * the take would go dark.
 *
 * Engines (sections, cues, takeovers) and undo / redo are not a person's
 * change: they are not recorded. Clocks and stores are injected, so tests run
 * on plain data.
 */
import type { Layer, ShowClipMedia, ShowLayerTrack } from '../../types';
import { SHOW_MIN_TRACK_CLIP_SECONDS } from '../../show/tracks/showTrackEdit';

export interface ContentRecorderHost {
  /** Recording is armed with Follow edits on. */
  armed(): boolean;
  layers(): readonly Layer[];
  tracks(): readonly ShowLayerTrack[];
  /** The row a layer's content is recorded on (made when it has none). */
  rowFor(layer: Layer): string | null;
  write(trackId: string, media: ShowClipMedia, start: number, end: number): void;
  /** Live edit with the playhead parked: the row shows `media` from `t` (its block there is cut at `t`). */
  swapAt(trackId: string, media: ShowClipMedia, t: number): void;
  /** An engine or undo / redo is writing the project. */
  notAPerson(): boolean;
}

/** The show moving on more than this between two frames is a jump. */
const JUMP_SECONDS = 0.5;

/** Block media for what a layer shows, or null for content a block cannot hold
 *  (a live input, a plugin, nothing). */
export function mediaOfLayer(layer: Pick<Layer, 'source'>): ShowClipMedia | null {
  const s = layer.source as (Layer['source'] & Record<string, unknown>) | null | undefined;
  if (!s) return null;
  const name = String(s.name || 'Recorded');
  if (s.jsAnimation) return { kind: 'sketch', name, src: 'js-animation', jsAnimation: s.jsAnimation };
  if (s.type === 'shader' && s.shaderCode) {
    return {
      kind: 'shader',
      name,
      src: String(s.src ?? ''),
      shaderCode: s.shaderCode,
      shaderInputs: s.shaderInputs ?? [],
      shaderValues: { ...(s.shaderValues ?? {}) },
      ...(s.shaderImageInputs ? { shaderImageInputs: { ...(s.shaderImageInputs as Record<string, never>) } } : {}),
    };
  }
  if ((s.type === 'video' || s.type === 'image') && s.src) {
    return { kind: s.type, name, src: String(s.src), ...(s._assetRef ? { _assetRef: s._assetRef } : {}) };
  }
  return null;
}

/** What a layer shows, as a key: changes only when the content does (not its settings). */
function contentKey(layer: Pick<Layer, 'source'>): string {
  const s = layer.source as (Layer['source'] & Record<string, unknown>) | null | undefined;
  if (!s) return '';
  const code = typeof s.shaderCode === 'string' ? `${s.shaderCode.length}:${s.shaderCode.slice(0, 64)}` : '';
  const sketch = s.jsAnimation ? JSON.stringify((s.jsAnimation as { id?: unknown; code?: unknown }).id ?? String((s.jsAnimation as { code?: unknown }).code ?? '').length) : '';
  return `${s.type}|${s.src ?? ''}|${code}|${sketch}`;
}

interface Open {
  trackId: string;
  media: ShowClipMedia;
  start: number;
}

export function createContentRecorder(host: ContentRecorderHost) {
  const seen = new Map<string, string>();
  /** What each layer showed when last looked at, as block media. */
  const shown = new Map<string, ShowClipMedia | null>();
  const open = new Map<string, Open>();
  let running = false;
  /** Armed with the playhead parked: a swap is cut in at the playhead. */
  let parked = false;
  let runStart = 0;
  let lastTime = 0;

  function close(layerId: string, at: number): void {
    const o = open.get(layerId);
    open.delete(layerId);
    if (o && at - o.start >= SHOW_MIN_TRACK_CLIP_SECONDS) host.write(o.trackId, o.media, o.start, at);
  }

  function closeAll(at: number): void {
    for (const id of [...open.keys()]) close(id, at);
  }

  function snapshot(): void {
    seen.clear();
    shown.clear();
    for (const l of host.layers()) {
      seen.set(l.id, contentKey(l));
      shown.set(l.id, mediaOfLayer(l));
    }
  }

  /** Live edit, parked: each layer that shows other content is cut in at the playhead. */
  function swapParked(): void {
    const person = !host.notAPerson();
    for (const layer of host.layers()) {
      const key = contentKey(layer);
      const prev = seen.get(layer.id);
      if (prev === key) continue;
      seen.set(layer.id, key);
      const media = mediaOfLayer(layer);
      shown.set(layer.id, media);
      if (prev === undefined || !person || !media) continue;
      const trackId = host.rowFor(layer);
      if (trackId) host.swapAt(trackId, media, lastTime);
    }
  }

  return {
    /** Every frame: the show time and whether it plays. */
    tick(time: number, playing: boolean): void {
      const nowParked = !playing && host.armed();
      if (nowParked && !parked) snapshot();
      parked = nowParked;
      if (parked) lastTime = time;
      const active = playing && host.armed();
      if (active && !running) {
        running = true;
        runStart = time;
        lastTime = time;
        snapshot();
        return;
      }
      if (!active && running) {
        running = false;
        closeAll(Math.max(lastTime, time));
        return;
      }
      if (!running) return;
      if (time < lastTime - 1e-6 || time - lastTime > JUMP_SECONDS) {
        // A loop, a seek or a section jump: each open block ends where the
        // show was and carries on from the new place.
        const carried = [...open.entries()];
        closeAll(lastTime);
        for (const [id, o] of carried) open.set(id, { ...o, start: time });
        runStart = time;
      }
      lastTime = time;
    },

    /** The project changed: a layer that shows other content starts a block. */
    observe(): void {
      if (parked) { swapParked(); return; }
      // Not recording: nothing to do (the run takes its own snapshot).
      if (!running) return;
      const person = !host.notAPerson();
      for (const layer of host.layers()) {
        const key = contentKey(layer);
        const prev = seen.get(layer.id);
        if (prev === key) continue;
        seen.set(layer.id, key);
        const before = shown.get(layer.id) ?? null;
        shown.set(layer.id, mediaOfLayer(layer));
        if (prev === undefined || !person) continue;
        const t = lastTime;
        const trackId = host.rowFor(layer);
        if (!trackId) continue;
        // The first change on an empty row: what it showed before, from the start of the take.
        const row = host.tracks().find((r) => r.id === trackId);
        if (!open.has(layer.id) && before && row && row.clips.length === 0 && t - runStart >= SHOW_MIN_TRACK_CLIP_SECONDS) {
          host.write(trackId, before, runStart, t);
        }
        close(layer.id, t);
        const media = shown.get(layer.id);
        if (media) open.set(layer.id, { trackId, media, start: t });
      }
    },

    /** Recording ends now (disarm, stop): open blocks are written. */
    stop(time = lastTime): void {
      if (!running) return;
      running = false;
      closeAll(Math.max(lastTime, time));
    },

    /** Layers with a block being recorded now. */
    recording(): number { return open.size; },
  };
}

export type ContentRecorder = ReturnType<typeof createContentRecorder>;
