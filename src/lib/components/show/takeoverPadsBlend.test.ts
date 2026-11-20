import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

const style = { setProperty() {}, removeProperty() {} };
vi.stubGlobal('document', { documentElement: { style, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, dataset: {} }, body: { style, classList: { add() {}, remove() {}, toggle() {} } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style, getContext: () => null, setAttribute() {}, appendChild() {} }) });
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
const { default: TakeoverPads } = await import('./TakeoverPads.svelte');

describe('Perform pads: the overlay Blend select', () => {
  it('shows blend names (Normal, Screen), not the raw values', () => {
    const { body } = render(TakeoverPads, { props: {} });
    const select = body.slice(body.indexOf('aria-label="Overlay blend"'), body.indexOf('</select>', body.indexOf('aria-label="Overlay blend"')));
    expect(select).toMatch(/>Normal</);
    expect(select).not.toMatch(/>normal</);
  });
});
