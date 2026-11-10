import { describe, expect, it } from 'vitest';
import { findFit, lineCount, mutationMovesControls } from './transportFit';

/** A fake element whose children have these [top, height] boxes. */
const row = (boxes: Array<[number, number]>) => ({
  children: boxes.map(([top, height]) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, width: height ? 20 : 0, height }) })),
}) as unknown as Element;

describe('show transport fit', () => {
  it('counts lines, with controls of different heights centred on one line', () => {
    expect(lineCount(row([]))).toBe(0);
    expect(lineCount(row([[635, 26], [640, 15], [639, 18], [667 - 30, 26]]))).toBe(1);
    expect(lineCount(row([[635, 26], [640, 15], [667, 26], [672, 15]]))).toBe(2);
    // Hidden controls (no box) do not count.
    expect(lineCount(row([[635, 26], [700, 0]]))).toBe(1);
    expect(lineCount(row([[0, 26], [32, 26], [64, 26]]))).toBe(3);
  });

  it('steps up until one line, and stops there', async () => {
    const applied: number[] = [];
    const linesAt = [2, 2, 1, 1, 1];
    let level = 0;
    const got = await findFit(4, (l) => { level = l; applied.push(l); }, () => linesAt[level]);
    expect(got).toBe(2);
    expect(applied).toEqual([0, 1, 2]);
    expect(level).toBe(2);
  });

  it('roomy already: level 0', async () => {
    let level = -1;
    expect(await findFit(4, (l) => { level = l; }, () => 1)).toBe(0);
    expect(level).toBe(0);
  });

  it('when nothing fits on one line, the roomiest level that needs no more lines than the tightest', async () => {
    const linesAt = [3, 2, 2, 2, 2];
    let level = 0;
    const got = await findFit(4, (l) => { level = l; }, () => linesAt[level]);
    expect(got).toBe(1);
    expect(level).toBe(1);
    const same = [2, 2, 2, 2, 2];
    expect(await findFit(4, (l) => { level = l; }, () => same[level])).toBe(0);
    expect(level).toBe(0);
  });

  it('a floating popover and comment anchors do not move controls', () => {
    const el = (ignore: boolean) => ({ nodeType: 1, hasAttribute: (n: string) => ignore && n === 'data-fit-ignore' });
    const comment = { nodeType: 8 };
    const list = (...nodes: unknown[]) => nodes as unknown as NodeList;
    expect(mutationMovesControls({ addedNodes: list(el(true), comment), removedNodes: list() })).toBe(false);
    expect(mutationMovesControls({ addedNodes: list(), removedNodes: list(el(false)) })).toBe(true);
    expect(mutationMovesControls({ addedNodes: list({ nodeType: 3 }), removedNodes: list() })).toBe(true);
  });
});
