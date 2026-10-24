/**
 * Merging one VJ block into another.
 *
 * The merged block's columns go after the last column the target uses, in
 * their order, on both decks at the same offset: each column still launches
 * as the same scene, and Deck A and Deck B stay lined up. The grid grows by
 * as many columns as that needs, up to `maxColumns`. A clip already in its
 * row of the target (a duplicated block shares clips) is not added twice.
 * Columns past the limit stay behind, in `rest`, where they were.
 */
type Grid<T> = (T | null)[][];

export interface BlockMergeInput<T extends { id: string }> {
  targetA: Grid<T>;
  targetB: Grid<T>;
  sourceA: Grid<T>;
  sourceB: Grid<T>;
  maxColumns: number;
}

export interface BlockMerge<T extends { id: string }> {
  /** Column count after the merge (never fewer than before). */
  columns: number;
  gridA: Grid<T>;
  gridB: Grid<T>;
  restA: Grid<T>;
  restB: Grid<T>;
  moved: number;
  leftOver: number;
}

const width = <T>(grid: Grid<T>) => grid.reduce((most, row) => Math.max(most, row.length), 0);
const usedColumns = <T>(grid: Grid<T>) => {
  const used = new Set<number>();
  grid.forEach((row) => row.forEach((clip, column) => { if (clip) used.add(column); }));
  return used;
};
const pad = <T>(grid: Grid<T>, columns: number): Grid<T> =>
  grid.map((row) => [...row, ...Array(Math.max(0, columns - row.length)).fill(null)]);

export function mergeBlockGrids<T extends { id: string }>(input: BlockMergeInput<T>): BlockMerge<T> {
  const { targetA, targetB, sourceA, sourceB, maxColumns } = input;
  const before = Math.max(width(targetA), width(targetB), width(sourceA), width(sourceB));
  const targetUsed = new Set([...usedColumns(targetA), ...usedColumns(targetB)]);
  const offset = targetUsed.size ? Math.max(...targetUsed) + 1 : 0;
  // The source's occupied columns, in order, as one list for both decks.
  const sourceColumns = [...new Set([...usedColumns(sourceA), ...usedColumns(sourceB)])].sort((a, b) => a - b);
  const placeable = Math.max(0, Math.min(sourceColumns.length, maxColumns - offset));
  const columns = Math.min(maxColumns, Math.max(before, offset + placeable));

  let moved = 0;
  let leftOver = 0;
  const mergeDeck = (target: Grid<T>, source: Grid<T>) => {
    const grid = pad(target, columns);
    const rest = pad(source.map((row) => row.map(() => null as T | null)), columns);
    sourceColumns.forEach((column, rank) => {
      source.forEach((row, layer) => {
        const clip = row[column];
        if (!clip) return;
        if (!grid[layer] || rank >= placeable) {
          rest[layer][column] = clip;
          leftOver += 1;
          return;
        }
        if (grid[layer].some((existing) => existing?.id === clip.id)) return;
        grid[layer][offset + rank] = clip;
        moved += 1;
      });
    });
    return { grid, rest };
  };
  const a = mergeDeck(targetA, sourceA);
  const b = mergeDeck(targetB, sourceB);
  return { columns, gridA: a.grid, gridB: b.grid, restA: a.rest, restB: b.rest, moved, leftOver };
}
