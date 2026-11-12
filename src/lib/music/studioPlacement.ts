/** Where the studio's visuals go on the deck when the music starts. Pure, for tests. */

/** The first row playing nothing that has a free cell, and that cell. */
export function idleRowCell(grid: readonly (readonly unknown[])[], states: readonly ({ activeClip?: unknown } | null | undefined)[]): { layer: number; column: number } | null {
  for (let layer = 0; layer < grid.length; layer++) {
    if (states[layer]?.activeClip) continue;
    const column = grid[layer]?.findIndex((c) => !c) ?? -1;
    if (column >= 0) return { layer, column };
  }
  return null;
}
