/**
 * Parameters that belong to the whole stage or to the LED rig rather than to
 * one mapping layer, with the same shape as layer parameters
 * (keyframes/paramDiscovery.ts) so one line model drives all of them.
 *
 *   stage:fx:<effectId>:<param>     a Stage FX (mapping composition) effect
 *                                   value, `enabled` or `opacity`
 *   stage:fx:<effectId>:rgb:<base>  one of its colours, packed 0xRRGGBB
 *   led:<controllerId>:brightness   a WLED controller's output level
 *   led:<controllerId>:gamma
 *   ledfx:<effectId>:active         an LED effect latched on
 *   ledfx:<effectId>:amount | speed | <pattern param>
 *   ledfx:<effectId>:color | secondaryColor   colour, packed 0xRRGGBB
 *
 * Writers return copies (memoised on input identity + values), never the
 * project's own objects.
 */
import type { Effect, MappingCompositionState, WLEDController, WLEDEffect } from '../../types';
import type { KeyframeableParam } from '../../keyframes/paramDiscovery';
import { effectParamLabels } from '../../effects/effectUX';
import { getWLEDPatternDefinition } from '../../wled/effects';
import { parseWLEDHexColor } from '../../wled/mapping';
import { effectColourGroups, readEffectColour, writeEffectColour } from '../stagefx/effectColours';

export type OverrideValues = Record<string, number | boolean>;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function discoverStageParams(composition: MappingCompositionState | null | undefined): KeyframeableParam[] {
  const params: KeyframeableParam[] = [];
  for (const effect of composition?.effects ?? []) {
    const group = `Stage FX · ${capital(effect.type)}`;
    params.push(
      { key: `stage:fx:${effect.id}:enabled`, label: 'Enabled', type: 'boolean', kind: 'bool', defaultValue: effect.enabled, group },
      { key: `stage:fx:${effect.id}:opacity`, label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: effect.opacity ?? 1, group },
    );
    // Colours first: one colour line instead of three R/G/B lines.
    for (const colour of effectColourGroups(effect.type)) {
      params.push({
        key: `stage:fx:${effect.id}:rgb:${colour.base}`, label: colour.label, type: 'number', kind: 'colour',
        min: 0, max: 0xffffff, step: 1, defaultValue: readEffectColour(effect, colour), group,
      });
    }
    for (const [name, meta] of Object.entries(effectParamLabels[effect.type] ?? {})) {
      if (meta.type === 'color') continue;
      const current = (effect.params as Record<string, unknown>)?.[name];
      params.push({
        key: `stage:fx:${effect.id}:${name}`,
        label: meta.label,
        type: 'number',
        min: meta.min,
        max: meta.max,
        step: meta.step,
        defaultValue: typeof current === 'number' ? current : meta.default,
        group,
        ...(meta.type === 'select' ? { kind: 'stepped' as const } : {}),
      });
    }
  }
  return params;
}

export function packColor(hex: string | undefined): number {
  const [r, g, b] = parseWLEDHexColor(hex);
  return (r << 16) | (g << 8) | b;
}

