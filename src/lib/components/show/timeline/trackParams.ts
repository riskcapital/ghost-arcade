/**
 * Which parameters a track's keyframe lanes can drive.
 *
 * Discovered on the layer the track drives (the live layer when it is on
 * stage, the track's own copy otherwise) with a shader clip's inputs applied,
 * so a track playing shader clips offers those shaders' inputs. Opacity
 * comes first: it is the lane people reach for.
 */
import type { Layer, MediaSource, ShowLayerTrack } from '../../../types';
import { discoverKeyframeableParams, type KeyframeableParam } from '../../../keyframes/paramDiscovery';

/** The layer the lane picker inspects for `track`. */
export function trackParamLayer(track: ShowLayerTrack, live: Layer | null | undefined): Layer | null {
  const base = live ?? track.template;
  if (!base) return null;
  const shaderClip = track.clips.find((c) => c.media.kind === 'shader' && c.media.shaderInputs?.length);
  if (!shaderClip) return base;
  const media = shaderClip.media;
  const source = {
    ...(base.source ?? {}),
    id: base.source?.id ?? `show-params-${track.id}`,
    type: 'shader',
    src: media.src,
    name: media.name,
    shaderCode: media.shaderCode,
    shaderInputs: media.shaderInputs,
    shaderValues: { ...(media.shaderValues ?? {}) },
  } as MediaSource;
  return { ...base, source };
}

/** Lane-able parameters, opacity first. */
export function trackLaneParams(track: ShowLayerTrack, live: Layer | null | undefined): KeyframeableParam[] {
  const layer = trackParamLayer(track, live);
  if (!layer) return [];
  let params: KeyframeableParam[];
  try {
    params = discoverKeyframeableParams(layer);
  } catch {
    params = [];
  }
  const opacity = params.find((p) => p.key === 'layer:opacity');
  return opacity ? [opacity, ...params.filter((p) => p !== opacity)] : params;
}

export interface TrackLaneInfo {
  /** Lanes whose parameter the layer does not have right now (greyed out). */
  inactive: Set<string>;
  ranges: Record<string, { min: number; max: number }>;
}

export function trackLaneInfo(track: ShowLayerTrack, live: Layer | null | undefined): TrackLaneInfo {
  const params = trackLaneParams(track, live);
  const byKey = new Map(params.map((p) => [p.key, p]));
  const inactive = new Set<string>();
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const lane of track.lanes) {
    const p = byKey.get(lane.key);
    if (!p) inactive.add(lane.key);
    const min = Number(p?.min);
    const max = Number(p?.max);
    ranges[lane.key] = lane.type === 'boolean' || !(Number.isFinite(min) && Number.isFinite(max) && max > min)
      ? { min: 0, max: 1 }
      : { min, max };
  }
  return { inactive, ranges };
}
