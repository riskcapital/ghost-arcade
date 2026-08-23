/**
 * Every cache in the sync layer must have a way out.
 *
 * NativeRendererSync keeps ~35 Maps and Sets keyed by things that churn during
 * a set: layer ids, source keys, live-capture session ids that are regenerated
 * on every camera restart. A cache that is only ever written to is a slow leak
 * that nothing catches — it does not fail, it just grows for the length of the
 * show. Four were in that state when this test was written:
 *
 *   nativeTextState              rasterized glyph atlases, per layer id
 *   nativeModel3DState           mesh state, per layer id
 *   sharedTextureInfoCache       per live-capture session id
 *   sharedTextureInfoNextPollAt  same, plus its `:failures` counters
 *
 * This is a source-level check rather than a runtime one because the leak has
 * no observable symptom until it is large. Anything that writes to a
 * collection must also delete, clear, or reassign it somewhere.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Collections that are intentionally write-only.
 *
 * Keep this list short and justified — an entry here is a promise that the key
 * space is bounded by something that does not grow with time.
 */
const BOUNDED_BY_DESIGN: Record<string, string> = {
  displayBounds: 'keyed by OS display id — bounded by the number of monitors',
};

function syncSource(): string {
  return readFileSync(join(process.cwd(), 'src/lib/sync/nativeRendererSync.ts'), 'utf8');
}

describe('Sync cache bounds', () => {
  it('every Map/Set member has a removal path', () => {
    const source = syncSource();
    const members = [...source.matchAll(/private (\w+)\s*=\s*new (Map|Set)</g)]
      .map((match) => match[1]);

    expect(members.length, 'expected to find the sync caches').toBeGreaterThan(20);

    const unbounded = members.filter((name) => {
      if (name in BOUNDED_BY_DESIGN) return false;
      const writes = new RegExp(`this\\.${name}\\.(set|add)\\(`).test(source);
      if (!writes) return false;
      const removes = new RegExp(`this\\.${name}\\.(delete|clear)\\(`).test(source);
      // Wholesale reassignment counts too — some caches are swapped rather
      // than mutated.
      const reassigned = new RegExp(`this\\.${name}\\s*=\\s*new (Map|Set)`).test(source);
      return !removes && !reassigned;
    });

    expect(
      unbounded,
      `Sync caches that are written but never deleted, cleared, or reassigned.\n`
      + `They grow for the life of the process. Add a prune, or add an entry to\n`
      + `BOUNDED_BY_DESIGN explaining why the key space cannot grow:\n`
      + `  ${unbounded.join('\n  ')}`,
    ).toEqual([]);
  });

  it('prunes the layer-keyed caches against the live layer set', () => {
    // Pins the specific fix rather than just the general rule: these two hold
    // the expensive payloads (a glyph atlas, a mesh), so a future refactor that
    // drops the prune should fail loudly here.
    const source = syncSource();
    expect(source).toMatch(/liveLayerIds\.has\(layerId\)[\s\S]{0,80}nativeTextState\.delete/);
    expect(source).toMatch(/liveLayerIds\.has\(layerId\)[\s\S]{0,80}nativeModel3DState\.delete/);
  });
});
