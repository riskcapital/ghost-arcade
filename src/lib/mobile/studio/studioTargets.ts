/**
 * Where an Interactive scene lives in the VJ clip grid.
 *
 * Opening the Studio, or a phone going live, must never put a new clip on the
 * output by itself or take over a clip someone else authored. These helpers
 * only choose a slot; the caller decides whether anything is launched.
 */
export type InteractiveClipLike = {
  id: string;
  effectSource?: { interactiveScene?: unknown; interactiveRemote?: string } | null;
} | null | undefined;

/** A clip authored in the desktop Studio (phone-owned clips are not offered). */
export function isDesktopInteractiveClip(clip: InteractiveClipLike): boolean {
  return !!clip?.effectSource?.interactiveScene && !clip.effectSource.interactiveRemote;
}

export function isPhoneInteractiveClip(clip: InteractiveClipLike, phone?: string): boolean {
  const owner = clip?.effectSource?.interactiveRemote;
  return !!clip?.effectSource?.interactiveScene && !!owner && (phone === undefined || owner === phone);
}

export type EditorClipSlot = { col: number; create: boolean; addColumn: boolean };

/**
 * The clip the desktop Studio edits in one VJ row: the Interactive clip that
 * is playing, else the first Interactive clip already in the row, else a new
 * clip in the first free slot. A column is added only when a new clip is
 * needed and the row is full, so reopening never grows the grid.
 */
export function pickEditorClipSlot(
  rowClips: InteractiveClipLike[],
  activeColumn: number | null | undefined,
  numColumns: number,
  maxColumns = 64,
): EditorClipSlot | null {
  if (typeof activeColumn === 'number' && isDesktopInteractiveClip(rowClips[activeColumn])) {
    return { col: activeColumn, create: false, addColumn: false };
  }
  const existing = rowClips.findIndex((clip) => isDesktopInteractiveClip(clip));
  if (existing >= 0) return { col: existing, create: false, addColumn: false };
  for (let col = 0; col < numColumns; col++) {
    if (!rowClips[col]) return { col, create: true, addColumn: false };
  }
  if (numColumns >= maxColumns) return null;
  return { col: numColumns, create: true, addColumn: true };
}

/** With no VJ row selected: the row that already holds a desktop Interactive
 *  clip (a playing one first), else row 0. */
export function pickEditorClipRow(
  grid: InteractiveClipLike[][],
  activeColumns: (number | null | undefined)[],
): number {
  const playing = grid.findIndex((row, index) => {
    const active = activeColumns[index];
    return typeof active === 'number' && isDesktopInteractiveClip(row[active]);
  });
  if (playing >= 0) return playing;
  const holding = grid.findIndex((row) => row.some((clip) => isDesktopInteractiveClip(clip)));
  return holding >= 0 ? holding : 0;
}

export type PhoneClipSlot = { row: number; col: number; create: boolean; launch: boolean };

/**
 * The clip a paired phone drives. Its own clip is reused wherever it is.
 * A new one goes to the first row that is not playing anything, and is
 * launched there; if every row is busy it is placed in the first free slot
 * and left for the operator to launch. Columns are never added and a playing
 * clip is never replaced.
 */
export function pickPhoneClipSlot(
  grid: InteractiveClipLike[][],
  activeColumns: (number | null | undefined)[],
  phone: string,
  numColumns: number,
): PhoneClipSlot | null {
  const rowIdle = (row: number) => typeof activeColumns[row] !== 'number';
  for (let row = 0; row < grid.length; row++) {
    const col = grid[row].findIndex((clip) => isPhoneInteractiveClip(clip, phone));
    if (col >= 0) return { row, col, create: false, launch: rowIdle(row) || activeColumns[row] === col };
  }
  const freeSlot = (row: number) => {
    for (let col = 0; col < numColumns; col++) if (!grid[row][col]) return col;
    return -1;
  };
  for (let row = 0; row < grid.length; row++) {
    const col = freeSlot(row);
    if (col >= 0 && rowIdle(row)) return { row, col, create: true, launch: true };
  }
  for (let row = 0; row < grid.length; row++) {
    const col = freeSlot(row);
    if (col >= 0) return { row, col, create: true, launch: false };
  }
  return null;
}
