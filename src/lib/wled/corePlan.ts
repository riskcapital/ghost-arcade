/**
 * The plan the render core samples and sends WLED output from
 * (native-renderer/src/pixelmap_out/wled.rs), and which controllers it may
 * take.
 *
 * What only changes with the project is resolved here, by the code the
 * editor path runs: each controller's sample points, brightness, gamma,
 * calibration, test pattern and address, and the install mode's
 * force-black. The core then samples the program picture, calibrates and
 * sends on its own clock, with the editor path's keep-alive rule.
 *
 * Whatever is computed in the editor frame by frame keeps its controller on
 * the editor path: LED FX that reach it, the Timeline's LED rows when they
 * drive it, and Timeline lines on its brightness or gamma.
 */
import type { WLEDController, WLEDEffect, WLEDEffectAutomation, WLEDGroup, WLEDNormalizedPoint } from '../types';
import { resolveWLEDMapping } from './mapping';
import { effectsTouchOutput } from './effects';
import type { LedTimelineState } from '../timeline/leds/ledRuntime';
import { controllerHasLedBlocks } from '../timeline/leds/ledRender';
import { applyLedEffectOverrides } from '../timeline/lines/stageLedParams';

/** The composite mirror rate the editor path follows (Canvas.svelte). */
export const CORE_WLED_FPS = 20;
/** The composite mirror size the editor path samples. */
export const CORE_WLED_MAX_DIM = 192;

export interface CoreWLEDControllerPlan {
  id: string;
  name: string;
  ip: string;
  port: number;
  /** x0, y0, x1, y1, … normalized, in physical LED order. */
  points: number[];
  sampleRadius: number;
  samplingMode: string;
  brightness?: number;
  gamma?: number;
  calibration?: WLEDController['calibration'];
  testPattern: string;
  testColor?: string;
}

export interface CoreWLEDPlan {
  fps: number;
  forceBlack: boolean;
  maxDim: number;
  controllers: CoreWLEDControllerPlan[];
}

/** What the editor computes frame by frame and the core cannot see. */
export interface CoreWLEDContext {
  timeline: LedTimelineState | null;
  lines: Record<string, number | boolean> | null;
  groups: WLEDGroup[];
  effects: WLEDEffect[];
  automation: WLEDEffectAutomation | undefined;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4Address(text: unknown): text is string {
  return typeof text === 'string' && IPV4.test(text.trim()) && text.trim() !== '0.0.0.0';
}

/**
 * Why this controller stays on the editor path, or null when the core can
 * drive it.
 */
export function coreWLEDBlocker(controller: WLEDController, ctx: CoreWLEDContext): string | null {
  if (!controller.enabled) return 'disabled';
  // A host name needs a lookup the output thread does not do.
  if (!isIPv4Address(controller.ipAddr)) return 'not an IPv4 address';
  const port = controller.port ?? 21324;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'bad port';
  const timeline = ctx.timeline;
  if (timeline && (timeline.allDriven || controllerHasLedBlocks(controller, timeline.clips))) return 'timeline';
  const prefix = `led:${controller.id}:`;
  if (ctx.lines) for (const key in ctx.lines) if (key.startsWith(prefix)) return 'timeline line';
  const effects = applyLedEffectOverrides(ctx.effects, ctx.lines) as WLEDEffect[];
  if (effectsTouchOutput(controller, ctx.groups, effects, ctx.automation)) return 'led fx';
  return null;
}

type Resolve = (controller: WLEDController, aspect: number) => { points: WLEDNormalizedPoint[]; sampleRadius: number };

const resolveMapping: Resolve = (controller, aspect) => resolveWLEDMapping(controller.ledCount, controller.mapping, aspect);

/** The core's plan for these controllers (already chosen as core-eligible). */
export function buildCoreWLEDPlan(
  controllers: readonly WLEDController[],
  aspect = 16 / 9,
  forceBlack = false,
  resolve: Resolve = resolveMapping,
): CoreWLEDPlan {
  return {
    fps: CORE_WLED_FPS,
    forceBlack,
    maxDim: CORE_WLED_MAX_DIM,
    controllers: controllers.map((controller) => {
      const mapping = resolve(controller, aspect);
      return {
        id: controller.id,
        name: controller.name,
        ip: controller.ipAddr.trim(),
        port: controller.port ?? 21324,
        points: mapping.points.flatMap(point => [point.x, point.y]),
        sampleRadius: mapping.sampleRadius,
        samplingMode: controller.samplingMode ?? 'dominant',
        brightness: controller.brightness,
        gamma: controller.gamma,
        calibration: controller.calibration,
        testPattern: controller.testPattern ?? 'off',
        testColor: controller.testColor,
      };
    }),
  };
}
