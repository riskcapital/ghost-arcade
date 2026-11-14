/**
 * A block with a where line moving across the pieces: its copies over the
 * other pieces stay in the scene while the window moves. Between changes of
 * the order or the members, a frame reuses them: only a copy whose opacity
 * moved is a new object, and the scene is what a full build gives.
 */
import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

vi.mock('../../stores/layers', () => ({ project: writable({ layers: [], wledControllers: [] }) }));
vi.mock('../../stores/audio', () => ({ audioStore: writable({ bpm: 120, manualBPM: null }) }));
vi.mock('../../bridge', () => ({ invoke: vi.fn() }));
import type { Layer } from '../../types';
import type { ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, ShowTrackSceneCache, SHOW_WHERE_LAYER_PREFIX } from './showTrackScene';
import { applyContentWhere, motionContext } from '../../timeline/where/whereRuntime';
import { pieceSpots } from '../../timeline/where/spatialOrder';
import { normalizeWhere } from '../../timeline/where/whereModel';

function piece(id: string, x0: number, x1: number): Layer {
  return {
    id, name: id, type: 'shader', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null,
    corners: { topLeft: { x: x0, y: 1 }, topRight: { x: x1, y: 1 }, bottomLeft: { x: x0, y: 0 }, bottomRight: { x: x1, y: 0 } },
    layerShape: null,
  } as unknown as Layer;
}
const pieces = Array.from({ length: 8 }, (_, i) => piece(`P${i}`, i / 8, (i + 0.9) / 8));
const img = { id: 'img', type: 'image', src: '/a.png' } as never;
const ctx = { sourceFor: () => img };

function frameAt(t: number, span: boolean): ShowTrackFrame {
  const frame: ShowTrackFrame = {
    time: t, playing: true, seekGeneration: 0, manualClock: false,
    tracks: [{
      trackId: 'row:P0', layerId: 'P0', layerName: 'P0', template: null, gap: 'hide', params: null, warm: null, opacity: 1,
      clip: { clipId: 'c1', runId: 'c1', runStart: 0, media: { kind: 'image', name: 'a', src: '/a.png' }, mediaTime: t, paused: false, held: false, rate: 1, loopStart: 0, localTime: t },
    }],
  } as ShowTrackFrame;
  const tracks = [{ id: 'row:P0', layerId: 'P0', clips: [{ id: 'c1', startTime: 0, duration: 60, where: normalizeWhere({ order: 'left-right', motion: { kind: 'sweep', bars: 4 }, spread: 0, soft: 0, span }) }] }] as never;
  applyContentWhere(frame, { time: t, tracks, spots: pieceSpots(pieces), ctx: motionContext(null), lines: null });
  return frame;
}

describe('where copies while the window moves', () => {
  for (const span of [false, true]) {
    it(`reuses every copy whose opacity did not move${span ? ' (span)' : ''}`, () => {
      const cache = new ShowTrackSceneCache();
      let previous: Layer[] | null = null;
      let reused = 0;
      let copiesMade = 0;
      let copiesShown = 0;
      for (let i = 0; i <= 240; i++) {
        const frame = frameAt(i / 60, span);
        const prepared = cache.prepare(pieces, frame, ctx, [pieces]);
        let scene: Layer[];
        if (prepared.reusable && previous) {
          scene = prepared.reuse();
          reused++;
          const where = scene.filter((l) => l.id.startsWith(SHOW_WHERE_LAYER_PREFIX));
          copiesShown += where.length;
          for (const copy of where) {
            const before = previous.find((l) => l.id === copy.id)!;
            if (copy !== before) copiesMade++;
            // A copy is new only when what it carries moved.
            else expect(copy._showOpacityMul).toBe(before._showOpacityMul);
          }
        } else {
          scene = prepared.build(pieces.map((l) => ({ ...l })));
          prepared.commit(scene);
        }
        expect(scene).toEqual(buildShowTrackScene(pieces.map((l) => ({ ...l })), frame, ctx));
        previous = scene;
      }
      process.stderr.write(`[where] ${span ? "span " : ""}copies made ${copiesMade} of ${copiesShown} shown over ${reused} reused frames\n`);
      expect(reused).toBeGreaterThan(200);
      // With one lit piece at a time, most copies hold at no opacity.
      expect(copiesMade).toBeLessThan(copiesShown / 4);
    });
  }
});
