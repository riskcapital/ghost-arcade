export type PreviewMonitorTile = 'program' | 'deck-a' | 'deck-b';

export interface DisplayFingerprint {
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface PreviewMonitorDisplayLike {
  id: number;
  label?: string;
  scaleFactor?: number;
  bounds?: { width: number; height: number };
  width?: number;
  height?: number;
}

export interface PreviewMonitorTexture {
  surfaceId?: number;
  sharedName?: string;
  width: number;
  height: number;
  frame: number;
  binding: string;
}

export const PREVIEW_MONITOR_TILES: PreviewMonitorTile[];
export const PREVIEW_MONITOR_DECK_WIDTH: number;
export const DEFAULT_DECK_MONITOR_WIDTH: number;
export function previewMonitorViewName(tile: PreviewMonitorTile): string;
export function displayFingerprint(display: PreviewMonitorDisplayLike | null | undefined): DisplayFingerprint | null;
export function findPreviewMonitorDisplay<T extends PreviewMonitorDisplayLike>(
  displays: T[],
  wanted: { displayId: number; fingerprint?: DisplayFingerprint | null } | null,
): T | null;
export function previewMonitorTexture(
  tile: PreviewMonitorTile,
  sources: { output?: unknown; decks?: unknown; windows: boolean; nativePump: boolean },
): PreviewMonitorTexture | null;
