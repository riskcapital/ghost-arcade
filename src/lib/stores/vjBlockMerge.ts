/**
 * Merging one VJ block's clips into another, one deck grid at a time.
 *
 * Each clip keeps its row (layer). It goes in the same column when that cell
 * is free, otherwise in the first column of the row still free once those
 * have been placed. A clip already in
 * the row (a duplicated block shares clips) is not added twice. Clips with
 * no free cell left stay behind, in `rest`, at their old place.
 */
export interface ClipGridMerge<T extends { id: string }> {
  grid: (T | null)[][];
  rest: (T | null)[][];
  moved: number;
  leftOver: number;
}

export function mergeClipGrids<T extends { id: string }>(
  target: (T | null)[][],
  source: (T | null)[][],
): ClipGridMerge<T> {
  const grid = target.map((row) => [...row]);
  const rest = source.map((row) => row.map(() => null as T | null));
  let moved = 0;
  let leftOver = 0;
  const overflow: Array<{ clip: T; layer: number; column: number }> = [];
  // First every clip whose own cell is free, so columns stay lined up for
  // column launches; then the rest into the free cells left in their row.
  source.forEach((row, layer) => {
    row.forEach((clip, column) => {
      if (!clip) return;
      const targetRow = grid[layer];
      if (targetRow?.some((existing) => existing?.id === clip.id)) return;
      if (targetRow && column < targetRow.length && !targetRow[column]) {
        targetRow[column] = clip;
        moved += 1;
      } else {
        overflow.push({ clip, layer, column });
      }
    });
  });
  for (const { clip, layer, column } of overflow) {
    const targetRow = grid[layer];
    const free = targetRow ? targetRow.findIndex((existing) => !existing) : -1;
    if (targetRow && free >= 0) {
      targetRow[free] = clip;
      moved += 1;
    } else {
      rest[layer][column] = clip;
      leftOver += 1;
    }
  }
  return { grid, rest, moved, leftOver };
}
