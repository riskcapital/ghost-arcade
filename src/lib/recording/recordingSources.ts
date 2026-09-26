// What a desktop recording captures and how it is encoded.
//
// Pure helpers plus two small stores, kept free of the project / VJ stores so
// the native sync can import the Screen list without an import cycle.
import { writable } from 'svelte/store';

export type RecordingCodecId = 'h264' | 'prores_hq' | 'prores_4444' | 'hap' | 'hap_alpha';

export interface RecordingCodecOption {
  id: RecordingCodecId;
  label: string;
  extension: 'mp4' | 'mov';
  mime: string;
  /** Keeps transparency: empty regions record with alpha 0. */
  alpha: boolean;
  /** False when the bundled FFmpeg cannot encode it (set by the probe). */
  available: boolean;
  reason?: string;
}

/** Mirrors electron/recording-formats.cjs. H.264 is the default and the
 *  only codec assumed available before the desktop probe answers. */
export const RECORDING_CODEC_OPTIONS: readonly RecordingCodecOption[] = [
  { id: 'h264', label: 'H.264 (MP4)', extension: 'mp4', mime: 'video/mp4', alpha: false, available: true },
  { id: 'prores_hq', label: 'ProRes 422 HQ (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: false, available: false },
  { id: 'prores_4444', label: 'ProRes 4444 with alpha (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: true, available: false },
  { id: 'hap', label: 'HAP (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: false, available: false },
  { id: 'hap_alpha', label: 'HAP Alpha (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: true, available: false },
];

export function recordingCodecOption(id: string | null | undefined): RecordingCodecOption {
  return RECORDING_CODEC_OPTIONS.find(option => option.id === id) ?? RECORDING_CODEC_OPTIONS[0];
}

/** Merge the desktop probe's answer into the static list (unknown ids from a
 *  newer main process are ignored; missing ones stay unavailable). */
export function mergeRecordingCodecAvailability(
  probed: ReadonlyArray<{ id: string; available?: boolean; reason?: string }> | null | undefined,
): RecordingCodecOption[] {
  return RECORDING_CODEC_OPTIONS.map((option) => {
    const found = probed?.find(entry => entry.id === option.id);
    if (!found) return { ...option };
    return { ...option, available: found.available === true || option.id === 'h264', reason: found.reason };
  });
}

/** Composition (as always), one layer, one VJ layer, or one Screen output. */
export type RecordingSource =
  | { kind: 'composition'; label?: string }
  | { kind: 'layer'; layerIds: string[]; label?: string }
  | { kind: 'screen'; sliceId: string; label?: string };

export interface RecordingSourceOption {
  key: string;
  label: string;
  group: 'Composition' | 'VJ layers' | 'Layers' | 'Screens';
  source: RecordingSource;
}

export const COMPOSITION_SOURCE: RecordingSource = { kind: 'composition', label: 'Composition' };

/** Stable id of the canonical native layer(s) for a VJ row: the row's own
 *  layer, or its per-bank layer when the A/B crossfader is on. Clip
 *  transitions keep these ids on their carrier, so a take survives them. */
export function vjRowLayerIds(index: number): string[] {
  return [`vj-layer-${index}`, `vj-layer-${index}-A`, `vj-layer-${index}-B`];
}

export function recordingSourceKey(source: RecordingSource): string {
  if (source.kind === 'screen') return `screen:${source.sliceId}`;
  if (source.kind === 'layer') return `layer:${source.layerIds.join('|')}`;
  return 'composition';
}

export function listRecordingSources(input: {
  vjLayers?: ReadonlyArray<{ index: number; name?: string | null }>;
  layers?: ReadonlyArray<{ id: string; name?: string | null; type?: string }>;
  screens?: ReadonlyArray<{ id: string; name?: string | null; enabled?: boolean }>;
}): RecordingSourceOption[] {
  const options: RecordingSourceOption[] = [
    { key: 'composition', label: 'Composition', group: 'Composition', source: COMPOSITION_SOURCE },
  ];
  for (const row of input.vjLayers ?? []) {
    const label = `VJ Layer ${row.index + 1}${row.name ? ` · ${row.name}` : ''}`;
    const source: RecordingSource = { kind: 'layer', layerIds: vjRowLayerIds(row.index), label: `VJ Layer ${row.index + 1}` };
    options.push({ key: recordingSourceKey(source), label, group: 'VJ layers', source });
  }
  for (const layer of input.layers ?? []) {
    // A mask layer has no picture of its own.
    if (!layer?.id || layer.type === 'mask') continue;
    const name = layer.name?.trim() || 'Layer';
    const source: RecordingSource = { kind: 'layer', layerIds: [layer.id], label: name };
    options.push({ key: recordingSourceKey(source), label: name, group: 'Layers', source });
  }
  for (const screen of input.screens ?? []) {
    if (!screen?.id || screen.enabled === false) continue;
    const name = screen.name?.trim() || 'Screen';
    const source: RecordingSource = { kind: 'screen', sliceId: screen.id, label: name };
    options.push({ key: recordingSourceKey(source), label: `${name} output`, group: 'Screens', source });
  }
  return options;
}

/** A remembered source that no longer exists (layer deleted, Screen
 *  removed) falls back to the composition rather than failing at REC. */
export function resolveRecordingSourceChoice(
  source: RecordingSource | null | undefined,
  options: ReadonlyArray<RecordingSourceOption>,
): RecordingSource {
  if (!source) return COMPOSITION_SOURCE;
  const key = recordingSourceKey(source);
  return options.find(option => option.key === key)?.source ?? COMPOSITION_SOURCE;
}

/** What the recorder asks the main process for, and what to call the file. */
export function recordingRequest(source: RecordingSource, codecId: string | null | undefined): {
  codec: RecordingCodecOption;
  source: RecordingSource;
  /** Main-process / core read path: program output, record target, or a
   *  Screen's slice output. */
  captureSource: 'output' | 'record_target' | `slice:${string}`;
  alpha: boolean;
  label: string;
} {
  const codec = recordingCodecOption(codecId);
  if (source.kind === 'screen') {
    // A Screen output is what the projector shows: always opaque.
    return { codec, source, captureSource: `slice:${source.sliceId}`, alpha: false, label: source.label ?? 'Screen' };
  }
  if (source.kind === 'layer') {
    return { codec, source, captureSource: 'record_target', alpha: codec.alpha, label: source.label ?? 'Layer' };
  }
  return {
    codec,
    source,
    captureSource: codec.alpha ? 'record_target' : 'output',
    alpha: codec.alpha,
    label: 'Composition',
  };
}

/** The core record target for a request, or null when it reads the program
 *  output or a Screen. Same params the main process sends. */
export function recordTargetParams(source: RecordingSource, alpha: boolean): Record<string, unknown> | null {
  if (source.kind === 'layer') return { kind: 'layer', layer_ids: source.layerIds, alpha };
  if (source.kind === 'composition' && alpha) return { kind: 'composition', alpha: true };
  return null;
}

/** The source picked in the recording menu (per session, not persisted:
 *  layer ids belong to the open show). */
export const recordingSource = writable<RecordingSource>(COMPOSITION_SOURCE);

/** Screens being recorded right now. The native sync renders these even
 *  when their projector window is closed, so a Screen can be recorded
 *  without being on a display. */
export const recordingScreenIds = writable<string[]>([]);

export function holdRecordingScreen(sliceId: string): () => void {
  recordingScreenIds.update(ids => (ids.includes(sliceId) ? ids : [...ids, sliceId]));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    recordingScreenIds.update(ids => ids.filter(id => id !== sliceId));
  };
}
