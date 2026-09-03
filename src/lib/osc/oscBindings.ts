export type OscBindingMode = 'continuous' | 'trigger';

export interface OscBindingSpec {
  address: string;
  argIndex: number;
  path: string;
  sourceMin: number;
  sourceMax: number;
  invert: boolean;
  label?: string;
  mode?: OscBindingMode;
}

const TRIGGER_PATHS = new Set([
  'vj:stopall',
  'vj-b:stopall',
  'vj:crossfader:cut-a',
  'vj:crossfader:cut-b',
  'vj:quantize-clear',
]);

/** Infer button/bang semantics for bindings saved before mode was explicit. */
export function inferOscBindingMode(path: string): OscBindingMode {
  if (
    TRIGGER_PATHS.has(path)
    || path.includes(':trigger:')
    || path.startsWith('vj:column:')
    || path.startsWith('vj-b:column:')
    || path.startsWith('vj:block:')
    || path.startsWith('vj-b:block:')
    || path.startsWith('vj:stage:')
    || path.startsWith('vj:snapshot:')
    || path.includes(':stage-effect:')
    || path.includes(':led-effect:')
  ) {
    return 'trigger';
  }
  return 'continuous';
}

/**
 * Convert an OSC argument into the normalized value expected by midiRouter.
 * Trigger bindings accept argument-less messages and OSC Impulse (`I`, parsed
 * as Infinity) as a press. Numeric and boolean release messages remain usable.
 */
export function resolveOscBindingValue(
  binding: OscBindingSpec,
  args: unknown[],
): number | null {
  const mode = binding.mode ?? inferOscBindingMode(binding.path);
  const raw = args[binding.argIndex];

  if (mode === 'trigger' && (raw === undefined || raw === Infinity)) {
    return binding.invert ? 0 : 1;
  }

  const numeric = typeof raw === 'number'
    ? raw
    : raw === true
      ? 1
      : raw === false
        ? 0
        : Number.NaN;

  if (!Number.isFinite(numeric)) return null;

  const span = binding.sourceMax - binding.sourceMin || 1;
  let value = (numeric - binding.sourceMin) / span;
  value = Math.max(0, Math.min(1, value));
  return binding.invert ? 1 - value : value;
}

function clipBinding(
  bank: 'a' | 'b',
  layerIndex: number,
  columnIndex: number,
): OscBindingSpec {
  const prefix = bank === 'a' ? 'vj' : 'vj-b';
  const bankLabel = bank.toUpperCase();
  return {
    address: `/ghost/vj/${bank}/layer/${layerIndex + 1}/clip/${columnIndex + 1}`,
    argIndex: 0,
    path: `${prefix}:${layerIndex}:trigger:${columnIndex}`,
    sourceMin: 0,
    sourceMax: 1,
    invert: false,
    label: `Deck ${bankLabel} L${layerIndex + 1} Clip ${columnIndex + 1}`,
    mode: 'trigger',
  };
}

/**
 * Canonical OSC surface for DAWs, Beat Link Trigger, and Open Beat Control.
 * OSC addresses are friendly 1-based coordinates; Ghost router paths remain
 * zero-based to match the deck store.
 */
export function createVjOscTemplateBindings(
  layerCount = 4,
  columnCount = 8,
): OscBindingSpec[] {
  const bindings: OscBindingSpec[] = [];

  for (const bank of ['a', 'b'] as const) {
    const prefix = bank === 'a' ? 'vj' : 'vj-b';
    const bankLabel = bank.toUpperCase();

    for (let layer = 0; layer < layerCount; layer += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        bindings.push(clipBinding(bank, layer, column));
      }
    }

    // Per-layer mixer and transport. The router has always understood these;
    // the template only ever emitted clip and column triggers, so anyone who
    // wanted a fader had to hand-write the path string. Everything here is
    // addressable without knowing what is loaded in the layer — shader, splat
    // and plugin params are not, which is why they stay out.
    for (let layer = 0; layer < layerCount; layer += 1) {
      const label = `Deck ${bankLabel} L${layer + 1}`;
      const layerControls: Array<[string, string, string, OscBindingMode]> = [
        ['opacity', 'opacity', `${label} opacity`, 'continuous'],
        ['blend', 'blend', `${label} blend mode`, 'continuous'],
        ['solo', 'solo', `${label} solo`, 'trigger'],
        ['mute', 'mute', `${label} mute`, 'trigger'],
        ['video/play', 'video:play', `${label} play / pause`, 'trigger'],
        ['video/restart', 'video:restart', `${label} restart`, 'trigger'],
        // Continuous: this is the one an external timeline drives.
        ['video/position', 'video:position', `${label} playhead`, 'continuous'],
      ];
      for (const [suffix, pathSuffix, controlLabel, mode] of layerControls) {
        bindings.push({
          address: `/ghost/vj/${bank}/layer/${layer + 1}/${suffix}`,
          argIndex: 0,
          path: `${prefix}:${layer}:${pathSuffix}`,
          sourceMin: 0,
          sourceMax: 1,
          invert: false,
          label: controlLabel,
          mode,
        });
      }
    }

    for (let column = 0; column < columnCount; column += 1) {
      bindings.push({
        address: `/ghost/vj/${bank}/column/${column + 1}`,
        argIndex: 0,
        path: `${prefix}:column:${column}`,
        sourceMin: 0,
        sourceMax: 1,
        invert: false,
        label: `Deck ${bankLabel} Column ${column + 1}`,
        mode: 'trigger',
      });
    }
  }

  bindings.push(
    {
      // Master tempo from a DAW or timeline source. Not 0..1: this carries a
      // BPM, so the range is set wide enough to pass one through untouched.
      address: '/ghost/vj/tempo',
      argIndex: 0,
      path: 'vj:tempo',
      sourceMin: 0,
      sourceMax: 300,
      invert: false,
      label: 'Master tempo (BPM)',
      mode: 'continuous',
    },
    {
      address: '/ghost/vj/stop',
      argIndex: 0,
      path: 'vj:stopall',
      sourceMin: 0,
      sourceMax: 1,
      invert: false,
      label: 'Stop all clips',
      mode: 'trigger',
    },
    {
      address: '/ghost/vj/master',
      argIndex: 0,
      path: 'vj:master:opacity',
      sourceMin: 0,
      sourceMax: 1,
      invert: false,
      label: 'VJ master opacity',
      mode: 'continuous',
    },
    {
      address: '/ghost/vj/crossfader',
      argIndex: 0,
      path: 'vj:crossfader:value',
      sourceMin: 0,
      sourceMax: 1,
      invert: false,
      label: 'A/B crossfader',
      mode: 'continuous',
    },
  );

  return bindings;
}
