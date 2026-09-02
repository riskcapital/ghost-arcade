import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Image clips must accept the per-clip transform.
 *
 * Reported by a user after updating: "It only lets me adjust sizes on the
 * videos not images." The transform is baked into the layer's warp-quad
 * corners and has nothing video-specific about it, but it was gated on
 * type === 'video' in three separate places — the panel that renders the
 * controls, the store setter that writes them, and the clip-to-layer
 * conversion that applies them. Any one of those left in place makes the
 * feature look broken: the sliders vanish, or they move and nothing happens.
 *
 * Source-level because the render result is what actually matters and that
 * needs a GPU and a loaded image; what is checkable here is that none of the
 * three gates has crept back.
 */

const root = process.cwd();
const launcher = readFileSync(join(root, 'src', 'lib', 'stores', 'vjClipLauncher.ts'), 'utf8');
const panel = readFileSync(join(root, 'src', 'lib', 'components', 'VJModePanel.svelte'), 'utf8');
const transform = readFileSync(join(root, 'src', 'lib', 'components', 'VJClipTransform.svelte'), 'utf8');

describe('per-clip transform applies to images', () => {
  it('accepts images in the transform predicate', () => {
    const fn = launcher.slice(
      launcher.indexOf('function clipSupportsTransform'),
      launcher.indexOf('function clipSupportsTransform') + 220,
    );
    expect(fn).toContain("'video'");
    expect(fn).toContain("'image'");
  });

  it('does not re-gate the store setter on video', () => {
    expect(launcher).toContain('!clipSupportsTransform(activeClip)');
    expect(launcher).not.toContain("activeClip.type !== 'video'");
  });

  it('does not re-gate the layer conversion on video', () => {
    // These were `clip.type === 'video' ? ... : <identity>`, which silently
    // flattened every image transform back to defaults at render time.
    for (const prop of ['zoom', 'rotation', 'opacity', 'anchorX', 'anchorY']) {
      expect(
        new RegExp(`clip\\.type === 'video' \\? \\(clip\\.${prop}`).test(launcher),
        `${prop} is gated on video again`,
      ).toBe(false);
    }
  });

  it('renders the transform controls for image clips', () => {
    expect(panel).toMatch(/activeClip\?\.type === 'image'/);
    // Shared with the video panel rather than duplicated, so the two cannot
    // drift apart.
    expect(panel.match(/<VJClipTransform/g)?.length).toBe(2);
  });

  it('keeps the transform controls themselves media agnostic', () => {
    expect(transform).not.toContain("type === 'video'");
    expect(transform).toContain('zoom');
    expect(transform).toContain('anchorX');
  });
});
