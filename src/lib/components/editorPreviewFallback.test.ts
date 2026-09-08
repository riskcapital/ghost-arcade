import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The in-app editor preview needs a presenter on every platform.
 *
 * The core presents it by parenting a child window under Electron's
 * transparent content view, and that is wrapped in cfg!(target_os = "macos").
 * The Windows equivalent, dxgi_preview_addon, is compiled by CMakeLists and
 * never loaded by anything. So on Windows the output window shows the
 * composite and the in-app preview shows the cleared underlay, which reached
 * us as "video plays on the output but not in the preview" — not a video
 * problem at all: nothing reaches that viewport.
 *
 * The fallback mirrors the composite into the canvas, the same mechanism the
 * VJ preview and WLED sampling already use. These tests hold the two
 * properties that make it safe rather than the drawing itself.
 */

const canvasSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'components', 'Canvas.svelte'),
  'utf8',
);

function fallbackBlock(): string {
  const start = canvasSource.indexOf('async function ensureEditorPreviewFallback');
  expect(start, 'ensureEditorPreviewFallback not found').toBeGreaterThan(-1);
  return canvasSource.slice(start, canvasSource.indexOf('\n      function drawEditorPreviewFallback', start));
}

describe('editor preview fallback', () => {
  it('asks the core whether it has a presenter rather than sniffing the platform', () => {
    // Keying on the core's own report means this disengages by itself if a
    // real Windows presenter lands, instead of double-drawing forever.
    const block = fallbackBlock();
    expect(block).toContain('getNativeRendererCapabilities');
    expect(block).toContain('parented');
    expect(
      /navigator\.platform|process\.platform|isWindows|win32/.test(block),
      'platform sniffing goes stale; the core already reports whether it is presenting',
    ).toBe(false);
  });

  it('does nothing when the core is already presenting', () => {
    // On macOS the core reports parented/underlay-zero-copy, and a CPU
    // readback on top of a working zero-copy presenter is pure waste.
    const block = fallbackBlock();
    expect(block).toMatch(/preview\?\.parented\s*===\s*true/);
    const branch = block.slice(block.indexOf('preview?.parented === true'));
    expect(branch.slice(0, 400)).toContain('releaseEditorPreviewFallback');
  });

  it('keeps checking until a presenter settles it, rather than deciding once', () => {
    // The original asked exactly once, on an early animation frame, inside
    // the one window where the presenter has not attached yet. It therefore
    // always engaged, then latched, leaving a 1024px/30fps CPU readback
    // running for the whole session against a presenter that showed up
    // seconds later. Profiling a live Windows session put the decode at 13%
    // of renderer samples for a composite already on screen.
    const block = fallbackBlock();
    expect(block).toContain('previewFallbackNextCheckAt');
    // The latch may only be set once the answer is actually settled.
    const earlyLatch = block.slice(0, block.indexOf('preview?.parented === true'));
    expect(
      /previewMirrorChecked\s*=\s*true/.test(earlyLatch),
      'the fallback must not latch before it knows whether a presenter exists',
    ).toBe(false);
  });

  it('waits out a grace period before paying for a readback', () => {
    // A presenter attaches shortly after the core comes up. Engaging inside
    // that gap buys nothing and costs the most expensive mirror consumer.
    const block = fallbackBlock();
    expect(block).toContain('PREVIEW_FALLBACK_GRACE_MS');
    expect(block).toMatch(/previewFallbackFirstCheckAt\s*<\s*PREVIEW_FALLBACK_GRACE_MS/);
  });

  it('releases the mirror on teardown', () => {
    // The pump is ref-counted; a handle that is never released keeps reading
    // frames back off the GPU for a canvas that no longer exists.
    const start = canvasSource.indexOf('nativeTeardownCallbacks.push(() => {\n        if (previewMirror)');
    expect(start, 'no teardown for the preview mirror').toBeGreaterThan(-1);
    expect(canvasSource.slice(start, start + 260)).toContain('previewMirror.release()');
  });

  it('releases rather than leaks when no 2D context is available', () => {
    // If a WebGL context was already taken on this canvas, 2D returns null.
    // Acquiring the pump and then failing to draw would cost readbacks for
    // nothing.
    const block = fallbackBlock();
    const guard = block.slice(block.indexOf('if (!previewMirrorCtx)'));
    expect(guard).toContain('previewMirror.release()');
  });
});
