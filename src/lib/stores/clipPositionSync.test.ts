import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * External timeline sync: a DAW, a show controller, or Beat Link Trigger
 * following a CDJ sends "the track is at N seconds" and the clip follows.
 *
 * The OSC path vj:<layer>:video:position already existed and already parsed
 * correctly. What it did was write videoElement.currentTime — and under the
 * native engine that element is not what renders, so nothing moved on screen.
 * The report reads as "Ghost Arcade fails to receive the track's timeline
 * position", but the message arrived fine and was applied to the wrong clock.
 *
 * Source-level, because the router reaches the native transport through the
 * whole store and the renderer sync; what is worth pinning is which clock the
 * position lands on and that a continuous stream does not re-seek per message.
 */

const routerSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'midi', 'midiRouter.ts'),
  'utf8',
);
const storeSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'stores', 'vjClipLauncher.ts'),
  'utf8',
);

function positionBranch(): string {
  const start = routerSource.indexOf("} else if (action === 'position') {");
  expect(start, 'position branch not found').toBeGreaterThan(-1);
  return routerSource.slice(start, routerSource.indexOf('\n        }', start));
}

function syncMethod(): string {
  const start = storeSource.indexOf('    syncActiveClipPosition(');
  expect(start, 'syncActiveClipPosition not found').toBeGreaterThan(-1);
  return storeSource.slice(start, storeSource.indexOf('\n    },', start));
}

describe('external timeline position sync', () => {
  it('routes position to the native transport, not just the DOM element', () => {
    const branch = positionBranch();
    expect(
      branch,
      'position must go through the store so the native anchor moves',
    ).toContain('syncActiveClipPosition');

    const bare = branch
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(
      /video\.currentTime\s*=/.test(bare),
      'writing videoElement.currentTime alone is the bug: nothing renders from it',
    ).toBe(false);
  });

  it('re-anchors all three native fields together', () => {
    // A time with no fresh anchor is read as an old position that has since
    // advanced; no seek bump and the core never re-seeks. All three or nothing.
    const method = syncMethod();
    expect(method).toContain('_nativePlaybackTimeSeconds');
    expect(method).toContain('_nativePlaybackUpdatedAtMs');
    expect(method).toContain('_nativePlaybackSeekSeq');
  });

  it('only corrects once the clip has actually drifted', () => {
    // Seeking per message would re-arm the decoder tens of times a second.
    const method = syncMethod();
    expect(method).toContain('predictedClipPlayheadSeconds');
    expect(method).toMatch(/drift\s*<=|<=\s*.*driftTolerance/);
    expect(storeSource).toMatch(/CLIP_POSITION_SYNC_DRIFT_SECONDS\s*=\s*0\.0[0-9]/);
  });

  it('predicts the playhead from the anchor rather than trusting the stored time', () => {
    // The core free-runs between seeks, so the stored value is the last anchor,
    // not the live position. Comparing against it would make drift look like
    // the whole elapsed time and re-seek constantly.
    const predictor = storeSource.slice(
      storeSource.indexOf('export function predictedClipPlayheadSeconds'),
    );
    expect(predictor).toContain('_nativePlaybackUpdatedAtMs');
    expect(predictor).toContain('playbackRate');
  });
});
