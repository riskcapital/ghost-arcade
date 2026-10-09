import { describe, expect, it } from 'vitest';
import { secondFingerTaps } from './secondFingerTaps';

/** Just enough of an element tree for the action: events, closest, contains, click. */
function button(id: string, extra: { disabled?: boolean; inPad?: boolean } = {}) {
  const clicks: string[] = [];
  const node: any = {
    id, disabled: !!extra.disabled, clicks,
    closest: (selector: string) => (selector === '.flux-pad' ? (extra.inPad ? {} : null) : node),
    click: () => clicks.push(id),
  };
  return node;
}
function rootOf(buttons: any[]) {
  const listeners = new Map<string, (e: any) => void>();
  const root: any = {
    addEventListener: (type: string, fn: (e: any) => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    contains: (node: any) => buttons.includes(node),
  };
  const send = (type: string, target: any, id: number, primary: boolean, x = 10) =>
    listeners.get(type)?.({ pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: 10, target });
  return { root, send };
}

describe('second finger taps', () => {
  it('clicks the button a second finger lifts on, and leaves a lone finger to its own click', () => {
    const a = button('a'), b = button('b', { disabled: true }), c = button('c', { inPad: true });
    const { root, send } = rootOf([a, b, c]);
    const action = secondFingerTaps(root);

    send('pointerdown', a, 1, true); send('pointerup', a, 1, true);
    expect(a.clicks).toEqual([]);                 // the browser clicks for a lone finger

    send('pointerdown', a, 2, false); send('pointerup', a, 2, false);
    expect(a.clicks).toEqual(['a']);

    send('pointerdown', a, 3, false); send('pointerup', a, 3, false, 60);
    expect(a.clicks).toEqual(['a']);              // it slid: not a tap

    send('pointerdown', b, 4, false); send('pointerup', b, 4, false);
    send('pointerdown', c, 5, false); send('pointerup', c, 5, false);
    expect([b.clicks, c.clicks]).toEqual([[], []]); // disabled, and the pad plays itself

    action.destroy();
    send('pointerdown', a, 6, false); send('pointerup', a, 6, false);
    expect(a.clicks).toEqual(['a']);
  });
});
