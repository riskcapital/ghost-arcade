import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The decode badge sits inside a Media tray tile, whose click adds the clip
 * to the current layer, and the tile clips and scales what is inside it.
 * Dismissing the popover or pressing Convert used to load the clip too, and
 * the popover was cut off by the tile and rarely seen.
 */

const badge = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'VideoDecodeBadge.svelte'), 'utf8');
const markup = badge.slice(badge.indexOf('</script>'), badge.indexOf('<style>'));

function fnBody(name: string): string {
  const start = badge.indexOf(`function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return badge.slice(start, badge.indexOf('\n  }', start));
}

describe('video decode badge popover', () => {
  it('moves the popover and its backdrop to <body>, out of the tile', () => {
    const layer = markup.indexOf('class="decode-layer"');
    expect(layer).toBeGreaterThan(-1);
    const layerTag = markup.slice(layer, markup.indexOf('class="decode-backdrop"', layer));
    expect(layerTag).toContain('use:portal');
    // Backdrop and popover are inside the moved layer.
    expect(markup.indexOf('class="decode-backdrop"')).toBeGreaterThan(layer);
    expect(markup.indexOf('class="decode-popover"')).toBeGreaterThan(layer);
    // The moved node is not the block's own boundary node.
    expect(markup.lastIndexOf('class="decode-popover-home"', layer)).toBeGreaterThan(-1);
  });

  it('keeps clicks in the popover from reaching the tile', () => {
    const layer = markup.indexOf('class="decode-layer"');
    const layerTag = markup.slice(layer, markup.indexOf('class="decode-backdrop"', layer));
    expect(layerTag).toMatch(/onclick=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(layerTag).toMatch(/onpointerdown=\{\(e\) => e\.stopPropagation\(\)\}/);
    expect(fnBody('convert')).toContain('event.stopPropagation()');
    expect(fnBody('close')).toContain('stopPropagation()');
  });

  it('places the popover from the badge, not from a position inside the tile', () => {
    const open = fnBody('open');
    expect(open).toContain('getBoundingClientRect()');
    expect(open).toContain('window.innerWidth');
  });

  it('still hands the click to the VJ grid when it opens its own menu', () => {
    const open = fnBody('open');
    expect(open.indexOf('if (onopen)')).toBeLessThan(open.indexOf('getBoundingClientRect'));
  });
});
