/**
 * Names and thumbnails for the visuals Ableton links fire, shared by the
 * tray's views. Pure functions over the launcher and snapshot state so the
 * views re-render when either changes.
 */

import type { VisualAction } from './abletonLinks';
import type { VJClip, VJDeck } from '../stores/vjClipLauncher';
import type { Snapshot } from '../stores/snapshots';

export interface VisualContext {
  clipGrid: (VJClip | null)[][];
  bankBClipGrid: (VJClip | null)[][];
  numColumns: number;
  snapshots: Snapshot[];
}

export interface ShelfItem { key: string; label: string; hint: string; thumbnail?: string; action: VisualAction }
export type ShelfTab = 'columns' | 'clips' | 'snapshots';

function gridFor(ctx: VisualContext, deck: VJDeck) {
  return deck === 'B' ? ctx.bankBClipGrid : ctx.clipGrid;
}

export function actionThumb(ctx: VisualContext, action: VisualAction): string | undefined {
  if (action.kind === 'snapshot' || action.kind === 'control') return undefined;
  const grid = gridFor(ctx, action.deck);
  if (action.kind === 'clip') return grid[action.layer]?.[action.column]?.thumbnail;
  return grid.map(row => row?.[action.column]).find(c => c?.thumbnail)?.thumbnail;
}

/** Short tag shown where there is no thumbnail. */
export function actionTag(action: VisualAction): string {
  if (action.kind === 'snapshot') return `S${action.slot + 1}`;
  if (action.kind === 'control') return 'FX';
  return '·';
}

export function actionLabel(ctx: VisualContext, action: VisualAction): string {
  if (action.kind === 'control') return action.label;
  if (action.kind === 'snapshot') {
    const snap = ctx.snapshots[action.slot];
    return snap?.capturedAt ? snap.name || `Snapshot ${action.slot + 1}` : `Snapshot ${action.slot + 1} (empty)`;
  }
  const deckSuffix = action.deck === 'B' ? ' · B' : '';
  if (action.kind === 'column') return `Column ${action.column + 1}${deckSuffix}`;
  return `${gridFor(ctx, action.deck)[action.layer]?.[action.column]?.name ?? 'Empty slot'}${deckSuffix}`;
}

export function actionHint(action: VisualAction): string {
  if (action.kind === 'control') return 'Control hit';
  if (action.kind === 'snapshot') return `Snapshot slot ${action.slot + 1}`;
  if (action.kind === 'column') return 'Whole column';
  return `Layer ${action.layer + 1} · Column ${action.column + 1}`;
}

export function buildShelf(ctx: VisualContext, tab: ShelfTab, deck: VJDeck): ShelfItem[] {
  if (tab === 'snapshots') {
    return ctx.snapshots.flatMap((snap, slot) => snap.capturedAt ? [{
      key: `snap-${slot}`, label: snap.name || `Snapshot ${slot + 1}`, hint: `Slot ${slot + 1}`,
      action: { kind: 'snapshot', slot } as VisualAction,
    }] : []);
  }
  const grid = gridFor(ctx, deck);
  if (tab === 'columns') {
    return Array.from({ length: ctx.numColumns }, (_, column) => {
      const clips = grid.map(row => row?.[column]).filter(Boolean) as VJClip[];
      return {
        key: `col-${deck}-${column}`, label: `Column ${column + 1}`,
        hint: clips.length ? clips.map(c => c.name).join(', ') : 'Empty',
        thumbnail: clips.find(c => c.thumbnail)?.thumbnail,
        action: { kind: 'column', deck, column } as VisualAction,
      };
    });
  }
  return grid.flatMap((row, layer) => (row ?? []).flatMap((clip, column) => clip ? [{
    key: `clip-${deck}-${layer}-${column}`, label: clip.name, hint: `L${layer + 1} · C${column + 1}`,
    thumbnail: clip.thumbnail,
    action: { kind: 'clip', deck, layer, column } as VisualAction,
  }] : []));
}

/** The drag payload type the tray's drop targets accept. */
export const VISUAL_DRAG_TYPE = 'application/x-ghost-visual';
