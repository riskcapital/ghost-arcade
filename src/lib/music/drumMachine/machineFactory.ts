/**
 * Factory beats for the drum machine. Rows are written as text, one
 * character per sixteenth: x = hit, X = accent, o = soft, r = a roll of
 * three, . = rest. A row shorter than the part loops on its own length.
 */

import { emptyPart, newId, type Beat, type Part, type PartBars, type PartKind } from './machineBeat';
import { PAD_COUNT } from './machineKits';

function part(name: string, kind: PartKind, rows: Record<number, string>, opts: { bars?: PartBars; swing?: number } = {}): Part {
  const p = emptyPart(name, kind, opts.bars ?? 1);
  p.swing = opts.swing ?? 0;
  const steps = p.bars * 16;
  for (const [pad, row] of Object.entries(rows)) {
    const t = p.tracks[Number(pad)];
    t.length = Math.min(row.length, steps);
    for (let i = 0; i < t.length; i++) {
      const c = row[i];
      t.vel[i] = c === 'X' ? 1 : c === 'x' ? 0.8 : c === 'o' ? 0.45 : c === 'r' ? 0.75 : 0;
      t.roll[i] = c === 'r' ? 3 : 1;
    }
  }
  return p;
}

function beat(name: string, kitId: string, parts: Part[], song: Array<[number, number]>): Beat {
  return {
    name,
    kitId,
    parts,
    song: song.map(([i, bars]) => ({ id: newId('blk'), partId: parts[i].id, bars })),
    padLevel: new Array(PAD_COUNT).fill(0.5),
    padTune: new Array(PAD_COUNT).fill(0.5),
  };
}

/** Pads are in kit order: 0-1 kicks, 2 snare, 3 clap, 4 hat, 5 open hat, then percussion. */
export function factoryBeats(): Beat[] {
  return [
    beat('Four to the floor', 'mk.warehouse', [
      part('Loop', 'loop', { 0: 'X...X...X...X...', 2: '....x.......x...', 4: '..x...x...x...x.', 7: 'o.o.o.o.o.o.o.o.' }),
      part('Build', 'build', { 0: 'X...X...X...X...', 2: 'x.x.x.x.xxxxrrrr', 4: 'xxxxxxxxxxxxxxxx', 14: 'X...............' }),
      part('Break', 'break', { 4: '..x...x...x...x.', 6: 'X...............', 9: '...x..x...x..x..' }),
      part('Drop', 'drop', { 0: 'X...X...X...X...', 1: 'X...............', 2: '....x.......x...', 5: '..x...x...x...x.', 6: 'x.x.x.x.x.x.x.x.', 14: 'X...............' }),
    ], [[0, 8], [1, 4], [2, 4], [3, 8]]),
    beat('Breakbeat', 'mk.boom-bap', [
      part('Loop', 'loop', { 0: 'X.x.......x.....', 2: '....X..o.o..X..o', 4: 'x.x.x.x.x.x.x.x.', 5: '..............x.' }, { swing: 0.18 }),
      part('Fill', 'fill', { 0: 'X.x.......x.....', 2: '....X..o.oxrX.xr', 10: '..........x.x...' }, { swing: 0.18 }),
      part('Break', 'break', { 2: '....X.......X...', 4: 'x.x.x.x.x.x.x.x.', 8: 'x..x..x..x..x...' }, { swing: 0.18 }),
    ], [[0, 3], [1, 1], [0, 3], [2, 1]]),
    beat('Clave groove', 'mk.latin-hands', [
      part('Loop', 'loop', {
        0: 'X.......X.......', 1: '..x...x...x...x.', 2: '....x.......x...', 3: '.x...xx..x...xx.',
        8: 'x..x..x...x.x...', 12: 'x.x.x.xx.xx.x.x.', 14: 'x.....x.........', 10: 'x...x...x...x...',
      }),
      part('Bongo solo', 'fill', { 4: 'x.xxx.xxx.xxrxrx', 5: '.x...x...x...x.x', 8: 'x..x..x...x.x...' }),
      part('Break', 'break', { 8: 'x..x..x...x.x...', 12: 'xxxxxxxxxxxxxxxx', 15: '........x.......' }),
    ], [[0, 4], [1, 1], [0, 3], [2, 2]]),
    beat('Electro', 'mk.electro-funk', [
      part('Loop', 'loop', { 0: 'X.....X...x.....', 3: '....X.......X...', 4: 'x.xxx.xxx.xxx.xx', 6: '...x......x...x.', 8: '..........x.....' }),
      part('Lasers', 'fill', { 0: 'X.....X...x.....', 3: '....X.......X...', 8: 'x..x..x.x..x.x.x', 9: '..x...x...x..x..' }),
    ], [[0, 4], [1, 2], [0, 4]]),
    beat('Half time', 'mk.big-room', [
      part('Loop', 'loop', { 0: 'X.........x.....', 2: '........X.......', 4: 'x.x.x.x.x.x.x.x.', 9: '..x.....' }, { bars: 1 }),
      part('Build', 'build', { 2: 'x...x...x.x.xxxx', 9: 'xxxxxxxxxxxxrrrr', 14: '........' }),
    ], [[0, 6], [1, 2]]),
    beat('Odd meters', 'mk.metal-garden', [
      part('Loop', 'loop', { 0: 'X.......', 2: '....x...', 4: 'x.x', 8: 'x....', 9: 'x......', 10: 'x...........', 13: 'x..x.' }),
    ], [[0, 8]]),
  ];
}
