// Clip blocks, presented as tabs above the deck (the desktop VJ panel's model: tap a tab to
// switch, "+" adds an empty block, each tab has Rename / Duplicate / Delete, one block always
// remains). The saved set format is unchanged: blocks are `show.scenes`, the open one is
// `show.activeBlockId`, and its clips are `show.launchGrid`.
//
// A set made before blocks were tabs can have no block at all, or blocks with none open. The
// deck is then shown as one more tab that is saved as a real block the first time it matters,
// so switching away never loses the clips that were on screen.

import { copy, type Scene, type Show } from './model';

export const MAX_BLOCKS = 16;

export interface BlockTab {
  /** Empty for the deck that has not been saved as a block yet. */
  id: string;
  name: string;
  active: boolean;
}

type Grid = Show['launchGrid'];
export type BlockState = Pick<Show, 'scenes' | 'activeBlockId' | 'launchGrid'>;

const emptyGrid = (like: Grid): Grid => like.map(() => [null, null, null, null]);
const hasOpenBlock = (show: Show) => !!show.activeBlockId && show.scenes.some((b) => b.id === show.activeBlockId);

function nextName(scenes: Scene[]) {
  const taken = new Set(scenes.map((b) => b.name));
  let n = scenes.length + 1;
  while (taken.has(`Block ${n}`)) n++;
  return `Block ${n}`;
}

function blockFrom(show: Show, id: string, name: string, launchGrid: Grid): Scene {
  return { id, name, launchGrid: copy(launchGrid), layers: copy(show.layers), crossfade: show.crossfade };
}

/** The tabs to draw, in order. Exactly one is active. */
export function blockTabs(show: Show): BlockTab[] {
  const tabs = show.scenes.map((b) => ({ id: b.id, name: b.name, active: b.id === show.activeBlockId }));
  if (!hasOpenBlock(show)) tabs.push({ id: '', name: nextName(show.scenes), active: true });
  return tabs;
}

/** The scenes with the open block's clips written back from the deck. */
function withDeckSaved(show: Show): Scene[] {
  return show.scenes.map((b) => (b.id === show.activeBlockId ? { ...b, launchGrid: copy(show.launchGrid) } : b));
}

/** Saves the deck as a block if it is not one yet. `makeId` supplies the new id. */
export function ensureOpenBlock(show: Show, makeId: () => string): BlockState {
  if (hasOpenBlock(show)) return { scenes: show.scenes, activeBlockId: show.activeBlockId, launchGrid: show.launchGrid };
  const id = makeId();
  return {
    scenes: [...show.scenes, blockFrom(show, id, nextName(show.scenes), show.launchGrid)],
    activeBlockId: id,
    launchGrid: show.launchGrid,
  };
}

/** Adds an empty block after the others. The open block stays open, as on the desktop. */
export function addBlock(show: Show, makeId: () => string): (BlockState & { added: Scene }) | null {
  const base = ensureOpenBlock(show, makeId);
  if (base.scenes.length >= MAX_BLOCKS) return null;
  const added = blockFrom(show, makeId(), nextName(base.scenes), emptyGrid(show.launchGrid));
  return { ...base, scenes: [...base.scenes, added], added };
}

/** Opens another block. The deck is saved into the block being left; playing layers are untouched. */
export function switchBlock(show: Show, id: string, makeId: () => string): BlockState | null {
  const base = ensureOpenBlock(show, makeId);
  const target = base.scenes.find((b) => b.id === id);
  if (!target || id === base.activeBlockId) return null;
  const scenes = withDeckSaved({ ...show, ...base });
  return { scenes, activeBlockId: id, launchGrid: copy(target.launchGrid ?? show.launchGrid) };
}

/** Copies a block, named "<name> (copy)", right after the original. The open block stays open. */
export function duplicateBlock(show: Show, id: string, makeId: () => string): (BlockState & { added: Scene }) | null {
  const base = ensureOpenBlock(show, makeId);
  const sourceId = id || base.activeBlockId;
  const scenes = withDeckSaved({ ...show, ...base });
  const index = scenes.findIndex((b) => b.id === sourceId);
  if (index < 0 || scenes.length >= MAX_BLOCKS) return null;
  const source = scenes[index];
  const added: Scene = { ...copy(source), id: makeId(), name: `${source.name} (copy)`.slice(0, 80) };
  return { ...base, scenes: [...scenes.slice(0, index + 1), added, ...scenes.slice(index + 1)], added };
}

/** Deletes a block. The last one cannot go. Deleting the open block opens the first one left. */
export function deleteBlock(show: Show, id: string, makeId: () => string): (BlockState & { removed: Scene }) | null {
  const base = ensureOpenBlock(show, makeId);
  const targetId = id || base.activeBlockId;
  const removed = base.scenes.find((b) => b.id === targetId);
  if (!removed || base.scenes.length <= 1) return null;
  const scenes = base.scenes.filter((b) => b.id !== targetId);
  if (targetId !== base.activeBlockId) return { ...base, scenes, removed };
  const first = scenes[0];
  return { scenes, activeBlockId: first.id, launchGrid: copy(first.launchGrid ?? show.launchGrid), removed };
}

/**
 * Moves a block to another place in the tab row. The open block stays open and the deck is
 * untouched. A set whose deck is not a block yet gets it saved first, so every tab can move.
 */
export function moveBlock(show: Show, from: number, to: number, makeId: () => string): BlockState | null {
  const base = ensureOpenBlock(show, makeId);
  const last = base.scenes.length - 1;
  const target = Math.max(0, Math.min(last, Math.round(to)));
  if (!Number.isInteger(from) || from < 0 || from > last || from === target) return null;
  const scenes = [...base.scenes];
  const [block] = scenes.splice(from, 1);
  scenes.splice(target, 0, block);
  return { ...base, scenes };
}
