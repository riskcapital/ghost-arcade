import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import WelcomeModal from './WelcomeModal.svelte';

describe('the welcome screen', () => {
  it('names the number keys there are rows for', () => {
    const { body } = render(WelcomeModal, { props: {} });
    const rows = body.match(/class="choice[ "]/g)?.length ?? 0;
    expect(rows).toBeGreaterThan(0);
    expect(body).toContain(`Keys 1–${rows} pick a row`);
  });
});
