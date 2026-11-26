/**
 * The fixture plan the render core samples and sends from when it drives
 * Art-Net / sACN output itself (native-renderer/src/pixelmap_out).
 *
 * Everything that only changes with the project is resolved here, once per
 * edit, by the same code the editor path runs every tick: the sample points,
 * the DMX patch and which fixtures are ready. The core then samples,
 * calibrates, packs and sends every frame on its own clock.
 */
import type { PixelMapConfig, PixelMapFixture, WLEDEffect, WLEDEffectAutomation, WLEDGroup } from '../types';
import { fixtureIssues, fixtureTarget, patchFixture, resolveFixtureMapping } from './fixtures';
import { effectsTouchOutput, fixtureLEDTarget } from '../wled/effects';

/** Same picture size the editor path asks the composite mirror for. */
export const CORE_PIXELMAP_MAX_DIM = 384;

export interface CorePixelMapFixturePlan {
  id: string;
  /** x0, y0, x1, y1, … normalized, in physical pixel order. */
  points: number[];
  sampleRadius: number;
  samplingMode: string;
  brightness?: number;
  gamma?: number;
  calibration?: PixelMapFixture['calibration'];
  testPattern: string;
  testColor?: string;
  colorOrder: string;
  protocol: 'artnet' | 'sacn';
  host: string | null;
  segments: Array<{ universe: number; channel: number; firstPixel: number; pixelCount: number }>;
}

export interface CorePixelMapPlan {
  fps: number;
  artSync: boolean;
  sacn: { priority: number; sourceName: string; cid: string };
  maxDim: number;
  fixtures: CorePixelMapFixturePlan[];
}

export function readyPixelMapFixtures(config: PixelMapConfig | null | undefined): PixelMapFixture[] {
  return (config?.fixtures ?? []).filter(fixture => fixture.enabled && fixtureIssues(fixture).length === 0);
}

/**
 * Whether the core can drive these fixtures. LED FX (project.wledEffects)
 * run only in the editor, so a fixture an effect could reach keeps the
 * whole output on the editor path.
 */
export function corePixelMapEligible(
  config: PixelMapConfig,
  groups: WLEDGroup[],
  effects: WLEDEffect[],
  automation: WLEDEffectAutomation | undefined,
): boolean {
  return readyPixelMapFixtures(config).every(fixture =>
    !effectsTouchOutput(fixtureLEDTarget(fixture, fixture.pixelCount), groups, effects, automation));
}

/** The plan for a normalized config (normalizePixelMapConfig). */
export function buildCorePixelMapPlan(
  config: PixelMapConfig,
  aspect = 16 / 9,
  resolve: (fixture: PixelMapFixture, aspect: number) => { points: Array<{ x: number; y: number }>; sampleRadius: number } = resolveFixtureMapping,
): CorePixelMapPlan {
  return {
    fps: config.fps,
    artSync: config.artSync,
    sacn: { priority: config.sacnPriority, sourceName: config.sacnSourceName, cid: config.sacnCid },
    maxDim: CORE_PIXELMAP_MAX_DIM,
    fixtures: readyPixelMapFixtures(config).map((fixture) => {
      const mapping = resolve(fixture, aspect);
      const target = fixtureTarget(fixture);
      return {
        id: fixture.id,
        points: mapping.points.flatMap(point => [point.x, point.y]),
        sampleRadius: mapping.sampleRadius,
        samplingMode: fixture.samplingMode ?? 'average',
        brightness: fixture.brightness,
        gamma: fixture.gamma,
        calibration: fixture.calibration,
        testPattern: fixture.testPattern ?? 'off',
        testColor: fixture.testColor,
        colorOrder: fixture.colorOrder,
        protocol: target.protocol,
        host: target.host,
        segments: patchFixture(fixture).map(segment => ({
          universe: segment.universe,
          channel: segment.channel,
          firstPixel: segment.firstPixel,
          pixelCount: segment.pixelCount,
        })),
      };
    }),
  };
}
