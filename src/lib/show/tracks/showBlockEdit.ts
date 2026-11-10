/**
 * Editing a block in the normal panels.
 *
 * Clicking a block on a row selects its piece and points the panels that edit
 * a layer's picture (Shader Parameters, the sketch controls, Properties'
 * opacity and blend mode) at the block instead: they show the block's own
 * values and their edits go into the block, never into the project's layer
 * (the show never writes the project). The scene picks the new values up at
 * once, playing or paused, because they are part of the block.
 *
 * The piece's own effects and edge effects stay the layer's and are edited
 * as always.
 *
 * `activeBlock` is the block being edited, or null: a single block selected
 * on the show whose piece is the selected layer (or, for a piece the current
 * look does not have, with no layer selected).
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import type { BlendMode, ImageInputRef, Layer, MediaSource, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { showTimeline } from '../../stores/showTimeline';
import { project, layers as liveLayers, selectedLayerId } from '../../stores/layers';
import { showSlice, distinct } from '../../components/show/timeline/timelineSlices';
import { staticClipSource, readableClipUri } from './showClipSources';
import { stagePieceLayer } from './showStagePieces';

export interface BlockEditTarget {
  trackId: string;
  clipId: string;
  layerId: string;
}

export interface ActiveBlock extends BlockEditTarget {
  track: ShowLayerTrack;
  clip: ShowLayerClip;
  /** The piece as the panels should show it: its shape, effects and
   *  settings, with the block's picture, opacity and blend mode. */
  layer: Layer;
  /** The piece is in the current look. */
  onStage: boolean;
}

const target = writable<BlockEditTarget | null>(null);
export const blockEditTarget: Readable<BlockEditTarget | null> = { subscribe: target.subscribe };

/** Start editing a block (a click on it). Selects its piece. */
export function editBlock(track: Pick<ShowLayerTrack, 'id' | 'layerId'>, clip: Pick<ShowLayerClip, 'id'>): void {
  target.set({ trackId: track.id, clipId: clip.id, layerId: track.layerId });
  const onStage = get(project).layers.some((l) => l.id === track.layerId);
  // A piece the current look lacks has no layer to select: the panels show
  // the block alone.
  project.selectLayer(onStage ? track.layerId : null);
}

/** Stop editing the block (the panels go back to the selected layer). */
export function stopEditingBlock(): void {
  target.set(null);
}

/** The block's picture as a layer source the panels can read. */
export function blockSource(media: ShowClipMedia, clipId: string, own: Layer['source']): Layer['source'] {
  const id = `show-block:${clipId}`;
  if (media.kind === 'layer') return own;
  if (media.kind === 'video') {
    return { id, type: 'video', src: readableClipUri(media), name: media.name, _assetRef: media._assetRef, durationSeconds: media.sourceDuration } as MediaSource;
  }
  // The panels match a shader to the tray by its src: keep it.
  return staticClipSource(media, id) ?? own;
}

/** The piece with the block's picture, opacity and blend mode. */
export function blockPanelLayer(piece: Layer, track: Pick<ShowLayerTrack, 'subRow'>, clip: ShowLayerClip): Layer {
  return {
    ...piece,
    source: blockSource(clip.media, clip.id, piece.source),
    opacity: clip.opacity ?? 1,
    blendMode: clip.blendMode ?? (track.subRow ? 'normal' : piece.blendMode),
  };
}

const selectedIdsSlice = showSlice('selectedClipIds');
const tracksSlice = showSlice('layerTracks');

export const activeBlock: Readable<ActiveBlock | null> = derived(
  [target, tracksSlice, selectedIdsSlice, distinct(selectedLayerId), distinct(liveLayers)],
  ([$target, $tracks, $selected, $layerId, $layers]) => {
    if (!$target) return null;
    if ($selected.length !== 1 || $selected[0] !== $target.clipId) return null;
    const track = $tracks.find((t) => t.id === $target.trackId && t.clips.some((c) => c.id === $target.clipId))
      ?? $tracks.find((t) => t.clips.some((c) => c.id === $target.clipId));
    if (!track) return null;
    const clip = track.clips.find((c) => c.id === $target.clipId)!;
    const live = $layers.find((l) => l.id === track.layerId) ?? null;
    const onStage = !!live;
    if (onStage ? $layerId !== track.layerId : $layerId !== null) return null;
    const piece = live ?? track.template ?? stagePieceLayer(track.layerId);
    if (!piece) return null;
    return { trackId: track.id, clipId: clip.id, layerId: track.layerId, track, clip, layer: blockPanelLayer(piece, track, clip), onStage };
  },
);

// ── Edits (block-scoped) ───────────────────────────────────────────────

function current(): ActiveBlock | null {
  return get(activeBlock);
}

function patchMedia(block: ActiveBlock, patch: Partial<ShowClipMedia>, continuous: boolean): void {
  const media = { ...block.clip.media, ...patch };
  showTimeline.updateLayerClip(block.clipId, { media }, { discrete: !continuous });
}

/** A shader input of the block (sliders coalesce into one undo step). */
export function setBlockShaderValue(name: string, value: number | boolean | number[], continuous = true): boolean {
  const block = current();
  if (!block || block.clip.media.kind !== 'shader') return false;
  patchMedia(block, { shaderValues: { ...(block.clip.media.shaderValues ?? {}), [name]: value } }, continuous);
  return true;
}

/** Several shader inputs at once (a reset): one undo step. */
export function setBlockShaderValues(values: Record<string, number | boolean | number[]>): boolean {
  const block = current();
  if (!block || block.clip.media.kind !== 'shader') return false;
  patchMedia(block, { shaderValues: { ...(block.clip.media.shaderValues ?? {}), ...values } }, false);
  return true;
}

export function setBlockShaderImageInput(name: string, ref: ImageInputRef | null): boolean {
  const block = current();
  if (!block || block.clip.media.kind !== 'shader') return false;
  const inputs = { ...(block.clip.media.shaderImageInputs ?? {}) };
  if (ref) inputs[name] = ref;
  else delete inputs[name];
  patchMedia(block, { shaderImageInputs: inputs }, false);
  return true;
}

/** A sketch parameter of the block. */
export function setBlockSketchParam(name: string, value: unknown, continuous = true): boolean {
  const block = current();
  const js = block?.clip.media.jsAnimation;
  if (!block || block.clip.media.kind !== 'sketch' || !js) return false;
  patchMedia(block, { jsAnimation: { ...js, paramValues: { ...(js.paramValues ?? {}), [name]: value } } as typeof js }, continuous);
  return true;
}

export function setBlockOpacity(value: number): boolean {
  const block = current();
  if (!block) return false;
  showTimeline.updateLayerClip(block.clipId, { opacity: Math.max(0, Math.min(1, value)) });
  return true;
}

export function setBlockBlendMode(mode: BlendMode): boolean {
  const block = current();
  if (!block) return false;
  showTimeline.updateLayerClip(block.clipId, { blendMode: mode }, { discrete: true });
  return true;
}