export function unpackColor(value: number): [number, number, number] {
  const n = Math.max(0, Math.min(0xffffff, Math.round(value) || 0));
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorHex(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(value) || 0)).toString(16).padStart(6, '0')}`;
}

export function discoverLedParams(controllers: readonly WLEDController[] | undefined, effects: readonly WLEDEffect[] | undefined): KeyframeableParam[] {
  const params: KeyframeableParam[] = [];
  for (const c of controllers ?? []) {
    const group = `LEDs · ${c.name}`;
    params.push(
      { key: `led:${c.id}:brightness`, label: 'Brightness', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: c.brightness ?? 1, group },
      { key: `led:${c.id}:gamma`, label: 'Gamma', type: 'number', min: 0.5, max: 3, step: 0.01, defaultValue: c.gamma ?? 1, group },
    );
  }
  for (const e of effects ?? []) {
    const group = `LED effect · ${e.name}`;
    params.push(
      { key: `ledfx:${e.id}:active`, label: 'On', type: 'boolean', kind: 'bool', defaultValue: e.active, group },
      { key: `ledfx:${e.id}:amount`, label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, defaultValue: e.amount, group },
      { key: `ledfx:${e.id}:speed`, label: 'Speed', type: 'number', min: 0, max: 4, step: 0.01, defaultValue: e.speed, group },
      { key: `ledfx:${e.id}:color`, label: 'Color', type: 'number', kind: 'colour', min: 0, max: 0xffffff, step: 1, defaultValue: packColor(e.color), group },
      { key: `ledfx:${e.id}:secondaryColor`, label: 'Second color', type: 'number', kind: 'colour', min: 0, max: 0xffffff, step: 1, defaultValue: packColor(e.secondaryColor), group },
    );
    let names: string[] = [];
    try { names = Object.keys(getWLEDPatternDefinition(e.pattern).params ?? {}); } catch { names = Object.keys(e.params ?? {}); }
    for (const name of new Set([...names, ...Object.keys(e.params ?? {})])) {
      params.push({ key: `ledfx:${e.id}:${name}`, label: capital(name), type: 'number', min: 0, max: name === 'colorCount' ? 4 : 1, step: 0.01, defaultValue: Number(e.params?.[name] ?? 0), group });
    }
  }
  return params;
}

function sameValues(a: OverrideValues | null, b: OverrideValues): boolean {
  if (!a) return false;
  let n = 0;
  for (const k in b) {
    if (a[k] !== b[k]) return false;
    n++;
  }
  for (const _ in a) n--;
  return n === 0;
}

/**
 * A memo for one writer: the same input list and the same values give the
 * same output list back, so the native sync's identity checks keep holding.
 */
function memo<T>() {
  let input: T | null = null;
  let values: OverrideValues | null = null;
  let output: T | null = null;
  return (next: T, overrides: OverrideValues, make: () => T): T => {
    if (input === next && sameValues(values, overrides)) return output as T;
    input = next;
    values = { ...overrides };
    output = make();
    return output;
  };
}

const stageMemo = memo<readonly Effect[]>();

/** Stage FX with `stage:fx:` overrides applied (copies). */
export function applyStageOverrides(effects: readonly Effect[], overrides: OverrideValues | null | undefined): readonly Effect[] {
  if (!overrides || !effects.length) return effects;
  let any = false;
  for (const k in overrides) if (k.startsWith('stage:fx:')) { any = true; break; }
  if (!any) return effects;
  return stageMemo(effects, overrides, () => effects.map((effect) => {
    const prefix = `stage:fx:${effect.id}:`;
    let next: any = null;
    for (const key in overrides) {
      if (!key.startsWith(prefix)) continue;
      next ??= { ...effect, params: { ...effect.params } };
      const prop = key.slice(prefix.length);
      const value = overrides[key];
      if (prop === 'enabled') next.enabled = typeof value === 'boolean' ? value : value >= 0.5;
      else if (prop === 'opacity') next.opacity = Number(value);
      else if (prop.startsWith('rgb:')) {
        const colour = effectColourGroups(effect.type).find((c) => c.base === prop.slice(4));
        if (colour) writeEffectColour(next.params, colour, Number(value));
      } else next.params[prop] = value;
    }
    return (next ?? effect) as Effect;
  }));
}

/** A controller with its `led:` overrides (a copy), or the same one. */
export function applyLedControllerOverrides(controller: WLEDController, overrides: OverrideValues | null | undefined): WLEDController {
  if (!overrides) return controller;
  const b = overrides[`led:${controller.id}:brightness`];
  const g = overrides[`led:${controller.id}:gamma`];
  if (b === undefined && g === undefined) return controller;
  return {
    ...controller,
    ...(b !== undefined ? { brightness: Math.max(0, Math.min(1, Number(b))) } : {}),
    ...(g !== undefined ? { gamma: Math.max(0.5, Math.min(3, Number(g))) } : {}),
  };
}

const ledMemo = memo<readonly WLEDEffect[]>();

/** LED effects with their `ledfx:` overrides (copies). */
export function applyLedEffectOverrides(effects: readonly WLEDEffect[], overrides: OverrideValues | null | undefined): readonly WLEDEffect[] {
  if (!overrides || !effects.length) return effects;
  let any = false;
  for (const k in overrides) if (k.startsWith('ledfx:')) { any = true; break; }
  if (!any) return effects;
  return ledMemo(effects, overrides, () => effects.map((effect) => {
    const prefix = `ledfx:${effect.id}:`;
    let next: any = null;
    for (const key in overrides) {
      if (!key.startsWith(prefix)) continue;
      next ??= { ...effect, params: { ...effect.params } };
      const prop = key.slice(prefix.length);
      const value = overrides[key];
      const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
      if (prop === 'active') next.active = typeof value === 'boolean' ? value : n >= 0.5;
      else if (prop === 'amount') next.amount = Math.max(0, Math.min(1, n));
      else if (prop === 'speed') next.speed = Math.max(0, n);
      else if (prop === 'color' || prop === 'secondaryColor' || prop === 'tertiaryColor' || prop === 'quaternaryColor') next[prop] = colorHex(n);
      else next.params[prop] = n;
    }
    return (next ?? effect) as WLEDEffect;
  }));
}

/** The project's own value for a stage or LED key (record and defaults). */
export function readStageLedParam(
  key: string,
  composition: MappingCompositionState | null | undefined,
  controllers: readonly WLEDController[] | undefined,
  effects: readonly WLEDEffect[] | undefined,
): number | boolean | undefined {
  const parts = key.split(':');
  if (parts[0] === 'stage' && parts[1] === 'fx') {
    const effect = composition?.effects?.find((e) => e.id === parts[2]);
    if (!effect) return undefined;
    const prop = parts.slice(3).join(':');
    if (prop === 'enabled') return effect.enabled;
    if (prop === 'opacity') return effect.opacity ?? 1;
    if (prop.startsWith('rgb:')) {
      const colour = effectColourGroups(effect.type).find((c) => c.base === prop.slice(4));
      return colour ? readEffectColour(effect, colour) : undefined;
    }
    const v = (effect.params as Record<string, unknown>)[prop];
    return typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
  }
  if (parts[0] === 'led') {
    const c = controllers?.find((x) => x.id === parts[1]);
    if (!c) return undefined;
    if (parts[2] === 'brightness') return c.brightness ?? 1;
    if (parts[2] === 'gamma') return c.gamma ?? 1;
    return undefined;
  }
  if (parts[0] === 'ledfx') {
    const e = effects?.find((x) => x.id === parts[1]);
    if (!e) return undefined;
    const prop = parts[2];
    if (prop === 'active') return e.active;
    if (prop === 'amount') return e.amount;
    if (prop === 'speed') return e.speed;
    if (prop === 'color' || prop === 'secondaryColor') return packColor(e[prop]);
    return e.params?.[prop];
  }
  return undefined;
}
