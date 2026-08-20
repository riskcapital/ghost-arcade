import type { Translate } from './index';

function translatedOrFallback(t: Translate, key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

export function effectTypeLabel(t: Translate, type: string, fallback = type): string {
  return translatedOrFallback(t, `mobileAdvanced.effects.types.${type}`, fallback);
}

export function effectParamLabel(t: Translate, key: string, fallback = key): string {
  return translatedOrFallback(t, `mobileAdvanced.effects.params.${key}`, fallback);
}

export function effectOptionLabel(t: Translate, value: string | number, fallback = String(value)): string {
  return translatedOrFallback(t, `mobileAdvanced.effects.options.${String(value)}`, fallback);
}

function camelize(value: string): string {
  return value.replace(/[-_]+([a-zA-Z0-9])/g, (_, character: string) => character.toUpperCase());
}

export function blendModeLabel(t: Translate, value: string, fallback = value): string {
  return translatedOrFallback(t, `effects.edge.blendModes.${camelize(value)}`, fallback);
}

export function stageEffectTypeLabel(t: Translate, type: string, fallback = type): string {
  return translatedOrFallback(t, `layers.stageEffects.types.${type}`, fallback);
}

export function stageEffectParamLabel(t: Translate, key: string, fallback = key): string {
  return translatedOrFallback(t, `layers.stageEffects.params.${key}`, fallback);
}
