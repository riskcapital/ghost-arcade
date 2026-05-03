import type { GeoDeckState, GeoModSource, GeoSliderKey } from '../stores/geoDeck';

export interface GeoEngineRuntime {
  lfo1Phase: number;
  lfo2Phase: number;
}

export interface GeoEvaluatedState {
  form: GeoDeckState['form'];
  params: Record<GeoSliderKey, number>;
  lfo1: number;
  lfo2: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function getSourceValue(source: GeoModSource, xyX: number, xyY: number, lfo1: number, lfo2: number, macro1: number, macro2: number): number {
  switch (source) {
    case 'xyX': return xyX;
    case 'xyY': return xyY;
    case 'lfo1': return lfo1;
    case 'lfo2': return lfo2;
    case 'macro1': return macro1;
    case 'macro2': return macro2;
  }
}

export function evaluateGeoDeck(
  state: GeoDeckState,
  runtime: GeoEngineRuntime,
  dt: number,
  time: number,
  xyX: number,
  xyY: number
): GeoEvaluatedState {
  runtime.lfo1Phase = (runtime.lfo1Phase + dt * (0.18 + state.flow * 0.42)) % 1;
  runtime.lfo2Phase = (runtime.lfo2Phase + dt * (0.09 + state.depth * 0.26)) % 1;

  const lfo1 = 0.5 + 0.5 * Math.sin((runtime.lfo1Phase + time * 0.05) * Math.PI * 2);
  const lfo2 = 0.5 + 0.5 * Math.sin((runtime.lfo2Phase + time * 0.025) * Math.PI * 2 + 1.1);

  const params: Record<GeoSliderKey, number> = {
    scale: state.scale,
    depth: state.depth,
    flow: state.flow,
    echo: state.echo,
    symmetry: state.symmetry,
    contrast: state.contrast,
  };

  const morphScene = state.morphTargetSlot !== null ? state.sceneSlots[state.morphTargetSlot] : null;
  if (morphScene) {
    params.scale = lerp(params.scale, morphScene.params.scale, state.morph);
    params.depth = lerp(params.depth, morphScene.params.depth, state.morph);
    params.flow = lerp(params.flow, morphScene.params.flow, state.morph);
    params.echo = lerp(params.echo, morphScene.params.echo, state.morph);
    params.symmetry = lerp(params.symmetry, morphScene.params.symmetry, state.morph);
    params.contrast = lerp(params.contrast, morphScene.params.contrast, state.morph);
  }

  for (const route of state.modRoutes) {
    if (!route.enabled) continue;
    const src = getSourceValue(route.source, xyX, xyY, lfo1, lfo2, state.macro1, state.macro2);
    const centered = src - 0.5;
    params[route.target] = clamp01(params[route.target] + centered * route.amount);
  }

  return { form: state.form, params, lfo1, lfo2 };
}
