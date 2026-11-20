import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// The panel's imports read settings at load (the page's root style).
const style = { setProperty() {}, removeProperty() {} };
vi.stubGlobal('document', { documentElement: { style, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, dataset: {} }, body: { style, classList: { add() {}, remove() {}, toggle() {} } }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style, getContext: () => null, setAttribute() {}, appendChild() {} }) });
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
const { cueList } = await import('../../show/cueList');
const { default: CueListPanel } = await import('./CueListPanel.svelte');

/**
 * Perform numbers every step once (07 in the list, Q7 on the GO card). Its
 * cue editor showed the cue's own number (1) in a "No." field beside them.
 */
describe('the cue editor in Perform', () => {
  it('shows the step\'s Q number, not a second numbering', () => {
    const id = cueList.addCue({}, null);
    cueList.select(id);
    const { body } = render(CueListPanel, { props: { editorOnly: true, stepNumber: 7 } });
    expect(body).toMatch(/data-cue-step-number[^>]*>Q7</);
    expect(body).not.toMatch(/>No\./);
  });

  it('the Show\'s own cue list keeps its editable No.', () => {
    const { body } = render(CueListPanel, { props: { editorOnly: true } });
    expect(body).toMatch(/>No\./);
  });
});
