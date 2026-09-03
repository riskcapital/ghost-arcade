import { describe, expect, it } from 'vitest';
import { createVjOscTemplateBindings } from './oscBindings';

/**
 * A user reported that /ghost/vj/a/column/1 "acts only on individual layers",
 * and worked around it by duplicating a per-clip mapping onto every layer.
 *
 * The column endpoint does exist and does fire the whole column — it routes to
 * vjClipLauncher.triggerColumn, which maps over every layer state in one update.
 * What did not exist was coverage: the template was pinned to a 4x8 deck while
 * decks are resizable at runtime, so anyone who added layers or columns got
 * nothing for the new cells. A missing binding is indistinguishable from a
 * broken feature at the far end of an OSC cable.
 */
describe('VJ OSC template', () => {
  it('emits one column trigger per column, per deck', () => {
    const bindings = createVjOscTemplateBindings(4, 8);
    for (const bank of ['a', 'b']) {
      for (let column = 1; column <= 8; column += 1) {
        const found = bindings.find((b) => b.address === `/ghost/vj/${bank}/column/${column}`);
        expect(found, `no binding for /ghost/vj/${bank}/column/${column}`).toBeTruthy();
        // Column paths carry no layer segment — that is what makes them fire
        // the whole column rather than one cell.
        expect(found!.path).toBe(`${bank === 'a' ? 'vj' : 'vj-b'}:column:${column - 1}`);
        expect(found!.mode).toBe('trigger');
      }
    }
  });

  it('covers a deck that has been grown past the old 4x8 default', () => {
    // addLayer/addColumn let a set run at 6x12; the template used to stop at 4x8
    // and leave columns 9-12 with no binding at all.
    const bindings = createVjOscTemplateBindings(6, 12);

    for (let column = 9; column <= 12; column += 1) {
      expect(
        bindings.some((b) => b.address === `/ghost/vj/a/column/${column}`),
        `column ${column} has no trigger, so a grown deck looks broken over OSC`,
      ).toBe(true);
    }
    expect(
      bindings.some((b) => b.address === '/ghost/vj/a/layer/6/clip/12'),
      'layer 6 / clip 12 has no binding',
    ).toBe(true);
  });

  it('addresses are 1-based while paths stay 0-based', () => {
    // The off-by-one between the wire address and the store path is the kind of
    // thing that silently fires the wrong column.
    const bindings = createVjOscTemplateBindings(2, 2);
    const first = bindings.find((b) => b.address === '/ghost/vj/a/column/1');
    expect(first!.path).toBe('vj:column:0');
  });
});
